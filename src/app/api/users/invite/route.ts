import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user } from '@/db/schema/better-auth';
import { account } from '@/db/schema/better-auth';
import { tenantMemberships, roleAssignments, roles } from '@/db/schema/tenants';
import { employees } from '@/db/schema/people';
import { eq, and } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { sendNotificationEmail } from '@/lib/email';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await req.json();
    const { email, name, roleId, employeeId, sendInvite } = body;

    if (!email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const db = getDb();
    const now = new Date();

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
    if (employeeId) {
      await db
        .update(employees)
        .set({ userId, updatedAt: now })
        .where(
          and(
            eq(employees.id, employeeId),
            eq(employees.tenantId, session.tenantId),
          ),
        );
    }

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

    // Send invitation email if requested
    let emailResult: { success: boolean; error?: string } = { success: false, error: 'Email not sent' };
    if (sendInvite) {
      const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://grn-fleet-system.vercel.app'}/login`;

      try {
        emailResult = await sendNotificationEmail({
          to: email.trim().toLowerCase(),
          type: 'request_approved', // Use generic template for invite
          title: 'Your Account Has Been Created',
          body: `Welcome to the Government Fleet Management System.\n\nYour account has been created by your system administrator.\n\nYour temporary password is: ${tempPassword}\n\nPlease log in and change your password immediately.`,
          recipientName: name || email.split('@')[0],
          tenantName: 'GovFleet Namibia',
          actionUrl: loginUrl,
        });
      } catch (err) {
        console.warn('[User Invite] Email send failed (non-fatal):', err);
        emailResult = { success: false, error: String(err) };
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        id: userId,
        email: email.trim().toLowerCase(),
        name: name || email.split('@')[0],
        tempPassword: sendInvite ? null : tempPassword, // Only return password if not sending email
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
