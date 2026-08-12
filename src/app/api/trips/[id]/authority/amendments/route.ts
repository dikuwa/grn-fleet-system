import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  tripAmendments,
  tripAuthorities,
} from '@/db/schema/trips';
import { auditEvents } from '@/db/schema/audit';
import { requireAnyPermission, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { runAtomicMutations } from '@/lib/db-atomic';

const supported = ['date_extension', 'route_change', 'purpose_clarification', 'special_authorisation'] as const;
type AmendmentType = (typeof supported)[number];

function originalValue(authority: typeof tripAuthorities.$inferSelect, type: AmendmentType) {
  if (type === 'date_extension') return { validFrom: authority.validFrom, validUntil: authority.validUntil };
  if (type === 'route_change') return { origin: authority.origin, destination: authority.destination, approvedRoute: authority.approvedRoute };
  if (type === 'purpose_clarification') return { purpose: authority.purpose };
  return { specialConditions: authority.specialConditions, specialAuthorityGranted: authority.specialAuthorityGranted };
}

function optionalDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permission = await requirePermission(session, Permissions.TRIP_MANAGE);
    if (permission instanceof NextResponse) return permission;
    const { id } = await params;
    const body = await request.json() as {
      amendmentType?: AmendmentType;
      newValue?: Record<string, unknown>;
      reason?: string;
    };
    const cleanReason = body.reason?.trim() || '';
    if (!body.amendmentType || !supported.includes(body.amendmentType) || !body.newValue || !cleanReason) {
      return NextResponse.json({ error: 'A supported amendment, new value and reason are required' }, { status: 422 });
    }
    if (cleanReason.length > 1000) {
      return NextResponse.json({ error: 'Amendment reason must be 1000 characters or fewer' }, { status: 422 });
    }

    const db = getDb();
    const [authority] = await db.select().from(tripAuthorities)
      .where(and(eq(tripAuthorities.tripId, id), eq(tripAuthorities.tenantId, session.tenantId)))
      .limit(1);
    if (!authority) return NextResponse.json({ error: 'Trip Authority not found' }, { status: 404 });
    if (['closed', 'cancelled', 'expired', 'superseded'].includes(authority.status)) {
      return NextResponse.json({ error: `A ${authority.status} authority cannot be amended` }, { status: 409 });
    }

    const amendmentId = randomUUID();
    const original = originalValue(authority, body.amendmentType);
    await runAtomicMutations((tx) => [
      tx.insert(tripAmendments).values({
        id: amendmentId,
        authorityId: authority.id,
        amendmentType: body.amendmentType!,
        originalValue: original,
        newValue: body.newValue!,
        reason: cleanReason,
        requestedByUserId: session.user.id,
        version: authority.version + 1,
      }),
      tx.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: 'trip_authority_amendment_requested',
        actorUserId: session.user.id,
        action: 'request_amendment',
        entityType: 'trip_amendment',
        entityId: amendmentId,
        before: original,
        after: body.newValue!,
        reason: cleanReason,
        sourceChannel: 'web',
      }),
    ]);

    const [amendment] = await db.select().from(tripAmendments)
      .where(eq(tripAmendments.id, amendmentId))
      .limit(1);
    return NextResponse.json({ success: true, data: amendment }, { status: 201 });
  } catch (error) {
    console.error('[authority/amendments] POST failed:', error);
    return NextResponse.json({ error: 'Could not request amendment' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permission = await requireAnyPermission(session, [
      Permissions.TRIP_MANAGE,
      Permissions.TRIP_AUTHORIZE_REGIONAL,
      Permissions.TRIP_AUTHORIZE_NATIONAL,
      Permissions.TRIP_AUTHORIZE_EMERGENCY,
    ]);
    if (permission instanceof NextResponse) return permission;
    const { id } = await params;
    const body = await request.json() as { amendmentId?: string; action?: 'approve' | 'reject'; comment?: string };
    if (!body.amendmentId || !['approve', 'reject'].includes(body.action || '')) {
      return NextResponse.json({ error: 'Amendment and decision are required' }, { status: 422 });
    }
    const comment = body.comment?.trim() || '';
    if (comment.length > 1000) {
      return NextResponse.json({ error: 'Decision comment must be 1000 characters or fewer' }, { status: 422 });
    }

    const db = getDb();
    const [record] = await db.select({ amendment: tripAmendments, authority: tripAuthorities })
      .from(tripAmendments)
      .innerJoin(tripAuthorities, eq(tripAuthorities.id, tripAmendments.authorityId))
      .where(and(
        eq(tripAmendments.id, body.amendmentId),
        eq(tripAuthorities.tripId, id),
        eq(tripAuthorities.tenantId, session.tenantId),
      ))
      .limit(1);
    if (!record) return NextResponse.json({ error: 'Amendment not found' }, { status: 404 });
    if (record.amendment.status !== 'pending') {
      return NextResponse.json({ error: 'This amendment already has a decision' }, { status: 409 });
    }

    const now = new Date();
    const auditBefore = JSON.stringify(record.amendment.originalValue ?? {});
    const auditAfter = JSON.stringify(record.amendment.newValue ?? {});
    const decisionReason = comment || record.amendment.reason;

    if (body.action === 'reject') {
      // Claim-and-audit in one statement so a concurrent approval/rejection
      // cannot leave a second, false decision event after the pending row has
      // already been consumed by another operator.
      await db.execute(sql`
        WITH amendment_claim AS (
          UPDATE trip_amendments
          SET status = 'rejected',
              approved_by_user_id = ${session.user.id},
              approved_at = ${now}
          WHERE id = ${body.amendmentId}::uuid
            AND authority_id = ${record.authority.id}::uuid
            AND status = 'pending'
          RETURNING id
        ),
        audit_insert AS (
          INSERT INTO audit_events (
            tenant_id, tenant_sequence, event_type, actor_user_id, action,
            entity_type, entity_id, before, after, reason, source_channel
          )
          SELECT
            ${session.tenantId}::uuid,
            ${Date.now()},
            'trip_authority_amendment_rejected',
            ${session.user.id},
            'reject',
            'trip_amendment',
            ${body.amendmentId}::uuid,
            ${auditBefore}::jsonb,
            ${auditAfter}::jsonb,
            ${decisionReason},
            'web'
          FROM amendment_claim
          RETURNING id
        )
        SELECT CAST(CASE
          WHEN (SELECT count(*) FROM amendment_claim) = 1
           AND (SELECT count(*) FROM audit_insert) = 1
          THEN '1'
          ELSE 'atomic_authority_amendment_failed_' || (SELECT count(*) FROM amendment_claim)::text
        END AS integer) AS committed
      `);
      return NextResponse.json({ success: true });
    }

    const values = record.amendment.newValue;
    const amendmentType = record.amendment.amendmentType;
    const validFrom = amendmentType === 'date_extension' ? optionalDate(values.validFrom) : null;
    const validUntil = amendmentType === 'date_extension' ? optionalDate(values.validUntil) : null;
    if (amendmentType === 'date_extension') {
      if (values.validFrom != null && !validFrom) {
        return NextResponse.json({ error: 'Amended start date is invalid' }, { status: 422 });
      }
      if (values.validUntil != null && !validUntil) {
        return NextResponse.json({ error: 'Amended end date is invalid' }, { status: 422 });
      }
      const effectiveStart = validFrom ?? record.authority.validFrom;
      const effectiveEnd = validUntil ?? record.authority.validUntil;
      if (effectiveStart && effectiveEnd && effectiveEnd <= effectiveStart) {
        return NextResponse.json({ error: 'Amended authority end date must be after the start date' }, { status: 422 });
      }
    }

    const origin = amendmentType === 'route_change' && values.origin ? String(values.origin) : null;
    const destination = amendmentType === 'route_change' && values.destination ? String(values.destination) : null;
    const approvedRoute = amendmentType === 'route_change' && values.approvedRoute ? String(values.approvedRoute) : null;
    const purpose = amendmentType === 'purpose_clarification' ? String(values.purpose || '') : null;
    const specialConditions = amendmentType === 'special_authorisation' ? String(values.specialConditions || '') : null;
    const specialAuthorityGranted = amendmentType === 'special_authorisation' ? values.specialAuthorityGranted === true : null;

    // One statement owns the full approval transition. The pending amendment is
    // claimed first; every dependent write is chained to that claim. If the
    // authority version changed concurrently, the final guard deliberately
    // raises an error and PostgreSQL rolls the entire statement back.
    await db.execute(sql`
      WITH amendment_claim AS (
        UPDATE trip_amendments
        SET status = 'approved',
            approved_by_user_id = ${session.user.id},
            approved_at = ${now}
        WHERE id = ${body.amendmentId}::uuid
          AND authority_id = ${record.authority.id}::uuid
          AND status = 'pending'
        RETURNING id
      ),
      authority_claim AS (
        UPDATE trip_authorities
        SET version = ${record.amendment.version},
            document_version = ${record.amendment.version},
            valid_from = CASE
              WHEN ${amendmentType} = 'date_extension' AND ${validFrom}::timestamptz IS NOT NULL THEN ${validFrom}
              ELSE valid_from
            END,
            valid_until = CASE
              WHEN ${amendmentType} = 'date_extension' AND ${validUntil}::timestamptz IS NOT NULL THEN ${validUntil}
              ELSE valid_until
            END,
            origin = CASE
              WHEN ${amendmentType} = 'route_change' AND ${origin}::text IS NOT NULL THEN ${origin}
              ELSE origin
            END,
            destination = CASE
              WHEN ${amendmentType} = 'route_change' AND ${destination}::text IS NOT NULL THEN ${destination}
              ELSE destination
            END,
            approved_route = CASE
              WHEN ${amendmentType} = 'route_change' AND ${approvedRoute}::text IS NOT NULL THEN ${approvedRoute}
              ELSE approved_route
            END,
            purpose = CASE WHEN ${amendmentType} = 'purpose_clarification' THEN ${purpose} ELSE purpose END,
            special_conditions = CASE WHEN ${amendmentType} = 'special_authorisation' THEN ${specialConditions} ELSE special_conditions END,
            special_authority_granted = CASE
              WHEN ${amendmentType} = 'special_authorisation' THEN ${specialAuthorityGranted}
              ELSE special_authority_granted
            END,
            updated_at = ${now}
        WHERE id = ${record.authority.id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND version = ${record.authority.version}
          AND EXISTS (SELECT 1 FROM amendment_claim)
        RETURNING *
      ),
      version_insert AS (
        INSERT INTO trip_authority_versions (
          authority_id, version, status, snapshot, reason, created_by_user_id
        )
        SELECT
          id,
          version,
          status,
          to_jsonb(authority_claim),
          ${record.amendment.reason},
          ${session.user.id}
        FROM authority_claim
        RETURNING id
      ),
      documents_update AS (
        UPDATE generated_documents
        SET status = 'superseded', updated_at = ${now}
        WHERE tenant_id = ${session.tenantId}::uuid
          AND entity_type = 'trip'
          AND entity_id = ${id}::uuid
          AND status = 'issued'
          AND EXISTS (SELECT 1 FROM version_insert)
        RETURNING id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id, action,
          entity_type, entity_id, before, after, reason, source_channel
        )
        SELECT
          ${session.tenantId}::uuid,
          ${Date.now()},
          'trip_authority_amendment_approved',
          ${session.user.id},
          'approve',
          'trip_amendment',
          ${body.amendmentId}::uuid,
          ${auditBefore}::jsonb,
          ${auditAfter}::jsonb,
          ${decisionReason},
          'web'
        FROM version_insert
        RETURNING id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM amendment_claim) = 1
         AND (SELECT count(*) FROM authority_claim) = 1
         AND (SELECT count(*) FROM version_insert) = 1
         AND (SELECT count(*) FROM audit_insert) = 1
        THEN '1'
        ELSE 'atomic_authority_amendment_failed_' || (SELECT count(*) FROM amendment_claim)::text
      END AS integer) AS committed
    `);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[authority/amendments] PATCH failed:', error);
    if ((error as { code?: string })?.code === '23505') {
      return NextResponse.json(
        { error: 'This Trip Authority changed while the amendment was being decided. Refresh and review the latest version.' },
        { status: 409 },
      );
    }
    if (String(error).includes('atomic_authority_amendment_failed')) {
      return NextResponse.json(
        { error: 'This Trip Authority changed while the amendment was being decided. Refresh and review the latest version.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Could not decide amendment' }, { status: 500 });
  }
}
