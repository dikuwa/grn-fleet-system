/**
 * Payment Submissions API (Tenant-facing)
 *
 * GET  /api/payments/submissions — List my payment submissions
 * POST /api/payments/submissions — Submit a new payment proof
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { getDb } from '@/db';
import { paymentSubmissions, paymentSubmissionStatusEnum, tenantSubscriptions } from '@/db/schema/subscriptions';
import { eq, desc, and, count } from 'drizzle-orm';
import { createPaymentSubmission } from '@/lib/platform/subscriptions';

// ---------------------------------------------------------------------------
// GET — List payment submissions for current tenant
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const tenantId = session.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '25', 10);
    const offset = (page - 1) * limit;

    const db = getDb();

    const conditions = [eq(paymentSubmissions.tenantId, tenantId)];
    if (status) {
      conditions.push(eq(paymentSubmissions.status, status as (typeof paymentSubmissionStatusEnum)['enumValues'][number]));
    }
    const whereClause = and(...conditions);

    const [totalResult] = await db
      .select({ count: count() })
      .from(paymentSubmissions)
      .where(whereClause);

    const total = totalResult?.count || 0;

    const submissions = await db
      .select()
      .from(paymentSubmissions)
      .where(whereClause)
      .orderBy(desc(paymentSubmissions.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      success: true,
      data: {
        submissions,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[Payments Submissions] GET failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Submit a payment proof
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const tenantId = session.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
    }

    const body = await request.json();
    const {
      amountCents,
      currency = 'NAD',
      paymentMethod,
      paymentReference,
      paidAt,
      proofFileKey,
      proofFileName,
      proofFileSize,
      proofMimeType,
    } = body;

    // Validate required fields
    if (!amountCents || !paymentMethod || !paidAt || !proofFileKey || !proofFileName || !proofFileSize || !proofMimeType) {
      return NextResponse.json(
        { error: 'Missing required fields: amount, paymentMethod, paidAt, proofFileKey, proofFileName, proofFileSize, proofMimeType' },
        { status: 400 },
      );
    }

    const db = getDb();

    // Get the tenant's subscription
    const [subscription] = await db
      .select()
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.tenantId, tenantId))
      .limit(1);

    if (!subscription) {
      return NextResponse.json({ error: 'No subscription found for this tenant' }, { status: 404 });
    }

    const submission = await createPaymentSubmission({
      subscriptionId: subscription.id,
      tenantId,
      amountCents,
      currency,
      paymentMethod,
      paymentReference,
      paidAt: new Date(paidAt),
      proofFileKey,
      proofFileName,
      proofFileSize,
      proofMimeType,
      submittedByUserId: session.user.id,
    });

    return NextResponse.json({
      success: true,
      data: submission,
    }, { status: 201 });
  } catch (error) {
    console.error('[Payments Submissions] POST failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}