import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { inspectionTemplates, inspectionTemplateItems } from '@/db/schema/trips';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();

    const [template] = await db
      .select()
      .from(inspectionTemplates)
      .where(
        and(
          eq(inspectionTemplates.id, id),
          eq(inspectionTemplates.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    const items = await db
      .select()
      .from(inspectionTemplateItems)
      .where(eq(inspectionTemplateItems.templateId, template.id))
      .orderBy(inspectionTemplateItems.sortOrder);

    return NextResponse.json({ template: { ...template, items } });
  } catch (error) {
    console.error('[inspection-templates/id] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to load template' },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await req.json();
    const { name, isActive, items } = body;

    const db = getDb();

    // Verify template belongs to tenant
    const [existing] = await db
      .select()
      .from(inspectionTemplates)
      .where(
        and(
          eq(inspectionTemplates.id, id),
          eq(inspectionTemplates.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Update template fields
    if (name || isActive !== undefined) {
      await db
        .update(inspectionTemplates)
        .set({
          ...(name ? { name } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(inspectionTemplates.id, id));
    }

    // Replace items if provided
    if (items) {
      // Delete existing items
      await db
        .delete(inspectionTemplateItems)
        .where(eq(inspectionTemplateItems.templateId, id));

      // Insert new items
      if (items.length > 0) {
        const itemValues = items.map(
          (
            item: { sortOrder: number; category: string; label: string; requiresPhoto?: boolean; isCritical?: boolean },
            index: number,
          ) => ({
            templateId: id,
            sortOrder: item.sortOrder ?? index,
            category: item.category,
            label: item.label,
            requiresPhoto: item.requiresPhoto ?? false,
            isCritical: item.isCritical ?? false,
          }),
        );
        await db.insert(inspectionTemplateItems).values(itemValues);
      }
    }

    // Return updated template
    const [updated] = await db
      .select()
      .from(inspectionTemplates)
      .where(eq(inspectionTemplates.id, id))
      .limit(1);

    const updatedItems = await db
      .select()
      .from(inspectionTemplateItems)
      .where(eq(inspectionTemplateItems.templateId, id))
      .orderBy(inspectionTemplateItems.sortOrder);

    return NextResponse.json({ template: { ...updated, items: updatedItems } });
  } catch (error) {
    console.error('[inspection-templates/id] PUT failed:', error);
    return NextResponse.json(
      { error: 'Failed to update template' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    // Verify template belongs to tenant
    const [existing] = await db
      .select({ id: inspectionTemplates.id })
      .from(inspectionTemplates)
      .where(
        and(
          eq(inspectionTemplates.id, id),
          eq(inspectionTemplates.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Items cascade delete, just delete the template
    await db
      .delete(inspectionTemplates)
      .where(eq(inspectionTemplates.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[inspection-templates/id] DELETE failed:', error);
    return NextResponse.json(
      { error: 'Failed to delete template' },
      { status: 500 },
    );
  }
}
