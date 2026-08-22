import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import { tenantResetRequests } from '@/db/schema/reset-requests';
import { tenants } from '@/db/schema/tenants';
import { user } from '@/db/schema/better-auth';
import { recordAuditEvent } from '@/lib/audit-event';
import {
  notifyPlatformResetRequested,
  resolvePlatformResetRequestNotification,
} from '@/lib/platform/reset-notifications';
import { matchesTenantResetRequestPhrase, tenantExecutionResetPhrase } from '@/lib/reset-workflow';
import { normalizeResetSpec, resetScopeForSpec } from '@/lib/reset-catalog';
import {
  isResetApprovalExpired,
  isResetRequestBlocking,
  resetApprovalExpiresAt,
} from '@/lib/reset-execution-guard';
import { resetExecutionOwner } from '@/lib/reset-workflow';

const OPEN_STATUSES = ['draft', 'pending_review', 'approved', 'in_progress'] as const;

async function requireTenantAdmin(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth;
  const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
  if (permission instanceof NextResponse) return { ok: false as const, error: permission };
  return auth;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireTenantAdmin(request);
    if (!auth.ok) return auth.error;
    const db = getDb();
    const requests = await db
      .select({
        id: tenantResetRequests.id,
        scope: tenantResetRequests.scope,
        reason: tenantResetRequests.reason,
        status: tenantResetRequests.status,
        requestedByUserId: tenantResetRequests.requestedByUserId,
        confirmationPhrase: tenantResetRequests.confirmationPhrase,
        backupCreated: tenantResetRequests.backupCreated,
        rollbackPossible: tenantResetRequests.rollbackPossible,
        backupRecordCount: tenantResetRequests.backupRecordCount,
        reviewedAt: tenantResetRequests.reviewedAt,
        reviewedByName: user.name,
        reviewNotes: tenantResetRequests.reviewNotes,
        failureReason: tenantResetRequests.failureReason,
        validationResults: tenantResetRequests.validationResults,
        results: tenantResetRequests.results,
        metadata: tenantResetRequests.metadata,
        startedAt: tenantResetRequests.startedAt,
        completedAt: tenantResetRequests.completedAt,
        createdAt: tenantResetRequests.createdAt,
        updatedAt: tenantResetRequests.updatedAt,
      })
      .from(tenantResetRequests)
      .leftJoin(user, eq(tenantResetRequests.reviewedByUserId, user.id))
      .where(eq(tenantResetRequests.tenantId, auth.session.tenantId))
      .orderBy(desc(tenantResetRequests.createdAt));

    return NextResponse.json({
      success: true,
      data: {
        requests: requests.map((item) => {
          const resetSpec = normalizeResetSpec(
            (item.metadata as { resetSpec?: unknown } | null)?.resetSpec,
            { target: 'tenant' },
          );
          const metadata = (item.metadata ?? {}) as Record<string, unknown>;
          const approvalExpired =
            item.status === 'approved' && isResetApprovalExpired(item.reviewedAt);
          const validation = (item.validationResults ?? {}) as Record<string, unknown>;
          const tenantExecutable =
            item.status === 'approved' &&
            Boolean(item.reviewedAt) &&
            !approvalExpired &&
            item.backupCreated &&
            item.rollbackPossible &&
            typeof validation.fingerprint === 'string' &&
            resetExecutionOwner({ createdFrom: metadata.createdFrom, preset: resetSpec.preset }) ===
              'tenant';
          return {
            ...item,
            confirmationPhrase: tenantExecutable ? item.confirmationPhrase : null,
            tenantExecutable,
            platformExecutionRequired:
              resetExecutionOwner({
                createdFrom: metadata.createdFrom,
                preset: resetSpec.preset,
              }) === 'platform',
            approvalExpired,
            approvalExpiresAt: resetApprovalExpiresAt(item.reviewedAt)?.toISOString() ?? null,
          };
        }),
      },
    });
  } catch (error) {
    console.error('[Tenant Data Reset] GET failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTenantAdmin(request);
    if (!auth.ok) return auth.error;
    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const acknowledgement =
      typeof body.acknowledgement === 'string' ? body.acknowledgement.trim() : '';
    let resetSpec;
    try {
      resetSpec = normalizeResetSpec(body.resetSpec, { target: 'tenant' });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid reset selection' },
        { status: 400 },
      );
    }
    if (reason.length < 20) {
      return NextResponse.json(
        { error: 'Explain the operational reason in at least 20 characters.' },
        { status: 400 },
      );
    }
    if (!matchesTenantResetRequestPhrase(acknowledgement)) {
      return NextResponse.json(
        { error: 'Type REQUEST RESET to confirm this request.' },
        { status: 400 },
      );
    }

    const db = getDb();
    const [tenant, openRequests] = await Promise.all([
      db
        .select({ id: tenants.id, name: tenants.name, code: tenants.code })
        .from(tenants)
        .where(eq(tenants.id, auth.session.tenantId))
        .limit(1),
      db
        .select({
          id: tenantResetRequests.id,
          status: tenantResetRequests.status,
          reviewedAt: tenantResetRequests.reviewedAt,
        })
        .from(tenantResetRequests)
        .where(
          and(
            eq(tenantResetRequests.tenantId, auth.session.tenantId),
            inArray(tenantResetRequests.status, [...OPEN_STATUSES]),
          ),
        )
        .orderBy(desc(tenantResetRequests.createdAt)),
    ]).then(([tenantRows, requestRows]) => [tenantRows[0], requestRows] as const);

    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    const openRequest = openRequests.find((item) => isResetRequestBlocking(item));
    if (openRequest) {
      return NextResponse.json(
        {
          error: `Your organisation already has an open reset request (${openRequest.status.replace(/_/g, ' ')}).`,
          requestId: openRequest.id,
        },
        { status: 409 },
      );
    }

    const [created] = await db
      .insert(tenantResetRequests)
      .values({
        tenantId: tenant.id,
        scope: resetScopeForSpec(resetSpec),
        reason,
        confirmationPhrase: tenantExecutionResetPhrase(tenant.code),
        requestedByUserId: auth.session.user.id,
        status: 'pending_review',
        backupRequired: true,
        rollbackPossible: false,
        metadata: {
          createdFrom: 'tenant_admin',
          productionSafeFlow: true,
          submittedAt: new Date().toISOString(),
          resetSpec,
        },
      })
      .onConflictDoNothing()
      .returning();

    // The partial unique creation-slot index is the final race guard. A second
    // request that lost a simultaneous insert returns a normal conflict instead
    // of surfacing a database error or producing duplicate governance records.
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
            eq(tenantResetRequests.tenantId, tenant.id),
            inArray(tenantResetRequests.status, [...OPEN_STATUSES]),
          ),
        )
        .orderBy(desc(tenantResetRequests.createdAt));
      const competingRequest = competingRows.find((item) => isResetRequestBlocking(item));
      return NextResponse.json(
        {
          error: competingRequest
            ? `Your organisation already has an open reset request (${competingRequest.status.replace(/_/g, ' ')}).`
            : 'Another reset request was created at the same time. Refresh before trying again.',
          requestId: competingRequest?.id ?? null,
        },
        { status: 409 },
      );
    }

    await Promise.all([
      recordAuditEvent({
        tenantId: tenant.id,
        actorUserId: auth.session.user.id,
        action: 'reset_request.submitted',
        entityType: 'reset_request',
        entityId: created.id,
        summary: `${tenant.name} requested a governed reset plan.`,
        after: { status: 'pending_review', scope: resetScopeForSpec(resetSpec), resetSpec, reason },
      }),
      notifyPlatformResetRequested({
        requestId: created.id,
        tenantName: tenant.name,
        tenantCode: tenant.code,
        reason,
      }),
    ]);

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    console.error('[Tenant Data Reset] POST failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireTenantAdmin(request);
    if (!auth.ok) return auth.error;
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id || body.action !== 'cancel') {
      return NextResponse.json(
        { error: 'A request id and cancel action are required.' },
        { status: 400 },
      );
    }

    const db = getDb();
    const [current] = await db
      .select()
      .from(tenantResetRequests)
      .where(
        and(
          eq(tenantResetRequests.id, id),
          eq(tenantResetRequests.tenantId, auth.session.tenantId),
        ),
      )
      .limit(1);
    if (!current) return NextResponse.json({ error: 'Reset request not found' }, { status: 404 });
    if (!['draft', 'pending_review'].includes(current.status)) {
      return NextResponse.json(
        {
          error: 'This request can no longer be cancelled because platform processing has started.',
        },
        { status: 409 },
      );
    }

    const [updated] = await db
      .update(tenantResetRequests)
      .set({
        status: 'cancelled',
        failureReason: 'Cancelled by Tenant Administrator',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tenantResetRequests.id, id),
          eq(tenantResetRequests.tenantId, auth.session.tenantId),
        ),
      )
      .returning();

    await Promise.all([
      resolvePlatformResetRequestNotification(id),
      recordAuditEvent({
        tenantId: auth.session.tenantId,
        actorUserId: auth.session.user.id,
        action: 'reset_request.cancelled',
        entityType: 'reset_request',
        entityId: id,
        summary: 'Tenant Administrator cancelled the reset request before approval.',
        before: { status: current.status },
        after: { status: 'cancelled' },
      }),
    ]);

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Tenant Data Reset] PATCH failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
