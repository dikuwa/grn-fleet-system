import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  inspectionTemplateItems,
  inspectionTemplates,
  vehicleInspections,
} from '@/db/schema/trips';
import { auditEvents } from '@/db/schema/audit';
import { runAtomicMutations } from '@/lib/db-atomic';

export class InspectionTemplateError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'InspectionTemplateError';
  }
}

type TemplateItemInput = {
  sortOrder?: number;
  category?: string;
  label?: string;
  requiresPhoto?: boolean;
  isCritical?: boolean;
};

function normalizeItems(items: unknown): Array<{
  sortOrder: number;
  category: string;
  label: string;
  requiresPhoto: boolean;
  isCritical: boolean;
}> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new InspectionTemplateError('At least one checklist item is required', 422);
  }
  const labels = new Set<string>();
  return items.map((raw, index) => {
    const item = raw as TemplateItemInput;
    const category = item.category?.trim();
    const label = item.label?.trim();
    if (!category || !label) {
      throw new InspectionTemplateError('Every checklist item requires a category and label', 422);
    }
    if (labels.has(label)) {
      throw new InspectionTemplateError(`Duplicate checklist label: ${label}`, 422);
    }
    labels.add(label);
    return {
      sortOrder: Number.isInteger(item.sortOrder) ? Number(item.sortOrder) : index,
      category,
      label,
      requiresPhoto: item.requiresPhoto === true,
      isCritical: item.isCritical === true,
    };
  });
}

async function nextVersion(tenantId: string, type: string) {
  const db = getDb();
  const [row] = await db
    .select({ maxVersion: sql<number>`coalesce(max(${inspectionTemplates.version}), 0)` })
    .from(inspectionTemplates)
    .where(and(eq(inspectionTemplates.tenantId, tenantId), eq(inspectionTemplates.type, type)));
  return Number(row?.maxVersion ?? 0) + 1;
}

export async function createInspectionTemplateVersion(input: {
  tenantId: string;
  userId: string;
  name: string;
  type: string;
  items: unknown;
  sourceTemplateId?: string | null;
}) {
  const name = input.name?.trim();
  if (!name) throw new InspectionTemplateError('Template name is required');
  if (!['departure', 'return'].includes(input.type)) {
    throw new InspectionTemplateError('Type must be departure or return');
  }
  const items = normalizeItems(input.items);
  const version = await nextVersion(input.tenantId, input.type);
  const templateId = randomUUID();
  const now = new Date();

  try {
    await runAtomicMutations((tx) => [
      tx.update(inspectionTemplates)
        .set({ isActive: false, updatedAt: now })
        .where(and(
          eq(inspectionTemplates.tenantId, input.tenantId),
          eq(inspectionTemplates.type, input.type),
          eq(inspectionTemplates.isActive, true),
        )),
      tx.insert(inspectionTemplates).values({
        id: templateId,
        tenantId: input.tenantId,
        name,
        type: input.type,
        version,
        isActive: true,
      }),
      tx.insert(inspectionTemplateItems).values(items.map((item) => ({
        ...item,
        templateId,
      }))),
      tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        tenantSequence: Date.now(),
        eventType: input.sourceTemplateId ? 'inspection_template_versioned' : 'inspection_template_created',
        actorUserId: input.userId,
        action: input.sourceTemplateId ? 'update' : 'create',
        entityType: 'inspection_template',
        entityId: templateId,
        correlationId: input.sourceTemplateId || templateId,
        summary: `${input.type} inspection template v${version} activated`,
        after: {
          name,
          type: input.type,
          version,
          itemCount: items.length,
          sourceTemplateId: input.sourceTemplateId || null,
        },
        sourceChannel: 'web',
      }),
    ]);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === '23505') {
      throw new InspectionTemplateError(
        'Another template version was activated at the same time. Reload and try again.',
        409,
      );
    }
    throw error;
  }

  const [template] = await getDb().select().from(inspectionTemplates)
    .where(and(eq(inspectionTemplates.id, templateId), eq(inspectionTemplates.tenantId, input.tenantId)))
    .limit(1);
  const createdItems = await getDb().select().from(inspectionTemplateItems)
    .where(eq(inspectionTemplateItems.templateId, templateId))
    .orderBy(inspectionTemplateItems.sortOrder);
  return { ...template, items: createdItems };
}

export async function loadInspectionTemplate(tenantId: string, id: string) {
  const db = getDb();
  const [template] = await db.select().from(inspectionTemplates).where(and(
    eq(inspectionTemplates.id, id),
    eq(inspectionTemplates.tenantId, tenantId),
  )).limit(1);
  if (!template) return null;
  const items = await db.select().from(inspectionTemplateItems)
    .where(eq(inspectionTemplateItems.templateId, id))
    .orderBy(inspectionTemplateItems.sortOrder);
  return { ...template, items };
}

export async function listInspectionTemplates(tenantId: string, type?: string | null) {
  const db = getDb();
  const conditions = [eq(inspectionTemplates.tenantId, tenantId)];
  if (type) {
    if (!['departure', 'return'].includes(type)) {
      throw new InspectionTemplateError('Type must be departure or return');
    }
    conditions.push(eq(inspectionTemplates.type, type));
  }
  const templates = await db.select().from(inspectionTemplates)
    .where(and(...conditions))
    .orderBy(desc(inspectionTemplates.updatedAt));
  return Promise.all(templates.map(async (template) => ({
    ...template,
    items: await db.select().from(inspectionTemplateItems)
      .where(eq(inspectionTemplateItems.templateId, template.id))
      .orderBy(inspectionTemplateItems.sortOrder),
  })));
}

export async function deleteUnusedInspectionTemplate(input: {
  tenantId: string;
  userId: string;
  id: string;
}) {
  const template = await loadInspectionTemplate(input.tenantId, input.id);
  if (!template) throw new InspectionTemplateError('Template not found', 404);
  if (template.isActive) {
    throw new InspectionTemplateError('Activate a replacement version before deleting this active template', 409);
  }

  const db = getDb();
  const [usage] = await db.select({ count: sql<number>`count(*)` }).from(vehicleInspections)
    .where(eq(vehicleInspections.templateId, input.id));
  if (Number(usage?.count ?? 0) > 0) {
    throw new InspectionTemplateError(
      'This template is part of inspection history and cannot be deleted',
      409,
    );
  }

  await runAtomicMutations((tx) => [
    tx.delete(inspectionTemplates).where(and(
      eq(inspectionTemplates.id, input.id),
      eq(inspectionTemplates.tenantId, input.tenantId),
      eq(inspectionTemplates.isActive, false),
    )),
    tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      tenantSequence: Date.now(),
      eventType: 'inspection_template_deleted',
      actorUserId: input.userId,
      action: 'delete',
      entityType: 'inspection_template',
      entityId: input.id,
      summary: `Unused ${template.type} inspection template v${template.version} deleted`,
      before: {
        name: template.name,
        type: template.type,
        version: template.version,
        itemCount: template.items.length,
      },
      sourceChannel: 'web',
    }),
  ]);
}
