/**
 * User Profile API
 *
 * GET   /api/users/profile    — Get current user's profile
 * PATCH /api/users/profile    — Update profile (name, image)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user } from '@/db/schema/better-auth';
import { userProfiles } from '@/db/schema/auth';
import { employees } from '@/db/schema/people';
import { tenantMemberships, roleAssignments, roles } from '@/db/schema/tenants';
import { auditEvents } from '@/db/schema/audit';
import { eq, and } from 'drizzle-orm';
import { requireRequestAuth } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();

    const [userRecord] = await db
      .select()
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1);

    if (!userRecord) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, session.user.id))
      .limit(1);

    // Get employee record
    const [employee] = await db
      .select()
      .from(employees)
      .where(and(eq(employees.userId, session.user.id)))
      .limit(1);

    // Get current roles (tenant-scoped)
    const [membership] = await db
      .select()
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.userId, session.user.id),
          eq(tenantMemberships.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    let roleList: Array<{ roleName: string; isActing: boolean }> = [];
    if (membership) {
      roleList = await db
        .select({
          roleName: roles.name,
          isActing: roleAssignments.isActing,
        })
        .from(roleAssignments)
        .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
        .where(eq(roleAssignments.tenantMembershipId, membership.id));
    }

    return NextResponse.json({
      success: true,
      data: {
        ...userRecord,
        image: userRecord.image
          ? `/api/users/avatar?v=${encodeURIComponent(userRecord.updatedAt.toISOString())}`
          : null,
        profile: profile || null,
        employee: employee || null,
        roles: roleList,
        tenantId: session.tenantId,
        tenantSlug: session.tenantSlug,
      },
    }, {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[User Profile] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to load profile: ' + String(error) },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const body = await request.json();
    const { name, displayName } = body;

    const db = getDb();

    if (name !== undefined) {
      await db
        .update(user)
        .set({ name, updatedAt: new Date() })
        .where(eq(user.id, session.user.id));
    }

    if (displayName !== undefined) {
      const [existing] = await db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, session.user.id))
        .limit(1);

      if (existing) {
        await db
          .update(userProfiles)
          .set({ displayName, updatedAt: new Date() })
          .where(eq(userProfiles.userId, session.user.id));
      } else {
        await db.insert(userProfiles).values({
          id: session.user.id,
          userId: session.user.id,
          displayName,
        });
      }
    }

    // Log audit event
    try {
      await db.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: 'profile_updated',
        actorUserId: session.user.id,
        action: 'update',
        entityType: 'profile',
        entityId: session.user.id,
        summary: 'User updated their profile',
      });
    } catch {
      // Non-fatal
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[User Profile] PATCH failed:', error);
    return NextResponse.json(
      { error: 'Failed to update profile: ' + String(error) },
      { status: 500 },
    );
  }
}
