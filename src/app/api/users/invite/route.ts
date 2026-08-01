import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user } from '@/db/schema/better-auth';
import { account } from '@/db/schema/better-auth';
import { tenantMemberships, roleAssignments, roles } from '@/db/schema/tenants';
import { employees } from '@/db/schema/people';
import { userProfiles } from '@/db/schema/auth';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, inArray } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { sendReactEmail } from '@/lib/email';
import { UserInviteEmail } from '@/emails/user-invite';
import { createElement } from 'react';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await req.json();
    const { email, name, username: inputUsername, roleId, roleIds, employeeId, sendInvite, deliveryMode } = body;

    if (!email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }
    if (!employeeId) {
      return NextResponse.json({ error: 'Select the staff member this account belongs to' }, { status: 400 });
    }

    const db = getDb();
    const now = new Date();

    const [employee] = await db
      .select({ id: employees.id, userId: employees.userId, employmentStatus: employees.employmentStatus })
      .from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.tenantId, session.tenantId)))
      .limit(1);
    if (!employee || employee.employmentStatus !== 'active') {
      return NextResponse.json({ error: 'Active staff member not found in your organisation' }, { status: 404 });
    }
    if (employee.userId) {
      return NextResponse.json({ error: 'This staff member already has a login account' }, { status: 409 });
    }

    // Multi-role support: accept roleIds[] (preferred) with roleId kept for
    // backward compatibility. All roles must belong to this tenant.
    const requestedRoleIds = Array.isArray(roleIds) && roleIds.length > 0
      ? [...new Set(roleIds.map(String))]
      : (roleId ? [String(roleId)] : []);

    const selectedRoles = requestedRoleIds.length > 0
      ? await db
          .select({ id: roles.id, name: roles.name })
          .from(roles)
          .where(and(inArray(roles.id, requestedRoleIds), eq(roles.tenantId, session.tenantId)))
      : [];
    if (selectedRoles.length !== requestedRoleIds.length) {
      return NextResponse.json({ error: 'One or more roles were not found in your organisation' }, { status: 404 });
    }

    // Check for duplicate email
    const [existingUser] = await db
      .select()
      .from(user)
      .where(eq(user.email, email.trim().toLowerCase()))
      .limit(1);

    if (existingUser) {
      return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
    }

    // Generate a secure temporary password
    const tempPassword = crypto.randomUUID?.()?.replace(/-/g, '').slice(0, 12) || `Fleet${Date.now()}`;

    const userId = crypto.randomUUID?.() || `user-${Date.now()}`;
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // Create the user
    await db.insert(user).values({
      id: userId,
      email: email.trim().toLowerCase(),
      name: name || email.split('@')[0],
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    });

    const forcePasswordChange = process.env.FORCE_PASSWORD_CHANGE_ON_FIRST_LOGIN !== 'false';
    await db.insert(userProfiles).values({
      id: userId,
      userId,
      displayName: name || email.split('@')[0],
      requiresPasswordChange: forcePasswordChange,
      status: 'active',
    });

    // Create account with password
    await db.insert(account).values({
      id: crypto.randomUUID?.() || `acct-${Date.now()}`,
      accountId: userId,
      providerId: 'email',
      userId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });

    // Add to tenant membership
    const [membership] = await db
      .insert(tenantMemberships)
      .values({
        tenantId: session.tenantId,
        userId,
        status: 'active',
        joinedAt: now,
      })
      .returning();

    // Link to employee if specified
    await db
      .update(employees)
      .set({ userId, updatedAt: now })
      .where(and(eq(employees.id, employeeId), eq(employees.tenantId, session.tenantId)));

    // Assign all selected roles
    if (selectedRoles.length > 0) {
      await db.insert(roleAssignments).values(
        selectedRoles.map((r) => ({
          tenantMembershipId: membership.id,
          roleId: r.id,
          startDate: now,
        })),
      );
    }

    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: Date.now(),
      eventType: 'user_account_created',
      actorUserId: session.user.id,
      action: 'create',
      entityType: 'user',
      entityId: employeeId,
      summary: `Login account created for staff member ${employeeId}`,
      after: { userId, employeeId, roleIds: selectedRoles.map((r) => r.id) },
    });

    // Send invitation email unless the admin chose to hand over credentials
    // manually. deliveryMode 'manual' means the admin will share the temp
    // password themselves; any other value (or the legacy sendInvite flag)
    // triggers the email.
    let emailResult: { success: boolean; error?: string; deliveredManually?: boolean } = { success: false, error: 'Email not sent' };
    if (deliveryMode === 'manual' || sendInvite === false) {
      emailResult = { success: false, deliveredManually: true };
    } else {
      const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://grn-fleet-system.vercel.app'}/login`;

      try {
        const element = createElement(UserInviteEmail, {
          tenantName: 'GovFleet Namibia',
          recipientName: name || email.split('@')[0],
          recipientEmail: email.trim().toLowerCase(),
          tempPassword,
          loginUrl,
          invitedByName: session.user.name || 'A system administrator',
        });

        const result = await sendReactEmail(
          email.trim().toLowerCase(),
          '🎉 Your Account Has Been Created — GovFleet Namibia',
          element,
        );
        emailResult = result;
      } catch (err) {
        console.warn('[User Invite] Email send failed (non-fatal):', err);
        emailResult = { success: false, error: String(err) };
      }
    }

    // Derive username from the form or auto-generate from name/email
    const username = (inputUsername || name || email.split('@')[0])
      .toLowerCase()
      .replace(/\s+/g, '.')
      .replace(/[^a-z0-9._-]/g, '');

    // Store username in the user record
    await db
      .update(user)
      .set({ username, updatedAt: now })
      .where(eq(user.id, userId));

    // Build the credential response (always return it regardless of sendInvite)
    const credentialResponse = {
      fullName: name || email.split('@')[0],
      username,
      email: email.trim().toLowerCase(),
      tempPassword,
      roleName: selectedRoles.map((r) => r.name).join(', ') || 'No role assigned',
      loginUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://grn-fleet-system.vercel.app'}/login`,
    };

    return NextResponse.json({
      success: true,
      data: {
        id: userId,
        email: email.trim().toLowerCase(),
        name: name || email.split('@')[0],
        username,
        tempPassword, // Always return the temp password
        credentials: credentialResponse, // Always return credentials
      },
      emailSent: emailResult.success,
      emailError: emailResult.error ?? null,
    });
  } catch (error) {
    console.error('[User Invite] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to invite user: ' + String(error) },
      { status: 500 },
    );
  }
}
