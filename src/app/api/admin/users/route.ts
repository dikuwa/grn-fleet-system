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
import { eq, and, like, desc, count, or, inArray, ne, type SQL } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import bcrypt from 'bcryptjs';
import { employees, departments, offices } from '@/db/schema/people';

function assignmentIsActive(
  assignment: { startDate: Date | string | null; endDate: Date | string | null },
  now = new Date(),
) {
  const startsAt = assignment.startDate ? new Date(assignment.startDate) : null;
  const endsAt = assignment.endDate ? new Date(assignment.endDate) : null;
  return (!startsAt || startsAt <= now) && (!endsAt || endsAt > now);
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

    // Search, status filtering, counting and pagination must be applied to the
    // same joined dataset. Applying text search only after membership pagination
    // misses valid matches in larger tenants and produces an incorrect total.
    const conditions: SQL[] = [eq(tenantMemberships.tenantId, session.tenantId)];
    if (status === 'active') conditions.push(eq(tenantMemberships.status, 'active'));
    else if (status === 'suspended') conditions.push(eq(tenantMemberships.status, 'suspended'));
    else if (status === 'removed') conditions.push(eq(tenantMemberships.status, 'access_removed'));
    else if (status === 'pending') conditions.push(eq(tenantMemberships.status, 'pending_activation'));
    else conditions.push(ne(tenantMemberships.status, 'access_removed'));

    if (q) {
      conditions.push(
        or(
          like(user.email, `%${q}%`),
          like(user.name, `%${q}%`),
          like(user.username, `%${q}%`),
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

    // All employees remain tenant-scoped. The account list needs linked staff
    // details for every status, while the invite picker only exposes active
    // employees without a user account.
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

    if (!email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }
    if (!password?.trim() || password.length < 6) {
      return NextResponse.json({ error: 'Password is required (min 6 characters)' }, { status: 400 });
    }
    if (!employeeId) {
      return NextResponse.json({ error: 'An employee record is required' }, { status: 400 });
    }

    const db = getDb();

    const [employee] = await db.select({ id: employees.id, userId: employees.userId })
      .from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.tenantId, session.tenantId), eq(employees.employmentStatus, 'active')))
      .limit(1);
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    if (employee.userId) return NextResponse.json({ error: 'Employee already has an account' }, { status: 409 });

    const [existingUser] = await db
      .select()
      .from(user)
      .where(eq(user.email, email.trim().toLowerCase()))
      .limit(1);

    if (existingUser) {
      return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
    }

    const userId = crypto.randomUUID?.() || `user-${Date.now()}`;
    const now = new Date();
    const username = (inputUsername || email.split('@')[0] || name)
      .toLowerCase()
      .replace(/\s+/g, '.')
      .replace(/[^a-z0-9._-]/g, '');

    const [existingUsername] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.username, username))
      .limit(1);
    if (existingUsername) {
      return NextResponse.json({ error: `Username "${username}" is already in use` }, { status: 409 });
    }

    await db.insert(user).values({
      id: userId,
      email: email.trim().toLowerCase(),
      name: name || email.split('@')[0],
      username,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });

    const passwordHash = await bcrypt.hash(password, 10);
    await db.insert(account).values({
      id: crypto.randomUUID?.() || `acct-${Date.now()}`,
      accountId: userId,
      providerId: 'email',
      userId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });

    const [membership] = await db
      .insert(tenantMemberships)
      .values({
        tenantId: session.tenantId,
        userId,
        status: 'active',
        joinedAt: now,
      })
      .returning();

    if (roleId) {
      const [role] = await db
        .select()
        .from(roles)
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, session.tenantId)))
        .limit(1);

      if (role) {
        await db.insert(roleAssignments).values({
          tenantMembershipId: membership.id,
          roleId: role.id,
          startDate: now,
        });
      }
    }

    const forcePasswordChange = process.env.FORCE_PASSWORD_CHANGE_ON_FIRST_LOGIN !== 'false';
    await db.insert(userProfiles).values({
      id: userId,
      userId,
      displayName: name || email.split('@')[0],
      requiresPasswordChange: forcePasswordChange,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();

    await db.update(employees).set({ userId, updatedAt: now }).where(eq(employees.id, employeeId));

    return NextResponse.json({
      success: true,
      data: { id: userId, email: email.trim().toLowerCase(), name: name || email.split('@')[0] },
    });
  } catch (error) {
    console.error('[Admin Users] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to create user: ' + String(error) },
      { status: 500 },
    );
  }
}
