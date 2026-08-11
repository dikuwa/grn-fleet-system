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
import {
  changeSubscriptionPackage,
  transitionSubscription,
  type BillingInterval,
} from '@/lib/platform/subscriptions';
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
    const { status, reason, packageId, billingInterval, billingPeriods } = body;

    if (!status && !packageId) {
      return NextResponse.json({ error: 'Choose a new status or subscription package' }, { status: 400 });
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

    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 },
      );
    }

    let packageChange = null;
    if (packageId) {
      if (!['monthly', 'quarterly', 'annually'].includes(billingInterval)) {
        return NextResponse.json({ error: 'Choose a valid billing interval' }, { status: 400 });
      }
      const periods = Number(billingPeriods);
      if (!Number.isInteger(periods) || periods < 1 || periods > 36) {
        return NextResponse.json({ error: 'Duration must be between 1 and 36 billing periods' }, { status: 400 });
      }
      packageChange = await changeSubscriptionPackage(id, {
        packageId,
        billingInterval: billingInterval as BillingInterval,
        billingPeriods: periods,
      });
    }
    if (status) await transitionSubscription(id, status, { reason });

    // Audit the transition
    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: 'subscription.status_changed',
      entityType: 'subscription',
      entityId: id,
      summary: packageId
        ? `Subscription package changed to ${packageChange?.packageName}${status ? ` and status changed to ${status}` : ''}`
        : `Subscription status changed to ${status}`,
      after: {
        newStatus: status || undefined,
        packageId: packageId || undefined,
        packageCode: packageChange?.packageCode,
        billingInterval: packageChange?.billingInterval,
        currentPeriodEnd: packageChange?.currentPeriodEnd,
        reason: reason || null,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        status: status || packageChange?.status,
        subscription: packageChange,
        message: packageId ? 'Subscription package and duration updated' : `Subscription transitioned to ${status}`,
      },
    });
  } catch (error) {
    console.error('[Platform Subscription] PATCH failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
