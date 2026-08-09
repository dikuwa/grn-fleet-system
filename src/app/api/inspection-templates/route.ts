import { NextRequest, NextResponse } from 'next/server';
import {
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  createInspectionTemplateVersion,
  InspectionTemplateError,
  listInspectionTemplates,
} from '@/lib/inspection-template-service';

async function requireTemplateManager(request: NextRequest, action: 'view' | 'create') {
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

export async function GET(request: NextRequest) {
  try {
    const auth = await requireTemplateManager(request, 'view');
    if (!auth.ok) return auth.error;
    const type = new URL(request.url).searchParams.get('type');
    const templates = await listInspectionTemplates(auth.session.tenantId, type);
    return NextResponse.json(
      { templates },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    if (error instanceof InspectionTemplateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[inspection-templates] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load inspection templates' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTemplateManager(request, 'create');
    if (!auth.ok) return auth.error;
    const body = await request.json();
    const template = await createInspectionTemplateVersion({
      tenantId: auth.session.tenantId,
      userId: auth.session.user.id,
      name: body.name,
      type: body.type,
      items: body.items,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    if (error instanceof InspectionTemplateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[inspection-templates] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create inspection template' }, { status: 500 });
  }
}
