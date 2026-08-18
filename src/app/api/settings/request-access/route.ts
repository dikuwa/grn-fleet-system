import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { tenants } from '@/db/schema/tenants';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  readPublicEmployeeRequestConfig,
  writePublicEmployeeRequestConfig,
} from '@/lib/public-request-access';
import { recordAuditEvent } from '@/lib/audit-event';
import { hasEnvVar } from '@/env';

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const permission = await requirePermission(auth.session, Permissions.TENANT_VIEW);
  if (permission instanceof NextResponse) return permission;

  const db = getDb();
  const [tenant] = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug, metadata: tenants.metadata })
    .from(tenants)
    .where(eq(tenants.id, auth.session.tenantId))
    .limit(1);
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

  const config = readPublicEmployeeRequestConfig(tenant.metadata);
  return NextResponse.json({
    success: true,
    data: {
      tenantName: tenant.name,
      slug: tenant.slug,
      enabled: config.enabled,
      path: `/request/${tenant.slug}`,
      emailOtpConfigured: hasEnvVar('RESEND_API_KEY'),
      verificationFallback: 'staff_directory',
    },
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
  if (permission instanceof NextResponse) return permission;

  const body = (await request.json()) as { enabled?: unknown };
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Enabled must be true or false.' }, { status: 422 });
  }

  const db = getDb();
  const [tenant] = await db
    .select({ id: tenants.id, slug: tenants.slug, metadata: tenants.metadata })
    .from(tenants)
    .where(eq(tenants.id, auth.session.tenantId))
    .limit(1);
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

  const metadata = writePublicEmployeeRequestConfig(tenant.metadata, body.enabled);
  await db
    .update(tenants)
    .set({ metadata, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  await recordAuditEvent({
    tenantId: tenant.id,
    actorUserId: auth.session.user.id,
    action: 'tenant.public_employee_requests_updated',
    entityType: 'tenant',
    entityId: tenant.id,
    summary: body.enabled
      ? 'Public employee transport requests enabled'
      : 'Public employee transport requests disabled',
    after: { enabled: body.enabled, path: `/request/${tenant.slug}` },
  });

  return NextResponse.json({ success: true, data: { enabled: body.enabled } });
}
