import { NextRequest, NextResponse } from 'next/server';
import {
  ACTIVE_TENANT_COOKIE,
  getSessionIdentityFromRequest,
  getUserTenantChoices,
} from '@/lib/session';
import { recordAuditEvent } from '@/lib/audit-event';

const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function setTenantCookie(response: NextResponse, tenantId: string) {
  response.cookies.set(ACTIVE_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export async function GET(request: NextRequest) {
  const identity = await getSessionIdentityFromRequest(request);
  if (!identity) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const tenants = await getUserTenantChoices(identity.id);
  const requestedTenantId = request.cookies.get(ACTIVE_TENANT_COOKIE)?.value ?? null;
  const activeTenantId = tenants.some((tenant) => tenant.id === requestedTenantId)
    ? requestedTenantId
    : tenants.length === 1
      ? tenants[0]!.id
      : null;

  return NextResponse.json({ success: true, data: { tenants, activeTenantId } });
}

export async function POST(request: NextRequest) {
  const identity = await getSessionIdentityFromRequest(request);
  if (!identity) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId : '';
  if (!tenantId) {
    return NextResponse.json({ error: 'Organisation is required' }, { status: 400 });
  }

  const choices = await getUserTenantChoices(identity.id);
  const selected = choices.find((tenant) => tenant.id === tenantId);
  if (!selected) {
    return NextResponse.json({ error: 'You do not have active access to this organisation' }, { status: 403 });
  }

  const response = NextResponse.json({
    success: true,
    data: {
      tenant: selected,
      tenantCount: choices.length,
    },
  });
  setTenantCookie(response, selected.id);

  await recordAuditEvent({
    tenantId: selected.id,
    actorUserId: identity.id,
    eventType: 'tenant_context_selected',
    action: 'select',
    entityType: 'tenant',
    entityId: selected.id,
    summary: `Active organisation changed to ${selected.name}`,
    after: { tenantId: selected.id, tenantSlug: selected.slug },
  }).catch(() => undefined);

  return response;
}
