import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { and, count, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { account, user } from '@/db/schema/better-auth';
import { userProfiles } from '@/db/schema/auth';
import { roleAssignments, rolePermissions, roles, tenantMemberships } from '@/db/schema/tenants';
import { getSessionRoleNames, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  PlatformSystemRoles,
  SystemRoles,
  WorkspaceIds,
  type PlatformSystemRole,
} from '@/lib/workspaces';
import { PLATFORM_ROLE_PERMISSIONS } from '@/lib/role-metadata';
import { recordAuditEvent } from '@/lib/audit-event';

async function requirePlatformAdmin(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth;
  const permission = await requirePermission(auth.session, Permissions.PLATFORM_ADMIN);
  if (permission instanceof NextResponse) return { ok: false as const, error: permission };
  const roleNames = await getSessionRoleNames(auth.session);
  if (!roleNames.includes(SystemRoles.PLATFORM_ADMIN)) {
    return {
      ok: false as const,
      error: NextResponse.json(
        { error: 'Only a Platform Super Administrator can manage platform access.' },
        { status: 403 },
      ),
    };
  }
  return auth;
}

async function ensurePlatformRole(tenantId: string, roleName: PlatformSystemRole) {
  const db = getDb();
  let [role] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.name, roleName)))
    .limit(1);

  if (!role) {
    [role] = await db
      .insert(roles)
      .values({
        tenantId,
        name: roleName,
        description: `${roleName} system role`,
        isSystem: true,
      })
      .returning();
  }

  await db
    .insert(rolePermissions)
    .values(
      (PLATFORM_ROLE_PERMISSIONS[roleName] ?? []).map((permissionCode) => ({
        roleId: role.id,
        permissionCode,
      })),
    )
    .onConflictDoNothing();

  return role;
}

