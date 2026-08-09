import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user, account } from '@/db/schema/better-auth';
import { tenantMemberships, roleAssignments, roles, tenants } from '@/db/schema/tenants';
import { employees } from '@/db/schema/people';
import { userProfiles } from '@/db/schema/auth';
import { eq, and, inArray, count, or, isNull } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getTenantEntitlements, checkEntitlement } from '@/lib/entitlements';
import { sendReactEmail } from '@/lib/email';
import { UserInviteEmail } from '@/emails/user-invite';
import { recordAuditEvent } from '@/lib/audit-event';
import { createElement } from 'react';
import bcrypt from 'bcryptjs';

function normalizeUsername(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 64);
}

function databaseCode(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const value = error as { code?: unknown; cause?: { code?: unknown } };
  return typeof value.code === 'string'
    ? value.code
    : typeof value.cause?.code === 'string'
      ? value.cause.code
      : null;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await req.json();
    const {
      email,
      name,
      username: inputUsername,
      roleId,
      roleIds,
      employeeId,
      sendInvite,
      deliveryMode,
    } = body;

    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 });
    }
    if (!employeeId) {
      return NextResponse.json({ error: 'Select the staff member this account belongs to' }, { status: 400 });
    }

    const db = getDb();
    const now = new Date();
    const [employee] = await db
      .select({
        id: employees.id,
        userId: employees.userId,
        employmentStatus: employees.employmentStatus,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.tenantId, session.tenantId)))
      .limit(1);
    if (!employee || employee.employmentStatus !== 'active') {
      return NextResponse.json({ error: 'Active staff member not found in your organisation' }, { status: 404 });
    }
    if (employee.userId) {
      return NextResponse.json({ error: 'This staff member already has a login account' }, { status: 409 });
    }

    const displayName = typeof name === 'string' && name.trim()
      ? name.trim()
      : `${employee.firstName} ${employee.lastName}`.trim() || normalizedEmail.split('@')[0];
    const username = normalizeUsername(
      typeof inputUsername === 'string' && inputUsername.trim()
        ? inputUsername
        : displayName || normalizedEmail.split('@')[0],
    );
    if (username.length < 3) {
      return NextResponse.json({ error: 'Username must contain at least 3 valid characters' }, { status: 422 });
    }

    const [duplicateAccount] = await db
      .select({ id: user.id, email: user.email, username: user.username })
      .from(user)
      .where(or(eq(user.email, normalizedEmail), eq(user.username, username)))
      .limit(1);
    if (duplicateAccount) {
      return NextResponse.json(
        {
          error: duplicateAccount.email === normalizedEmail
            ? 'A user with this email already exists'
            : `Username "${username}" is already in use. Choose another username.`,
        },
        { status: 409 },
      );
    }

    const entitlements = await getTenantEntitlements(session.tenantId);
    if (entitlements) {
      const [countRow] = await db
        .select({ total: count() })
        .from(tenantMemberships)
        .where(and(
          eq(tenantMemberships.tenantId, session.tenantId),
          inArray(tenantMemberships.status, ['active', 'pending', 'suspended']),
        ));
      const userCheck = checkEntitlement(entitlements, 'users', countRow?.total ?? 0, 1);
      if (!userCheck.ok) {
        return NextResponse.json({ error: userCheck.message || 'User limit reached' }, { status: 409 });
      }
    }

    const requestedRoleIds = Array.isArray(roleIds) && roleIds.length > 0
      ? [...new Set(roleIds.map(String))]
      : roleId
        ? [String(roleId)]
        : [];
    const selectedRoles = requestedRoleIds.length > 0
      ? await db
          .select({ id: roles.id, name: roles.name })
          .from(roles)
          .where(and(inArray(roles.id, requestedRoleIds), eq(roles.tenantId, session.tenantId)))
      : [];
    if (selectedRoles.length !== requestedRoleIds.length) {
      return NextResponse.json({ error: 'One or more roles were not found in your organisation' }, { status: 404 });
    }

    const tempPassword = `Gf!${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const forcePasswordChange = process.env.FORCE_PASSWORD_CHANGE_ON_FIRST_LOGIN !== 'false';
    const resolvedDeliveryMode = deliveryMode === 'manual' || sendInvite === false ? 'manual' : 'email';

    await db.transaction(async (tx) => {
      await tx.insert(user).values({
        id: userId,
        email: normalizedEmail,
        username,
        name: displayName,
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(userProfiles).values({
        id: userId,
        userId,
        displayName,
        requiresPasswordChange: forcePasswordChange,
        passwordStatus: 'temporary',
        status: 'active',
        accountEnabled: true,
      });
      await tx.insert(account).values({
        id: crypto.randomUUID(),
        accountId: userId,
        providerId: 'email',
        userId,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      });

      const [membership] = await tx
        .insert(tenantMemberships)
        .values({ tenantId: session.tenantId, userId, status: 'active', joinedAt: now })
        .returning();

      const [linkedEmployee] = await tx
        .update(employees)
        .set({ userId, updatedAt: now })
        .where(and(
          eq(employees.id, employeeId),
          eq(employees.tenantId, session.tenantId),
          eq(employees.employmentStatus, 'active'),
          isNull(employees.userId),
        ))
        .returning({ id: employees.id });
      if (!linkedEmployee) {
        throw new Error('STAFF_ACCOUNT_ALREADY_LINKED');
      }

      if (selectedRoles.length > 0) {
        await tx.insert(roleAssignments).values(
          selectedRoles.map((role) => ({
            tenantMembershipId: membership.id,
            roleId: role.id,
            startDate: now,
          })),
        );
      }

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.user.id,
        eventType: 'user_account_created',
        action: 'create',
        entityType: 'user',
        entityId: userId,
        summary: `Login account created for ${displayName}`,
        after: {
          userId,
          employeeId,
          username,
          roleIds: selectedRoles.map((role) => role.id),
          deliveryMode: resolvedDeliveryMode,
        },
      }, tx);
    });

    const [tenant] = await db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, session.tenantId))
      .limit(1);
    const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://grn-fleet-system.vercel.app'}/login`;

    let emailResult: { success: boolean; error?: string; deliveredManually?: boolean } = {
      success: false,
      error: 'Email not sent',
    };
    if (resolvedDeliveryMode === 'manual') {
      emailResult = { success: false, deliveredManually: true };
    } else {
      try {
        const element = createElement(UserInviteEmail, {
          tenantName: tenant?.name || 'GovFleet Namibia',
          recipientName: displayName,
          recipientEmail: normalizedEmail,
          tempPassword,
          loginUrl,
          invitedByName: session.user.name || 'A tenant administrator',
        });
        emailResult = await sendReactEmail(
          normalizedEmail,
          `Your ${tenant?.name || 'GovFleet'} account is ready`,
          element,
        );
      } catch (error) {
        console.warn('[User Invite] Email send failed (non-fatal):', error);
        emailResult = { success: false, error: error instanceof Error ? error.message : 'Email delivery failed' };
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        id: userId,
        email: normalizedEmail,
        name: displayName,
        username,
        tempPassword,
        credentials: {
          fullName: displayName,
          username,
          email: normalizedEmail,
          tempPassword,
          roleName: selectedRoles.map((role) => role.name).join(', ') || 'No role assigned',
          loginUrl,
        },
      },
      emailSent: emailResult.success,
      emailError: emailResult.error ?? null,
    });
  } catch (error) {
    console.error('[User Invite] POST failed:', error);
    if (error instanceof Error && error.message === 'STAFF_ACCOUNT_ALREADY_LINKED') {
      return NextResponse.json({ error: 'This staff member already has a login account' }, { status: 409 });
    }
    if (databaseCode(error) === '23505') {
      return NextResponse.json({ error: 'A user with this email or username already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create user account' }, { status: 500 });
  }
}
