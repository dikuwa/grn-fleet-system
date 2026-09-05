/**
 * Admin User Management API
 *
 * GET  /api/admin/users          — List users in the tenant (with search, filter)
 * POST /api/admin/users          — Create a new user account
 * PATCH /api/admin/users/[id]    — Update user (status, role, profile)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user } from '@/db/schema/better-auth';
import { tenantMemberships, roleAssignments, roles } from '@/db/schema/tenants';
import { account } from '@/db/schema/better-auth';
import { userProfiles } from '@/db/schema/auth';
import { eq, and, ilike, desc, count, or, inArray, ne, isNull, type SQL } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import bcrypt from 'bcryptjs';
import { employees, departments, offices, driverProfiles } from '@/db/schema/people';
import { getTenantEntitlements } from '@/lib/entitlements';
import { recordAuditEvent } from '@/lib/audit-event';
import { checkTenantUserCapacityLocked } from '@/lib/tenant-user-capacity';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_USER_LIMIT_REACHED = 'admin_user_limit_reached';
const ADMIN_ROLE_NOT_FOUND = 'admin_role_not_found';

function assignmentIsActive(
  assignment: { startDate: Date | string | null; endDate: Date | string | null },
  now = new Date(),
) {
  const startsAt = assignment.startDate ? new Date(assignment.startDate) : null;
  const endsAt = assignment.endDate ? new Date(assignment.endDate) : null;
  return (!startsAt || startsAt <= now) && (!endsAt || endsAt > now);
}

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

// ---------------------------------------------------------------------------
// GET — List users
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const status = searchParams.get('status') || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10) || 25));
    const offset = (page - 1) * limit;
    const db = getDb();

    const conditions: SQL[] = [eq(tenantMemberships.tenantId, session.tenantId)];
    if (status === 'active') conditions.push(eq(tenantMemberships.status, 'active'));
    else if (status === 'suspended') conditions.push(eq(tenantMemberships.status, 'suspended'));
    else if (status === 'removed') conditions.push(eq(tenantMemberships.status, 'access_removed'));
    else if (status === 'pending') conditions.push(eq(tenantMemberships.status, 'pending_activation'));
    else conditions.push(ne(tenantMemberships.status, 'access_removed'));

    if (q) {
      conditions.push(
        or(
          ilike(user.email, `%${q}%`),
          ilike(user.name, `%${q}%`),
          ilike(user.username, `%${q}%`),
        )!,
      );
    }
    const where = and(...conditions);

    const [[totalResult], userRows] = await Promise.all([
      db
        .select({ count: count() })
        .from(tenantMemberships)
        .innerJoin(user, eq(tenantMemberships.userId, user.id))
        .where(where),
      db
        .select({
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          emailVerified: user.emailVerified,
          createdAt: user.createdAt,
          membershipId: tenantMemberships.id,
          tenantStatus: tenantMemberships.status,
          joinedAt: tenantMemberships.joinedAt,
        })
        .from(tenantMemberships)
        .innerJoin(user, eq(tenantMemberships.userId, user.id))
        .where(where)
        .orderBy(desc(tenantMemberships.joinedAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = Number(totalResult?.count || 0);
    const userIds = userRows.map((row) => row.id);

    const allAssignments = userIds.length
      ? await db
          .select({
            id: roleAssignments.id,
            userId: tenantMemberships.userId,
            roleId: roleAssignments.roleId,
            roleName: roles.name,
            startDate: roleAssignments.startDate,
            endDate: roleAssignments.endDate,
            isActing: roleAssignments.isActing,
          })
          .from(roleAssignments)
          .innerJoin(tenantMemberships, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
          .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
          .where(
            and(
              inArray(tenantMemberships.userId, userIds),
              eq(tenantMemberships.tenantId, session.tenantId),
            ),
          )
      : [];

    const now = new Date();
    const rolesByUser: Record<string, Array<{ id: string; roleName: string; isActing: boolean }>> = {};
    for (const assignment of allAssignments) {
      if (!assignmentIsActive(assignment, now)) continue;
      (rolesByUser[assignment.userId] ??= []).push({
        id: assignment.id,
        roleName: assignment.roleName,
        isActing: assignment.isActing,
      });
    }

    const employeeRows = await db
      .select({
        id: employees.id,
        employeeNumber: employees.employeeNumber,
        firstName: employees.firstName,
        lastName: employees.lastName,
        email: employees.email,
        userId: employees.userId,
        employmentStatus: employees.employmentStatus,
        departmentName: departments.name,
        officeName: offices.name,
      })
      .from(employees)
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .leftJoin(offices, eq(employees.officeId, offices.id))
      .where(eq(employees.tenantId, session.tenantId));

    const employeeByUser = new Map(
      employeeRows
        .filter((employee): employee is typeof employee & { userId: string } => Boolean(employee.userId))
        .map((employee) => [employee.userId, employee]),
    );

    const users = userRows.map((row) => ({
      id: row.id,
      email: row.email,
      username: row.username,
      name: row.name,
      emailVerified: row.emailVerified,
      createdAt: row.createdAt,
      tenantStatus: row.tenantStatus,
      joinedAt: row.joinedAt,
      roles: rolesByUser[row.id] || [],
      employee: employeeByUser.get(row.id) || null,
    }));

    const availableEmployees = employeeRows.filter(
      (employee) => !employee.userId && employee.employmentStatus === 'active',
    );

    return NextResponse.json({
      success: true,
      data: {
        users,
        availableEmployees,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error('[Admin Users] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to list users: ' + String(error) },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — Create a new user
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { email, name, password, roleId, employeeId, username: inputUsername } = body;
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'Password is required (minimum 8 characters)' }, { status: 400 });
    }
    if (!employeeId) {
      return NextResponse.json({ error: 'An employee record is required' }, { status: 400 });
    }
    if (typeof employeeId !== 'string' || !UUID_PATTERN.test(employeeId)) {
      return NextResponse.json({ error: 'Active employee not found' }, { status: 404 });
    }

    const db = getDb();
    const [employee] = await db
      .select({
        id: employees.id,
        userId: employees.userId,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(employees)
      .where(
        and(
          eq(employees.id, employeeId),
          eq(employees.tenantId, session.tenantId),
          eq(employees.employmentStatus, 'active'),
        ),
      )
      .limit(1);
    if (!employee) return NextResponse.json({ error: 'Active employee not found' }, { status: 404 });
    if (employee.userId) return NextResponse.json({ error: 'Employee already has an account' }, { status: 409 });

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

    const [existingUser] = await db
      .select({ id: user.id, email: user.email, username: user.username })
      .from(user)
      .where(or(eq(user.email, normalizedEmail), eq(user.username, username)))
      .limit(1);
    if (existingUser) {
      return NextResponse.json(
        { error: existingUser.email === normalizedEmail ? 'A user with this email already exists' : `Username "${username}" is already in use` },
        { status: 409 },
      );
    }

    const entitlements = await getTenantEntitlements(session.tenantId);
    const userId = crypto.randomUUID();
    const now = new Date();
    const passwordHash = await bcrypt.hash(password, 10);
    const forcePasswordChange = process.env.FORCE_PASSWORD_CHANGE_ON_FIRST_LOGIN !== 'false';

    await db.transaction(async (tx) => {
      if (entitlements) {
        const userCheck = await checkTenantUserCapacityLocked(
          tx,
          session.tenantId,
          entitlements,
          1,
        );
        if (!userCheck.ok) {
          throw new Error(`${ADMIN_USER_LIMIT_REACHED}:${userCheck.message || 'User limit reached'}`);
        }
      }

      if (roleId && (typeof roleId !== 'string' || !UUID_PATTERN.test(roleId))) {
        throw new Error(ADMIN_ROLE_NOT_FOUND);
      }
      const selectedRole = roleId
        ? (await tx
            .select({ id: roles.id, name: roles.name })
            .from(roles)
            .where(and(eq(roles.id, roleId), eq(roles.tenantId, session.tenantId)))
            .limit(1))[0]
        : null;
      if (roleId && !selectedRole) {
        throw new Error(ADMIN_ROLE_NOT_FOUND);
      }

      await tx.insert(user).values({
        id: userId,
        email: normalizedEmail,
        name: displayName,
        username,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
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

      await tx.insert(userProfiles).values({
        id: userId,
        userId,
        displayName,
        requiresPasswordChange: forcePasswordChange,
        passwordStatus: 'temporary',
        status: 'active',
        accountEnabled: true,
        createdAt: now,
        updatedAt: now,
      });

      const [membership] = await tx
        .insert(tenantMemberships)
        .values({
          tenantId: session.tenantId,
          userId,
          status: 'active',
          joinedAt: now,
        })
        .returning();

      const [linkedEmployee] = await tx
        .update(employees)
        .set({ userId, updatedAt: now })
        .where(
          and(
            eq(employees.id, employeeId),
            eq(employees.tenantId, session.tenantId),
            eq(employees.employmentStatus, 'active'),
            isNull(employees.userId),
          ),
        )
        .returning({ id: employees.id });
      if (!linkedEmployee) throw new Error('STAFF_ACCOUNT_ALREADY_LINKED');

      if (selectedRole) {
        await tx.insert(roleAssignments).values({
          tenantMembershipId: membership.id,
          roleId: selectedRole.id,
          startDate: now,
        });

        if (selectedRole.name === 'Assigned Driver') {
          const [existingProfile] = await tx
            .select({ id: driverProfiles.id })
            .from(driverProfiles)
            .where(eq(driverProfiles.employeeId, employee.id))
            .limit(1);
          if (!existingProfile) {
            await tx.insert(driverProfiles).values({
              employeeId: employee.id,
              driverStatus: 'pending_verification',
              availabilityStatus: 'unavailable',
              notes: 'Auto-provisioned from Assigned Driver role. Licence verification is required before operational assignment.',
            });
          }
          await tx.update(employees).set({ isDriver: true, updatedAt: now }).where(eq(employees.id, employee.id));
        }
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
          roleId: selectedRole?.id ?? null,
          roleName: selectedRole?.name ?? null,
          source: 'admin_users_api',
        },
      }, tx);
    });

    return NextResponse.json({
      success: true,
      data: { id: userId, email: normalizedEmail, name: displayName, username },
    }, { status: 201 });
  } catch (error) {
    console.error('[Admin Users] POST failed:', error);
    if (error instanceof Error && error.message.startsWith(`${ADMIN_USER_LIMIT_REACHED}:`)) {
      return NextResponse.json(
        { error: error.message.slice(ADMIN_USER_LIMIT_REACHED.length + 1) },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message === ADMIN_ROLE_NOT_FOUND) {
      return NextResponse.json({ error: 'Role not found in your organisation' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'STAFF_ACCOUNT_ALREADY_LINKED') {
      return NextResponse.json({ error: 'Employee already has an account' }, { status: 409 });
    }
    if (databaseCode(error) === '23505') {
      return NextResponse.json({ error: 'A user with this email or username already exists' }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'Failed to create user account' },
      { status: 500 },
    );
  }
}
