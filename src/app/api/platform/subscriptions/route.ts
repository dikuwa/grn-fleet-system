/**
 * Platform Subscription Management API
 *
 * GET  /api/platform/subscriptions — List all tenant subscriptions
 * POST /api/platform/subscriptions — Create a subscription for a tenant
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  listSubscriptions,
  createSubscription,
} from '@/lib/platform/subscriptions';
import { getDb } from '@/db';
import { tenants } from '@/db/schema/tenants';
import { tenantSubscriptions } from '@/db/schema/subscriptions';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { recordAuditEvent } from '@/lib/audit-event';

// ---------------------------------------------------------------------------
// GET — List all tenant subscriptions with summary stats
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.PLATFORM_ADMIN);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';
    const q = searchParams.get('q') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '25', 10);
    const offset = (page - 1) * limit;

    // Fetch subscriptions and production tenants that still need their first
    // package assignment. Keeping both in one response prevents a second,
    // subtly different source of truth in the client.
    const db = getDb();
    const [subscriptions, unsubscribedTenants] = await Promise.all([
      listSubscriptions(),
      db
        .select({
          id: tenants.id,
          name: tenants.name,
          code: tenants.code,
          status: tenants.status,
        })
        .from(tenants)
        .leftJoin(tenantSubscriptions, eq(tenantSubscriptions.tenantId, tenants.id))
        .where(
          and(
            isNull(tenantSubscriptions.id),
            ne(tenants.type, 'demo_sandbox'),
          ),
        )
        .orderBy(asc(tenants.name)),
    ]);

    // Apply client-side filters for search
    let filtered = subscriptions;
    if (q) {
      const query = q.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.tenantName.toLowerCase().includes(query) ||
          s.packageName.toLowerCase().includes(query) ||
          s.packageCode.toLowerCase().includes(query),
      );
    }
    if (status) {
      filtered = filtered.filter((s) => s.status === status);
    }

    // Paginate
    const paginated = filtered.slice(offset, offset + limit);

    // Compute summary stats
    const stats = {
      total: subscriptions.length,
      active: subscriptions.filter((s) => s.status === 'active').length,
      trialing: subscriptions.filter((s) => s.status === 'trialing').length,
      pastDue: subscriptions.filter((s) => s.status === 'past_due' || s.status === 'grace_period').length,
      cancelled: subscriptions.filter((s) => s.status === 'cancelled').length,
      expired: subscriptions.filter((s) => s.status === 'expired').length,
    };

    return NextResponse.json({
      success: true,
      data: {
        subscriptions: paginated,
        stats,
        total: filtered.length,
        page,
        limit,
        totalPages: Math.ceil(filtered.length / limit),
        unsubscribedTenants,
      },
    });
  } catch (error) {
    console.error('[Platform Subscriptions] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to list subscriptions: ' + String(error) },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — Create a subscription for a tenant
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.PLATFORM_ADMIN);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { tenantId, packageId, billingInterval, trialDays, gracePeriodDays, startNow } = body;

    if (!tenantId || !packageId || !billingInterval) {
      return NextResponse.json(
        { error: 'Tenant ID, package ID, and billing interval are required' },
        { status: 400 },
      );
    }

    // Validate tenant exists
    const db = getDb();
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Check if tenant already has an active subscription
    const [existing] = await db
      .select()
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.tenantId, tenantId))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: 'This tenant already has a subscription. Use Manage to change its package or status.' },
        { status: 409 },
      );
    }

    const subscription = await createSubscription({
      tenantId,
      packageId,
      billingInterval,
      trialDays,
      gracePeriodDays,
      startNow,
    });

    await recordAuditEvent({
      tenantId,
      actorUserId: session.user.id,
      action: 'subscription.assigned',
      entityType: 'subscription',
      entityId: subscription.id,
      summary: `Initial ${subscription.packageName} subscription assigned to ${subscription.tenantName}.`,
      after: {
        packageId: subscription.packageId,
        packageCode: subscription.packageCode,
        billingInterval: subscription.billingInterval,
        status: subscription.status,
      },
    });

    return NextResponse.json({
      success: true,
      data: subscription,
    }, { status: 201 });
  } catch (error) {
    console.error('[Platform Subscriptions] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to create subscription: ' + String(error) },
      { status: 500 },
    );
  }
}
