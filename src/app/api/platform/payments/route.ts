/**
 * Platform Payment Review API
 *
 * GET    /api/platform/payments — List all payment submissions (Platform Admin)
 * PATCH  /api/platform/payments/[id]/review — Approve/reject a payment submission
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { listPaymentSubmissions } from '@/lib/platform/subscriptions';
import { getDb } from '@/db';
import { paymentSubmissions, paymentSubmissionStatusEnum, tenantSubscriptions } from '@/db/schema/subscriptions';
import { tenants } from '@/db/schema/tenants';
import { subscriptionPackages } from '@/db/schema/packages';
import { eq, desc, and } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// GET — List all payment submissions for review
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

    // Build query with joins
    const conditions: ReturnType<typeof and>[] = [];
    if (status) {
      conditions.push(eq(paymentSubmissions.status, status as (typeof paymentSubmissionStatusEnum)['enumValues'][number]));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Fetch submissions with tenant and subscription info
    const rows = await db
      .select({
        submission: paymentSubmissions,
        subscription: tenantSubscriptions,
        tenant: tenants,
        package: subscriptionPackages,
      })
      .from(paymentSubmissions)
      .leftJoin(tenantSubscriptions, eq(paymentSubmissions.subscriptionId, tenantSubscriptions.id))
      .leftJoin(tenants, eq(paymentSubmissions.tenantId, tenants.id))
      .leftJoin(subscriptionPackages, eq(tenantSubscriptions.packageId, subscriptionPackages.id))
      .where(whereClause)
      .orderBy(desc(paymentSubmissions.createdAt))
      .limit(limit)
      .offset(offset);

    // Apply search filter client-side
    let filtered = rows;
    if (q) {
      const query = q.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.tenant?.name?.toLowerCase().includes(query) ||
          r.submission.paymentReference?.toLowerCase().includes(query) ||
          r.submission.id.toLowerCase().includes(query),
      );
    }

    // Stats
    const allRows = await listPaymentSubmissions();
    const stats = {
      total: allRows.length,
      submitted: allRows.filter((s) => s.status === 'submitted').length,
      underReview: allRows.filter((s) => s.status === 'under_review').length,
      approved: allRows.filter((s) => s.status === 'approved').length,
      rejected: allRows.filter((s) => s.status === 'rejected').length,
      pending: allRows.filter((s) => s.status === 'submitted' || s.status === 'under_review').length,
    };

    const paginated = filtered.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      data: {
        payments: paginated.map((r) => ({
          ...r.submission,
          tenantName: r.tenant?.name,
          tenantCode: r.tenant?.code,
          packageName: r.package?.name,
          subscriptionStatus: r.subscription?.status,
        })),
        stats,
        total: filtered.length,
        page,
        limit,
        totalPages: Math.ceil(filtered.length / limit),
      },
    });
  } catch (error) {
    console.error('[Platform Payments] GET failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Bulk actions (future use)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.PLATFORM_ADMIN);
    if (permCheck instanceof NextResponse) return permCheck;

    // Payload intentionally unused - bulk approve/reject is not yet implemented.
    await request.json();

    return NextResponse.json({ error: 'Bulk actions not yet implemented' }, { status: 501 });
  } catch (error) {
    console.error('[Platform Payments] POST failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}