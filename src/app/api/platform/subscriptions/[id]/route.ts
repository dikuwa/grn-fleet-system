/**
 * Platform Subscription Detail API
 *
 * GET    /api/platform/subscriptions/[id] — Get subscription details
 * PATCH  /api/platform/subscriptions/[id] — Transition subscription status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tenantSubscriptions } from '@/db/schema/subscriptions';
import { tenants } from '@/db/schema/tenants';
import { subscriptionPackages } from '@/db/schema/packages';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { transitionSubscription } from '@/lib/platform/subscriptions';
import { recordAuditEvent } from '@/lib/audit-event';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// GET — Subscription details
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(_request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.PLATFORM_ADMIN);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const db = getDb();

    const [row] = await db
      .select({
        subscription: tenantSubscriptions,
        package: subscriptionPackages,
        tenant: tenants,
      })
      .from(tenantSubscriptions)
      .innerJoin(subscriptionPackages, eq(tenantSubscriptions.packageId, subscriptionPackages.id))
      .innerJoin(tenants, eq(tenantSubscriptions.tenantId, tenants.id))
      .where(eq(tenantSubscriptions.id, id))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...row.subscription,
        packageName: row.package.name,
        packageCode: row.package.code,
        tenantName: row.tenant.name,
        tenantCode: row.tenant.code,
      },
    });
  } catch (error) {
    console.error('[Platform Subscription] GET failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — Transition subscription status
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.PLATFORM_ADMIN);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const body = await request.json();
    const { status, reason } = body;

    if (!status) {
      return NextResponse.json({ error: 'Status is required' }, { status: 400 });
    }

    const validStatuses = [
      'pending_payment',
      'trialing',
      'active',
      'past_due',
      'grace_period',
      'cancelled',
      'expired',
      'suspended',
      'restricted',
    ];

    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 },
      );
    }

    await transitionSubscription(id, status, { reason });

    // Audit the transition
    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: 'subscription.status_changed',
      entityType: 'subscription',
      entityId: id,
      summary: `Subscription status changed to ${status}`,
      after: { newStatus: status, reason: reason || null },
    });

    return NextResponse.json({
      success: true,
      data: { status, message: `Subscription transitioned to ${status}` },
    });
  } catch (error) {
    console.error('[Platform Subscription] PATCH failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
