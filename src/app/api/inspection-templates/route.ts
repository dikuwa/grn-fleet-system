import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { inspectionTemplates, inspectionTemplateItems } from '@/db/schema/trips';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, desc } from 'drizzle-orm';

/**
 * GET /api/inspection-templates
 * List all inspection templates for the tenant, optionally filtered by type.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type'); // departure, return

    const db = getDb();
    const conditions = [eq(inspectionTemplates.tenantId, session.tenantId)];
    if (type) conditions.push(eq(inspectionTemplates.type, type));

    const templates = await db
      .select()
      .from(inspectionTemplates)
      .where(and(...conditions))
      .orderBy(desc(inspectionTemplates.updatedAt));

    // Fetch items for each template
    const templatesWithItems = await Promise.all(
      templates.map(async (tpl) => {
        const items = await db
          .select()
          .from(inspectionTemplateItems)
          .where(eq(inspectionTemplateItems.templateId, tpl.id))
          .orderBy(inspectionTemplateItems.sortOrder);
        return { ...tpl, items };
      }),
    );

    return NextResponse.json({ templates: templatesWithItems });
  } catch (error) {
    console.error('[inspection-templates] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to load inspection templates' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/inspection-templates
 * Create a new inspection template with optional items.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await req.json();
    const { name, type, items } = body;

    if (!name || !type) {
      return NextResponse.json(
        { error: 'Template name and type are required' },
        { status: 400 },
      );
    }

    if (!['departure', 'return'].includes(type)) {
      return NextResponse.json(
        { error: 'Type must be departure or return' },
        { status: 400 },
      );
    }

    const db = getDb();

    // Create the template
    const [template] = await db
      .insert(inspectionTemplates)
      .values({
        tenantId: session.tenantId,
        name,
        type,
        version: 1,
        isActive: true,
      })
      .returning();

    // Create items if provided
    if (items?.length > 0) {
      const itemValues = items.map(
        (
          item: { sortOrder: number; category: string; label: string; requiresPhoto?: boolean; isCritical?: boolean },
          index: number,
        ) => ({
          templateId: template.id,
          sortOrder: item.sortOrder ?? index,
          category: item.category,
          label: item.label,
          requiresPhoto: item.requiresPhoto ?? false,
          isCritical: item.isCritical ?? false,
        }),
      );
      await db.insert(inspectionTemplateItems).values(itemValues);
    }

    // Fetch the created template with items
    const createdItems = await db
      .select()
      .from(inspectionTemplateItems)
      .where(eq(inspectionTemplateItems.templateId, template.id))
      .orderBy(inspectionTemplateItems.sortOrder);

    return NextResponse.json({ template: { ...template, items: createdItems } }, { status: 201 });
  } catch (error) {
    console.error('[inspection-templates] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to create inspection template' },
      { status: 500 },
    );
  }
}
