/**
 * Platform Data Reset API
 *
 * GET   /api/platform/reset — List tenant reset requests
 * POST  /api/platform/reset — Create a new reset request
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import { tenantResetRequests, resetRequestStatusEnum, resetScopeEnum } from '@/db/schema/reset-requests';
import { tenants } from '@/db/schema';
import { eq, and, desc, count, like, or } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// GET — List reset requests
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';
    const scope = searchParams.get('scope') || '';
    const q = searchParams.get('q') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '25', 10);
    const offset = (page - 1) * limit;

    const db = getDb();

    const conditions: ReturnType<typeof and>[] = [];
    if (status) conditions.push(eq(tenantResetRequests.status, status as (typeof resetRequestStatusEnum)['enumValues'][number]));
    if (scope) conditions.push(eq(tenantResetRequests.scope, scope as (typeof resetScopeEnum)['enumValues'][number]));
    if (q) {
      conditions.push(
        or(
          like(tenants.name, `%${q}%`),
          like(tenantResetRequests.reason, `%${q}%`),
        )!,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ count: count() })
      .from(tenantResetRequests)
      .leftJoin(tenants, eq(tenantResetRequests.tenantId, tenants.id))
      .where(whereClause);

    const total = totalResult?.count || 0;

    const requests = await db
      .select({
        id: tenantResetRequests.id,
        tenantId: tenantResetRequests.tenantId,
        tenantName: tenants.name,
        scope: tenantResetRequests.scope,
        reason: tenantResetRequests.reason,
        status: tenantResetRequests.status,
        requestedByUserId: tenantResetRequests.requestedByUserId,
        backupRequired: tenantResetRequests.backupRequired,
        backupCreated: tenantResetRequests.backupCreated,
        backupLocation: tenantResetRequests.backupLocation,
        startedAt: tenantResetRequests.startedAt,
        completedAt: tenantResetRequests.completedAt,
        executionTimeMs: tenantResetRequests.executionTimeMs,
        reviewedByUserId: tenantResetRequests.reviewedByUserId,
        reviewedAt: tenantResetRequests.reviewedAt,
        reviewNotes: tenantResetRequests.reviewNotes,
        results: tenantResetRequests.results,
        failureReason: tenantResetRequests.failureReason,
        rollbackPossible: tenantResetRequests.rollbackPossible,
        rollbackPerformed: tenantResetRequests.rollbackPerformed,
        createdAt: tenantResetRequests.createdAt,
        updatedAt: tenantResetRequests.updatedAt,
      })
      .from(tenantResetRequests)
      .leftJoin(tenants, eq(tenantResetRequests.tenantId, tenants.id))
      .where(whereClause)
      .orderBy(desc(tenantResetRequests.createdAt))
      .limit(limit)
      .offset(offset);

    // Compute stats
    const [allCount] = await db
      .select({ count: count() })
      .from(tenantResetRequests);

    const [draftCount] = await db
      .select({ count: count() })
      .from(tenantResetRequests)
      .where(eq(tenantResetRequests.status, 'draft'));

    const [reviewCount] = await db
      .select({ count: count() })
      .from(tenantResetRequests)
      .where(eq(tenantResetRequests.status, 'pending_review'));

    const [approvedCount] = await db
      .select({ count: count() })
      .from(tenantResetRequests)
      .where(eq(tenantResetRequests.status, 'approved'));

    const [completedCount] = await db
      .select({ count: count() })
      .from(tenantResetRequests)
      .where(eq(tenantResetRequests.status, 'completed'));

    const [failedCount] = await db
      .select({ count: count() })
      .from(tenantResetRequests)
      .where(eq(tenantResetRequests.status, 'failed'));

    return NextResponse.json({
      success: true,
      data: {
        requests,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        stats: {
          total: allCount?.count || 0,
          draft: draftCount?.count || 0,
          pendingReview: reviewCount?.count || 0,
          approved: approvedCount?.count || 0,
          completed: completedCount?.count || 0,
          failed: failedCount?.count || 0,
        },
      },
    });
  } catch (error) {
    console.error('[Platform Reset] GET failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Create a new reset request
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { tenantId, scope, reason, backupRequired = true } = body;

    if (!tenantId || !scope || !reason) {
      return NextResponse.json(
        { error: 'tenantId, scope, and reason are required' },
        { status: 400 },
      );
    }

    const validScopes = ['temporary_data', 'operational', 'fleet', 'user_access', 'full'];
    if (!validScopes.includes(scope)) {
      return NextResponse.json(
        { error: `Invalid scope. Must be one of: ${validScopes.join(', ')}` },
        { status: 400 },
      );
    }

    const db = getDb();

    // Verify tenant exists
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Create the reset request in draft status
    const [created] = await db
      .insert(tenantResetRequests)
      .values({
        tenantId,
        scope,
        reason,
        requestedByUserId: session.user.id,
        backupRequired,
        confirmationPhrase: '',
        status: 'draft',
      })
      .returning();

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    console.error('[Platform Reset] POST failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
