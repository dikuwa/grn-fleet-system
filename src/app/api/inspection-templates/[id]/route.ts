import { NextRequest, NextResponse } from 'next/server';
import {
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  createInspectionTemplateVersion,
  deleteUnusedInspectionTemplate,
  InspectionTemplateError,
  loadInspectionTemplate,
} from '@/lib/inspection-template-service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireTemplateManager(
  request: NextRequest,
  action: 'view' | 'update' | 'delete',
) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth;
  const routeCheck = await requireDashboardAction(
    auth.session,
    '/dashboard/inspections/templates',
    action,
  );
  if (routeCheck instanceof NextResponse) return { ok: false as const, error: routeCheck };
  const permissionCheck = await requirePermission(auth.session, Permissions.VEHICLE_MANAGE);
  if (permissionCheck instanceof NextResponse) return { ok: false as const, error: permissionCheck };
  return auth;
}

function malformedTemplateIdResponse(id: string) {
  return UUID_PATTERN.test(id)
    ? null
    : NextResponse.json({ error: 'Template not found' }, { status: 404 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireTemplateManager(request, 'view');
    if (!auth.ok) return auth.error;
    const { id } = await params;
    const malformedId = malformedTemplateIdResponse(id);
    if (malformedId) return malformedId;
    const template = await loadInspectionTemplate(auth.session.tenantId, id);
    if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    return NextResponse.json(
      { template },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('[inspection-templates/id] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load template' }, { status: 500 });
  }
}

/**
 * Editing a template creates and activates a new immutable version. Historical
 * inspections keep referencing the old template/item rows unchanged.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireTemplateManager(request, 'update');
    if (!auth.ok) return auth.error;
    const { id } = await params;
    const malformedId = malformedTemplateIdResponse(id);
    if (malformedId) return malformedId;
    const existing = await loadInspectionTemplate(auth.session.tenantId, id);
    if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid inspection template payload' }, { status: 422 });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return NextResponse.json({ error: 'Invalid inspection template payload' }, { status: 422 });
    }
    const body = payload as Record<string, unknown>;
    if (
      (body.name !== undefined && typeof body.name !== 'string') ||
      (body.items !== undefined && !Array.isArray(body.items))
    ) {
      return NextResponse.json({ error: 'Invalid inspection template payload' }, { status: 422 });
    }

    const template = await createInspectionTemplateVersion({
      tenantId: auth.session.tenantId,
      userId: auth.session.user.id,
      name: typeof body.name === 'string' ? body.name : existing.name,
      type: existing.type,
      items: Array.isArray(body.items) ? body.items : existing.items,
      sourceTemplateId: existing.id,
    });
    return NextResponse.json({ template });
  } catch (error) {
    if (error instanceof InspectionTemplateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[inspection-templates/id] PUT failed:', error);
    return NextResponse.json({ error: 'Failed to create template version' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireTemplateManager(request, 'delete');
    if (!auth.ok) return auth.error;
    const { id } = await params;
    const malformedId = malformedTemplateIdResponse(id);
    if (malformedId) return malformedId;
    await deleteUnusedInspectionTemplate({
      tenantId: auth.session.tenantId,
      userId: auth.session.user.id,
      id,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof InspectionTemplateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[inspection-templates/id] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 });
  }
}
