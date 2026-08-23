/**
 * Platform Data Reset API
 *
 * GET  /api/platform/reset — List tenant reset requests
 * POST /api/platform/reset — Create a reset request
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import {
  tenantResetRequests,
  resetRequestStatusEnum,
  resetScopeEnum,
} from '@/db/schema/reset-requests';
import { tenants, user } from '@/db/schema';
import { eq, and, desc, count, gte, ilike, lt, lte, or, inArray, sql } from 'drizzle-orm';
import { normalizeResetSpec, resetScopeForSpec } from '@/lib/reset-catalog';
import {
  isResetApprovalExpired,
  isResetRequestBlocking,
  RESET_APPROVAL_TTL_HOURS,
  resetApprovalExpiresAt,
} from '@/lib/reset-execution-guard';

const RESET_OPEN_STATUSES = ['draft', 'pending_review', 'approved', 'in_progress'] as const;

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
    const view = searchParams.get('view') === 'history' ? 'history' : 'current';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10) || 25));
    const offset = (page - 1) * limit;
    const db = getDb();
    const recentCutoff = new Date(Date.now() - 30 * 86_400_000);

    const conditions: ReturnType<typeof and>[] = [];
    if (status)
      conditions.push(
        eq(
          tenantResetRequests.status,
          status as (typeof resetRequestStatusEnum)['enumValues'][number],
        ),
      );
    if (!status) {
      conditions.push(
        (view === 'history'
          ? or(
              inArray(tenantResetRequests.status, ['rejected', 'cancelled']),
              and(
                eq(tenantResetRequests.status, 'completed'),
                lt(tenantResetRequests.createdAt, recentCutoff),
              ),
            )
          : or(
              inArray(tenantResetRequests.status, [
                'draft',
                'pending_review',
                'approved',
                'in_progress',
                'failed',
              ]),
              and(
                eq(tenantResetRequests.status, 'completed'),
                gte(tenantResetRequests.createdAt, recentCutoff),
              ),
            ))!,
      );
    }
    if (scope)
      conditions.push(
        eq(tenantResetRequests.scope, scope as (typeof resetScopeEnum)['enumValues'][number]),
      );
    if (q)
      conditions.push(
        or(
          ilike(tenants.name, `%${q}%`),
          ilike(tenants.code, `%${q}%`),
          ilike(tenantResetRequests.reason, `%${q}%`),
        )!,
      );
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ count: count() })
      .from(tenantResetRequests)
      .leftJoin(tenants, eq(tenantResetRequests.tenantId, tenants.id))
      .where(whereClause);
    const total = Number(totalResult?.count ?? 0);

    const requests = await db
      .select({
        id: tenantResetRequests.id,
        tenantId: tenantResetRequests.tenantId,
        tenantName: tenants.name,
        tenantCode: tenants.code,
        scope: tenantResetRequests.scope,
        reason: tenantResetRequests.reason,
        status: tenantResetRequests.status,
        requestedByUserId: tenantResetRequests.requestedByUserId,
        requestedByName: user.name,
        requestedByEmail: user.email,
        backupRequired: tenantResetRequests.backupRequired,
        backupCreated: tenantResetRequests.backupCreated,
        backupLocation: tenantResetRequests.backupLocation,
        backupSizeBytes: tenantResetRequests.backupSizeBytes,
        backupRecordCount: tenantResetRequests.backupRecordCount,
        startedAt: tenantResetRequests.startedAt,
        completedAt: tenantResetRequests.completedAt,
        executionTimeMs: tenantResetRequests.executionTimeMs,
        reviewedByUserId: tenantResetRequests.reviewedByUserId,
        reviewedAt: tenantResetRequests.reviewedAt,
        reviewNotes: tenantResetRequests.reviewNotes,
        validationResults: tenantResetRequests.validationResults,
        results: tenantResetRequests.results,
        failureReason: tenantResetRequests.failureReason,
        rollbackPossible: tenantResetRequests.rollbackPossible,
        rollbackPerformed: tenantResetRequests.rollbackPerformed,
        metadata: tenantResetRequests.metadata,
        createdAt: tenantResetRequests.createdAt,
        updatedAt: tenantResetRequests.updatedAt,
      })
      .from(tenantResetRequests)
      .leftJoin(tenants, eq(tenantResetRequests.tenantId, tenants.id))
      .leftJoin(user, eq(tenantResetRequests.requestedByUserId, user.id))
      .where(whereClause)
      .orderBy(desc(tenantResetRequests.createdAt))
      .limit(limit)
      .offset(offset);

    const [statusCounts, viewCounts] = await Promise.all([
      db
        .select({ status: tenantResetRequests.status, count: count() })
        .from(tenantResetRequests)
        .groupBy(tenantResetRequests.status),
      db
        .select({
          current: sql<number>`COUNT(*) FILTER (WHERE ${tenantResetRequests.status} IN ('draft', 'pending_review', 'approved', 'in_progress', 'failed') OR (${tenantResetRequests.status} = 'completed' AND ${tenantResetRequests.createdAt} >= ${recentCutoff}))::int`,
          history: sql<number>`COUNT(*) FILTER (WHERE ${tenantResetRequests.status} IN ('rejected', 'cancelled') OR (${tenantResetRequests.status} = 'completed' AND ${tenantResetRequests.createdAt} < ${recentCutoff}))::int`,
        })
        .from(tenantResetRequests),
    ]);
    const [expiredApprovalResult] = await db
      .select({ count: count() })
      .from(tenantResetRequests)
      .where(
        and(
          eq(tenantResetRequests.status, 'approved'),
          lte(
            tenantResetRequests.reviewedAt,
            new Date(Date.now() - RESET_APPROVAL_TTL_HOURS * 60 * 60 * 1000),
          ),
        ),
      );
    const byStatus = Object.fromEntries(statusCounts.map((row) => [row.status, Number(row.count)]));
    const requestRows = requests.map((item) => ({
      ...item,
      approvalExpired: item.status === 'approved' && isResetApprovalExpired(item.reviewedAt),
      approvalExpiresAt: resetApprovalExpiresAt(item.reviewedAt)?.toISOString() ?? null,
    }));

    return NextResponse.json({
      success: true,
      data: {
        requests: requestRows,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        viewCounts: {
          current: Number(viewCounts[0]?.current ?? 0),
          history: Number(viewCounts[0]?.history ?? 0),
        },
        stats: {
          total,
          draft: byStatus.draft ?? 0,
          pendingReview: byStatus.pending_review ?? 0,
          approved: byStatus.approved ?? 0,
          expiredApprovals: Number(expiredApprovalResult?.count ?? 0),
          completed: byStatus.completed ?? 0,
          failed: byStatus.failed ?? 0,
        },
      },
    });
  } catch (error) {
    console.error('[Platform Reset] GET failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requirePermission(session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const {
      tenantId,
      scope = 'operational',
      reason,
      backupRequired = true,
      target = 'tenant',
      resetSpec: resetSpecInput,
    } = body;
    let resetSpec;
    try {
      resetSpec = normalizeResetSpec(
        resetSpecInput ?? { preset: scope === 'full' ? 'clean_slate' : 'operational' },
        {
          target: target === 'platform' ? 'all_tenants' : 'tenant',
        },
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid reset selection' },
        { status: 400 },
      );
    }
    if ((target !== 'platform' && !tenantId) || !scope || !String(reason || '').trim())
      return NextResponse.json(
        { error: 'A reset target, scope, and reason are required' },
        { status: 400 },
      );

    const validScopes = ['temporary_data', 'operational', 'fleet', 'user_access', 'full'];
    if (!validScopes.includes(scope))
      return NextResponse.json(
        { error: `Invalid scope. Must be one of: ${validScopes.join(', ')}` },
        { status: 400 },
      );

    const db = getDb();
    if (target === 'platform') {
      const [tenantRows, openRows] = await Promise.all([
        db
          .select({ id: tenants.id, name: tenants.name, code: tenants.code, type: tenants.type })
          .from(tenants),
        db
          .select({
            tenantId: tenantResetRequests.tenantId,
            status: tenantResetRequests.status,
            reviewedAt: tenantResetRequests.reviewedAt,
          })
          .from(tenantResetRequests)
          .where(inArray(tenantResetRequests.status, [...RESET_OPEN_STATUSES])),
      ]);
      const openTenantIds = new Set(
        openRows.filter((row) => isResetRequestBlocking(row)).map((row) => row.tenantId),
      );
      const candidates = tenantRows.filter(
        (tenant) => tenant.type !== 'demo_sandbox' && !openTenantIds.has(tenant.id),
      );
      if (!candidates.length) {
        return NextResponse.json(
          { error: 'Every production tenant already has an open reset request.' },
          { status: 409 },
        );
      }
      const batchId = randomUUID();
      const created = await db
        .insert(tenantResetRequests)
        .values(
          candidates.map((tenant) => ({
            tenantId: tenant.id,
            scope: resetScopeForSpec(resetSpec),
            reason: String(reason).trim(),
            requestedByUserId: session.user.id,
            backupRequired: Boolean(backupRequired),
            confirmationPhrase: `RESET ${tenant.code}`,
            status: 'draft' as const,
            rollbackPossible: false,
            metadata: {
              createdFrom: 'platform_admin',
              productionSafeFlow: true,
              platformBatchId: batchId,
              resetSpec: { ...resetSpec, target: 'all_tenants' },
            },
          })),
        )
        .onConflictDoNothing()
        .returning();
      return NextResponse.json(
        {
          success: true,
          data: {
            batchId,
            createdCount: created.length,
            // Includes demo sandboxes, pre-existing open requests, and any
            // same-millisecond request that won the database creation slot.
            skippedCount: tenantRows.length - created.length,
            requests: created,
          },
        },
        { status: 201 },
      );
    }

    const [tenant] = await db
      .select({ id: tenants.id, name: tenants.name, code: tenants.code })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    const existingRows = await db
      .select({
        id: tenantResetRequests.id,
        status: tenantResetRequests.status,
        reviewedAt: tenantResetRequests.reviewedAt,
      })
      .from(tenantResetRequests)
      .where(
        and(
          eq(tenantResetRequests.tenantId, tenantId),
          inArray(tenantResetRequests.status, [...RESET_OPEN_STATUSES]),
        ),
      );
    const existingRequest = existingRows.find((item) => isResetRequestBlocking(item));
    if (existingRequest) {
      return NextResponse.json(
        {
          error: `This tenant already has an active reset request (${existingRequest.status.replaceAll('_', ' ')}).`,
          requestId: existingRequest.id,
        },
        { status: 409 },
      );
    }

    const [created] = await db
      .insert(tenantResetRequests)
      .values({
        tenantId,
        scope: resetScopeForSpec(resetSpec),
        reason: String(reason).trim(),
        requestedByUserId: session.user.id,
        backupRequired: Boolean(backupRequired),
        confirmationPhrase: `RESET ${tenant.code}`,
        status: 'draft',
        rollbackPossible: false,
        metadata: { createdFrom: 'platform_admin', productionSafeFlow: true, resetSpec },
      })
      .onConflictDoNothing()
      .returning();

    if (!created) {
      const competingRows = await db
        .select({
          id: tenantResetRequests.id,
          status: tenantResetRequests.status,
          reviewedAt: tenantResetRequests.reviewedAt,
        })
        .from(tenantResetRequests)
        .where(
          and(
            eq(tenantResetRequests.tenantId, tenantId),
            inArray(tenantResetRequests.status, [...RESET_OPEN_STATUSES]),
          ),
        );
      const competingRequest = competingRows.find((item) => isResetRequestBlocking(item));
      return NextResponse.json(
        {
          error: competingRequest
            ? `This tenant already has an active reset request (${competingRequest.status.replaceAll('_', ' ')}).`
            : 'Another reset request was created at the same time. Refresh before trying again.',
          requestId: competingRequest?.id ?? null,
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { success: true, data: { ...created, tenantName: tenant.name, tenantCode: tenant.code } },
      { status: 201 },
    );
  } catch (error) {
    console.error('[Platform Reset] POST failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