async function activeSuperAdminCount(tenantId: string) {
  const db = getDb();
  const [row] = await db
    .select({ count: count() })
    .from(roleAssignments)
    .innerJoin(tenantMemberships, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
    .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
    .where(
      and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.status, 'active'),
        eq(roles.name, SystemRoles.PLATFORM_ADMIN),
      ),
    );
  return Number(row?.count ?? 0);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePlatformAdmin(request);
    if (!auth.ok) return auth.error;
    const db = getDb();

    const memberships = await db
      .select({
        membershipId: tenantMemberships.id,
        userId: tenantMemberships.userId,
        status: tenantMemberships.status,
        joinedAt: tenantMemberships.joinedAt,
        roleId: roles.id,
        roleName: roles.name,
      })
      .from(tenantMemberships)
      .innerJoin(roleAssignments, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(
        and(
          eq(tenantMemberships.tenantId, auth.session.tenantId),
          inArray(roles.name, [...PlatformSystemRoles]),
        ),
      );

    const userIds = Array.from(new Set(memberships.map((membership) => membership.userId)));
    const users = userIds.length
      ? await db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            username: user.username,
            createdAt: user.createdAt,
          })
          .from(user)
          .where(inArray(user.id, userIds))
      : [];

    const membershipByUser = new Map(
      memberships.map((membership) => [membership.userId, membership]),
    );
    const rows = users.map((platformUser) => ({
      ...platformUser,
      membershipId: membershipByUser.get(platformUser.id)?.membershipId ?? null,
      status: membershipByUser.get(platformUser.id)?.status ?? 'unknown',
      roleId: membershipByUser.get(platformUser.id)?.roleId ?? null,
      roleName: membershipByUser.get(platformUser.id)?.roleName ?? null,
      joinedAt: membershipByUser.get(platformUser.id)?.joinedAt ?? null,
      isCurrentUser: platformUser.id === auth.session.user.id,
    }));

    return NextResponse.json({
      success: true,
      data: {
        users: rows,
        roles: PlatformSystemRoles.map((name) => ({ name })),
        activeSuperAdmins: await activeSuperAdminCount(auth.session.tenantId),
      },
    });
  } catch (error) {
    console.error('[Platform Users] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load platform users' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePlatformAdmin(request);
    if (!auth.ok) return auth.error;
    const body = await request.json().catch(() => null);
    const email = String(body?.email ?? '')
      .trim()
      .toLowerCase();
    const name = String(body?.name ?? '').trim();
    const roleName = String(body?.roleName ?? '') as PlatformSystemRole;

    if (!email || !name || !PlatformSystemRoles.includes(roleName)) {
      return NextResponse.json(
        { error: 'Name, email and a valid platform role are required.' },
        { status: 400 },
      );
    }

    const db = getDb();
    const [existing] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);
    if (existing)
      return NextResponse.json(
        { error: 'A user with this email already exists.' },
        { status: 409 },
      );

    const now = new Date();
    const userId = crypto.randomUUID();
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 5);
    const usernameBase =
      email
        .split('@')[0]
        .replace(/[^a-z0-9._-]/gi, '')
        .toLowerCase() || 'platform.user';
    const username = `${usernameBase}.${suffix}`.slice(0, 48);
    const temporaryPassword = `Gf!${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const role = await ensurePlatformRole(auth.session.tenantId, roleName);

    await db.insert(user).values({
      id: userId,
      email,
      username,
      name,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: 'email',
      userId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(userProfiles).values({
      id: userId,
      userId,
      displayName: name,
      requiresPasswordChange: true,
      passwordStatus: 'temporary',
      status: 'active',
      accountEnabled: true,
      createdAt: now,
      updatedAt: now,
    });
    const [membership] = await db
      .insert(tenantMemberships)
      .values({
        tenantId: auth.session.tenantId,
        userId,
        status: 'active',
        activeWorkspace: WorkspaceIds.PLATFORM_ADMIN,
        joinedAt: now,
      })
      .returning();
    await db
      .insert(roleAssignments)
      .values({ tenantMembershipId: membership.id, roleId: role.id, startDate: now });

    await recordAuditEvent({
      tenantId: auth.session.tenantId,
      actorUserId: auth.session.user.id,
      eventType: 'platform_user_created',
      action: 'create',
      entityType: 'platform_user',
      entityId: userId,
      after: { name, email, roleName },
      summary: `Platform user created: ${name} (${email}) as ${roleName}`,
    });

    return NextResponse.json(
      {
        success: true,
        data: { id: userId, name, email, username, roleName, temporaryPassword },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('[Platform Users] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create platform user' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requirePlatformAdmin(request);
    if (!auth.ok) return auth.error;
    const body = await request.json().catch(() => null);
    const userId = String(body?.userId ?? '');
    const nextStatus = body?.status ? String(body.status) : null;
    const roleName = body?.roleName ? (String(body.roleName) as PlatformSystemRole) : null;
    if (!userId) return NextResponse.json({ error: 'Platform user is required.' }, { status: 400 });

    const db = getDb();
    const [membership] = await db
      .select({ id: tenantMemberships.id, status: tenantMemberships.status })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, auth.session.tenantId),
          eq(tenantMemberships.userId, userId),
        ),
      )
      .limit(1);
    if (!membership)
      return NextResponse.json({ error: 'Platform user membership not found.' }, { status: 404 });

    const [currentRole] = await db
      .select({ name: roles.name })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(
        and(
          eq(roleAssignments.tenantMembershipId, membership.id),
          inArray(roles.name, [...PlatformSystemRoles]),
        ),
      )
      .limit(1);

    const removesSuperAdmin =
      currentRole?.name === SystemRoles.PLATFORM_ADMIN &&
      ((roleName && roleName !== SystemRoles.PLATFORM_ADMIN) ||
        (nextStatus && nextStatus !== 'active'));
    if (removesSuperAdmin && (await activeSuperAdminCount(auth.session.tenantId)) <= 1) {
      return NextResponse.json(
        { error: 'At least one active Platform Super Administrator must remain.' },
        { status: 409 },
      );
    }

    if (userId === auth.session.user.id && nextStatus && nextStatus !== 'active') {
      return NextResponse.json(
        { error: 'You cannot disable your own active platform access.' },
        { status: 409 },
      );
    }

    if (nextStatus) {
      if (!['active', 'suspended'].includes(nextStatus)) {
        return NextResponse.json({ error: 'Invalid platform user status.' }, { status: 400 });
      }
      await db
        .update(tenantMemberships)
        .set({ status: nextStatus })
        .where(eq(tenantMemberships.id, membership.id));
    }

    if (roleName) {
      if (!PlatformSystemRoles.includes(roleName)) {
        return NextResponse.json({ error: 'Invalid platform role.' }, { status: 400 });
      }
      const role = await ensurePlatformRole(auth.session.tenantId, roleName);
      await db.delete(roleAssignments).where(eq(roleAssignments.tenantMembershipId, membership.id));
      await db
        .insert(roleAssignments)
        .values({ tenantMembershipId: membership.id, roleId: role.id, startDate: new Date() });
    }

    if (nextStatus || roleName) {
      const [platformUserRow] = await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      await recordAuditEvent({
        tenantId: auth.session.tenantId,
        actorUserId: auth.session.user.id,
        eventType: 'platform_user_updated',
        action: 'update',
        entityType: 'platform_user',
        entityId: userId,
        before: { roleName: currentRole?.name ?? null, status: membership.status },
        after: {
          roleName: roleName ?? currentRole?.name ?? null,
          status: nextStatus ?? membership.status,
        },
        summary: `Platform access updated for ${platformUserRow?.email ?? userId}`,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Platform Users] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update platform user' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requirePlatformAdmin(request);
    if (!auth.ok) return auth.error;
    const userId = new URL(request.url).searchParams.get('userId') ?? '';
    if (!userId) return NextResponse.json({ error: 'Platform user is required.' }, { status: 400 });
    if (userId === auth.session.user.id) {
      return NextResponse.json(
        { error: 'You cannot remove your own platform access.' },
        { status: 409 },
      );
    }

    const db = getDb();
    const [membership] = await db
      .select({ id: tenantMemberships.id, status: tenantMemberships.status })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, auth.session.tenantId),
          eq(tenantMemberships.userId, userId),
        ),
      )
      .limit(1);
    if (!membership)
      return NextResponse.json({ error: 'Platform user membership not found.' }, { status: 404 });

    const [currentRole] = await db
      .select({ name: roles.name })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(
        and(
          eq(roleAssignments.tenantMembershipId, membership.id),
          inArray(roles.name, [...PlatformSystemRoles]),
        ),
      )
      .limit(1);

    if (
      currentRole?.name === SystemRoles.PLATFORM_ADMIN &&
      (await activeSuperAdminCount(auth.session.tenantId)) <= 1
    ) {
      return NextResponse.json(
        { error: 'The final Platform Super Administrator cannot be removed.' },
        { status: 409 },
      );
    }

    await db.delete(roleAssignments).where(eq(roleAssignments.tenantMembershipId, membership.id));
    await db
      .update(tenantMemberships)
      .set({ status: 'access_removed' })
      .where(eq(tenantMemberships.id, membership.id));

    const [platformUserRow] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    await recordAuditEvent({
      tenantId: auth.session.tenantId,
      actorUserId: auth.session.user.id,
      eventType: 'platform_user_removed',
      action: 'delete',
      entityType: 'platform_user',
      entityId: userId,
      before: { roleName: currentRole?.name ?? null, status: membership.status },
      after: { status: 'access_removed' },
      summary: `Platform access removed for ${platformUserRow?.email ?? userId}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Platform Users] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to remove platform access' }, { status: 500 });
  }
}
