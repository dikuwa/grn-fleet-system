import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { account, user } from '@/db/schema/better-auth';
import { userProfiles } from '@/db/schema/auth';
import { demoRequests, demoSandboxes } from '@/db/schema/demo-requests';
import { employees } from '@/db/schema/people';
import { roleAssignments, rolePermissions, roles, tenantMemberships, tenants } from '@/db/schema/tenants';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions, RoleDefinitions } from '@/lib/permissions';
import { createSubscription } from '@/lib/platform/subscriptions';
import { recordAuditEvent } from '@/lib/audit-event';

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'demo';
}

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || 'Demo',
    lastName: parts.slice(1).join(' ') || 'Administrator',
  };
}

export async function POST(request: NextRequest) {
  let createdTenantId: string | null = null;
  let createdUserId: string | null = null;

  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requirePermission(session, Permissions.DEMO_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json().catch(() => null);
    const demoRequestId = typeof body?.demoRequestId === 'string' ? body.demoRequestId : '';
    const packageId = typeof body?.packageId === 'string' ? body.packageId : '';
    const requestedDays = Number.parseInt(String(body?.expiresInDays ?? '7'), 10);
    const expiresInDays = Math.min(30, Math.max(1, Number.isFinite(requestedDays) ? requestedDays : 7));

    if (!demoRequestId || !packageId) {
      return NextResponse.json({ error: 'Demo request and sandbox package are required' }, { status: 400 });
    }

    const db = getDb();
    const [demo] = await db.select().from(demoRequests).where(eq(demoRequests.id, demoRequestId)).limit(1);
    if (!demo) return NextResponse.json({ error: 'Demo request not found' }, { status: 404 });
    if (demo.status === 'converted' || demo.status === 'cancelled') {
      return NextResponse.json({ error: `A ${demo.status} demo request cannot create a sandbox.` }, { status: 409 });
    }

    const [existingSandbox] = await db.select().from(demoSandboxes).where(eq(demoSandboxes.demoRequestId, demoRequestId)).limit(1);
    if (existingSandbox && existingSandbox.status !== 'deleted') {
      return NextResponse.json({ error: 'This demo request already has a sandbox', data: existingSandbox }, { status: 409 });
    }

    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const tenantSlug = `demo-${slugify(demo.company)}-${suffix}`.slice(0, 50);
    const tenantCode = `DM${suffix.slice(0, 6).toUpperCase()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

    const [tenant] = await db.insert(tenants).values({
      name: `${demo.company} — Demo Sandbox`,
      code: tenantCode,
      slug: tenantSlug,
      type: 'demo_sandbox',
      status: 'TRIAL',
      lifecycleStatus: 'ACTIVE',
      createdByUserId: session.user.id,
      primaryContactName: demo.name,
      primaryContactEmail: demo.email,
      primaryContactPhone: demo.phone,
      lifecycleReason: `Walkthrough sandbox for demo request ${demo.id}`,
      lifecycleChangedAt: now,
      timezone: demo.timezone || 'Africa/Windhoek',
      locale: 'en-NA',
      metadata: { isDemoSandbox: true, demoRequestId: demo.id, expiresAt: expiresAt.toISOString() },
    }).returning();
    createdTenantId = tenant.id;

    await createSubscription({
      tenantId: tenant.id,
      packageId,
      billingInterval: 'monthly',
      status: 'trialing',
      trialDays: expiresInDays,
    });

    const tenantAdminDefinition = RoleDefinitions.TENANT_ADMIN;
    const [tenantAdminRole] = await db.insert(roles).values({
      tenantId: tenant.id,
      name: tenantAdminDefinition.name,
      description: 'Demo sandbox tenant administrator',
      isSystem: true,
    }).returning();
    await db.insert(rolePermissions).values(
      tenantAdminDefinition.permissions.map((permissionCode) => ({ roleId: tenantAdminRole.id, permissionCode })),
    );

    const loginUserId = crypto.randomUUID();
    createdUserId = loginUserId;
    const username = `demo.${slugify(demo.company).replace(/-/g, '.').slice(0, 18)}.${suffix.slice(0, 4)}`;
    const loginEmail = `demo-${suffix}@govfleet.local`;
    const tempPassword = `Gf!${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await db.insert(user).values({
      id: loginUserId,
      email: loginEmail,
      username,
      emailVerified: true,
      name: demo.name,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(userProfiles).values({
      id: loginUserId,
      userId: loginUserId,
      displayName: demo.name,
      requiresPasswordChange: false,
      passwordStatus: 'temporary',
      status: 'active',
      accountEnabled: true,
    });
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: loginUserId,
      providerId: 'email',
      userId: loginUserId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });

    const [membership] = await db.insert(tenantMemberships).values({
      tenantId: tenant.id,
      userId: loginUserId,
      status: 'active',
      activeWorkspace: 'tenant_admin',
      joinedAt: now,
    }).returning();
    await db.insert(roleAssignments).values({ tenantMembershipId: membership.id, roleId: tenantAdminRole.id, startDate: now });

    const names = splitName(demo.name);
    await db.insert(employees).values({
      tenantId: tenant.id,
      employeeNumber: 'DEMO-001',
      firstName: names.firstName,
      lastName: names.lastName,
      email: demo.email,
      phone: demo.phone,
      jobTitle: demo.jobTitle,
      employmentType: 'demo',
      employmentStatus: 'active',
      availabilityStatus: 'available',
      userId: loginUserId,
      notes: 'Sandbox administrator generated from public demo request.',
    });

    const [sandbox] = await db.insert(demoSandboxes).values({
      demoRequestId: demo.id,
      tenantId: tenant.id,
      packageId,
      adminUserId: loginUserId,
      adminEmail: loginEmail,
      passwordHash,
      accessCode: suffix.toUpperCase(),
      isPasswordTemporary: true,
      status: 'active',
      isActive: true,
      expiresAt,
      metadata: { prospectEmail: demo.email, username },
    }).returning();

    await db.update(demoRequests).set({
      status: demo.status === 'new' ? 'qualified' : demo.status,
      qualifiedAt: demo.qualifiedAt ?? now,
      qualifiedByUserId: demo.qualifiedByUserId ?? session.user.id,
      contactNotes: [demo.contactNotes, `Walkthrough sandbox created. Expires ${expiresAt.toISOString()}.`].filter(Boolean).join('\n'),
      updatedAt: now,
    }).where(eq(demoRequests.id, demo.id));

    await recordAuditEvent({
      tenantId: tenant.id,
      actorUserId: session.user.id,
      eventType: 'demo_sandbox_created',
      action: 'CREATE',
      entityType: 'tenant',
      entityId: tenant.id,
      summary: `Demo sandbox created for ${demo.company}; expires ${expiresAt.toISOString()}`,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      data: {
        sandbox: { ...sandbox, passwordHash: undefined },
        tenant: { id: tenant.id, name: tenant.name, code: tenant.code, slug: tenant.slug },
        credentials: {
          username,
          email: loginEmail,
          temporaryPassword: tempPassword,
          loginUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://grn-fleet-system.vercel.app'}/login`,
          expiresAt: expiresAt.toISOString(),
        },
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[Platform Demo Sandbox] POST failed:', error);
    const db = getDb();
    if (createdTenantId) await db.delete(tenants).where(eq(tenants.id, createdTenantId)).catch(() => {});
    if (createdUserId) await db.delete(user).where(eq(user.id, createdUserId)).catch(() => {});
    return NextResponse.json({ error: 'Sandbox creation failed: ' + String(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requirePermission(session, Permissions.DEMO_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json().catch(() => null);
    const demoRequestId = typeof body?.demoRequestId === 'string' ? body.demoRequestId : '';
    const action = typeof body?.action === 'string' ? body.action : '';
    if (!demoRequestId || !['revoke', 'expire'].includes(action)) {
      return NextResponse.json({ error: 'A valid demo request and sandbox action are required' }, { status: 400 });
    }

    const db = getDb();
    const [sandbox] = await db.select().from(demoSandboxes).where(eq(demoSandboxes.demoRequestId, demoRequestId)).limit(1);
    if (!sandbox) return NextResponse.json({ error: 'Sandbox not found' }, { status: 404 });

    const nextStatus = action === 'revoke' ? 'revoked' : 'expired';
    const [updated] = await db.update(demoSandboxes).set({ status: nextStatus, isActive: false }).where(and(eq(demoSandboxes.id, sandbox.id), eq(demoSandboxes.demoRequestId, demoRequestId))).returning();
    await db.update(tenants).set({ status: 'SUSPENDED', lifecycleStatus: 'SUSPENDED', lifecycleReason: `Demo sandbox ${nextStatus}`, lifecycleChangedAt: new Date(), updatedAt: new Date() }).where(eq(tenants.id, sandbox.tenantId));

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Platform Demo Sandbox] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update sandbox' }, { status: 500 });
  }
}
