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
import { eq, and, like, desc, count, or, inArray } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import bcrypt from 'bcryptjs';
import { employees, departments, offices } from '@/db/schema/people';

// ---------------------------------------------------------------------------
// GET — List users
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    // Require platform-level or tenant-level user management
    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const status = searchParams.get('status') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '25', 10);
    const offset = (page - 1) * limit;

    const db = getDb();

    // Get all users in this tenant via memberships
    const conditions = [eq(tenantMemberships.tenantId, session.tenantId)];

    if (status === 'active') {
      conditions.push(eq(tenantMemberships.status, 'active'));
    } else if (status === 'suspended') {
      conditions.push(eq(tenantMemberships.status, 'suspended'));
    }

    // Count total matching users
    const [totalResult] = await db
      .select({ count: count() })
      .from(tenantMemberships)
      .where(and(...conditions));

    const total = totalResult?.count || 0;

    // Fetch users with their membership info
    const memberships = await db
      .select({
        userId: tenantMemberships.userId,
        membershipId: tenantMemberships.id,
        status: tenantMemberships.status,
        joinedAt: tenantMemberships.joinedAt,
      })
      .from(tenantMemberships)
      .where(and(...conditions))
      .orderBy(desc(tenantMemberships.joinedAt))
      .limit(limit)
      .offset(offset);

    if (memberships.length === 0) {
      return NextResponse.json({
        success: true,
        data: { users: [], total, page, limit, totalPages: Math.ceil(total / limit) },
      });
    }

    // Fetch user details
    const userConditions = [inArray(user.id, memberships.map((m) => m.userId))];
    if (q) {
      userConditions.push(
        or(
          like(user.email, `%${q}%`),
          like(user.name, `%${q}%`),
        )!,
      );
    }

    const users = await db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(and(...userConditions.map((c) => c!)))
      .limit(limit);

    // Fetch role assignments for each user
    const userIds = users.map((u) => u.id);
    const allAssignments = await db
      .select({
        id: roleAssignments.id,
        userId: tenantMemberships.userId,
        roleId: roleAssignments.roleId,
        roleName: roles.name,
        endDate: roleAssignments.endDate,
        isActing: roleAssignments.isActing,
      })
      .from(roleAssignments)
      .innerJoin(tenantMemberships, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(
        and(
          inArray(tenantMemberships.userId, userIds)!,
          eq(tenantMemberships.tenantId, session.tenantId)!,
        ),
      );

    // Map roles to users
    const rolesByUser: Record<string, Array<{ id: string; roleName: string; isActing: boolean }>> = {};
    for (const assignment of allAssignments) {
      if (!rolesByUser[assignment.userId]) rolesByUser[assignment.userId] = [];
      if (!assignment.endDate || new Date(assignment.endDate) > new Date()) {
        rolesByUser[assignment.userId].push({
          id: assignment.id,
          roleName: assignment.roleName,
          isActing: assignment.isActing,
        });
      }
    }

    // Merge membership status into users
    const membershipMap = new Map(memberships.map((m) => [m.userId, m]));
    const enrichedUsers = users.map((u) => {
      const membership = membershipMap.get(u.id);
      return {
        ...u,
        tenantStatus: membership?.status || 'unknown',
        joinedAt: membership?.joinedAt || null,
        roles: rolesByUser[u.id] || [],
      };
    });

    // All employees in this tenant (used for the linked-staff summary on each
    // user row) regardless of employment status — an account may stay linked to
    // an inactive or archived employee.
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

    const employeeByUser = new Map(employeeRows.filter((employee) => employee.userId).map((employee) => [employee.userId, employee]));
    const usersWithEmployees = enrichedUsers.map((tenantUser) => ({
      ...tenantUser,
      employee: employeeByUser.get(tenantUser.id) || null,
    }));

    // The invite picker only offers staff who are currently ACTIVE and do not
    // already have a login account (creating an account requires an active
    // employee record — enforced server-side in POST too).
    const availableEmployees = employeeRows.filter(
      (employee) => !employee.userId && employee.employmentStatus === 'active',
    );

    return NextResponse.json({
      success: true,
      data: {
        users: usersWithEmployees,
        availableEmployees,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
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

    // Check for duplicate email
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

    // Derive username if not provided
    const username = (inputUsername || name || email.split('@')[0])
      .toLowerCase()
      .replace(/\s+/g, '.')
      .replace(/[^a-z0-9._-]/g, '');

    // Create the user
    await db.insert(user).values({
      id: userId,
      email: email.trim().toLowerCase(),
      name: name || email.split('@')[0],
      username,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });

    // Create account with password hash
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

    // Add to tenant
    const [membership] = await db
      .insert(tenantMemberships)
      .values({
        tenantId: session.tenantId,
        userId,
        status: 'active',
        joinedAt: now,
      })
      .returning();

    // Assign role if specified
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

    // Create user profile record
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
