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
  evaluateSubscriptionLifecycle,
} from '@/lib/platform/subscriptions';
import { listPackages } from '@/lib/platform/packages';
import { getDb } from '@/db';
import { tenants } from '@/db/schema/tenants';
import { tenantSubscriptions } from '@/db/schema/subscriptions';
import { eq, count, desc, and, or, like } from 'drizzle-orm';

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

    const db = getDb();

    // Build filters
    const conditions: ReturnType<typeof and>[] = [];
    if (status) {
      conditions.push(eq(tenantSubscriptions.status, status as any));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [totalResult] = await db
      .select({ count: count() })
      .from(tenantSubscriptions)
      .where(whereClause);

    const total = totalResult?.count || 0;

    // Fetch subscriptions with tenant and package info
    const subscriptions = await listSubscriptions();

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

    if (existing && ['active', 'trialing'].includes(existing.status)) {
      return NextResponse.json(
        { error: 'Tenant already has an active subscription. Cancel or modify the existing one first.' },
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
