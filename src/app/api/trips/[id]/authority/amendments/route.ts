import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  tripAmendments,
  tripAuthorities,
  tripAuthorityVersions,
} from '@/db/schema/trips';
import { generatedDocuments } from '@/db/schema/documents';
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
    const auditEvent = {
      tenantId: session.tenantId,
      tenantSequence: Date.now(),
      eventType: `trip_authority_amendment_${body.action === 'approve' ? 'approved' : 'rejected'}`,
      actorUserId: session.user.id,
      action: body.action!,
      entityType: 'trip_amendment',
      entityId: body.amendmentId,
      before: record.amendment.originalValue,
      after: record.amendment.newValue,
      reason: comment || record.amendment.reason,
      sourceChannel: 'web',
    } as const;

    if (body.action === 'reject') {
      await runAtomicMutations((tx) => [
        tx.update(tripAmendments).set({
          status: 'rejected',
          approvedByUserId: session.user.id,
          approvedAt: now,
        }).where(and(
          eq(tripAmendments.id, body.amendmentId!),
          eq(tripAmendments.status, 'pending'),
        )),
        tx.insert(auditEvents).values(auditEvent),
      ]);
      return NextResponse.json({ success: true });
    }

    const values = record.amendment.newValue;
    const patch: Partial<typeof tripAuthorities.$inferInsert> = {
      version: record.amendment.version,
      documentVersion: record.amendment.version,
      updatedAt: now,
    };
    if (record.amendment.amendmentType === 'date_extension') {
      if (values.validFrom) patch.validFrom = new Date(String(values.validFrom));
      if (values.validUntil) patch.validUntil = new Date(String(values.validUntil));
    } else if (record.amendment.amendmentType === 'route_change') {
      if (values.origin) patch.origin = String(values.origin);
      if (values.destination) patch.destination = String(values.destination);
      if (values.approvedRoute) patch.approvedRoute = String(values.approvedRoute);
    } else if (record.amendment.amendmentType === 'purpose_clarification') {
      patch.purpose = String(values.purpose || '');
    } else {
      patch.specialConditions = String(values.specialConditions || '');
      patch.specialAuthorityGranted = values.specialAuthorityGranted === true;
    }

    await runAtomicMutations((tx) => [
      // Do not swallow this unique conflict: the immutable version row is also
      // the concurrency guard that prevents two approval decisions from winning.
      tx.insert(tripAuthorityVersions).values({
        authorityId: record.authority.id,
        version: record.authority.version,
        status: 'superseded',
        snapshot: record.authority as unknown as Record<string, unknown>,
        reason: record.amendment.reason,
        createdByUserId: session.user.id,
      }),
      tx.update(tripAuthorities).set(patch).where(and(
        eq(tripAuthorities.id, record.authority.id),
        eq(tripAuthorities.tenantId, session.tenantId),
        eq(tripAuthorities.version, record.authority.version),
      )),
      tx.update(generatedDocuments).set({
        status: 'superseded',
        updatedAt: now,
      }).where(and(
        eq(generatedDocuments.tenantId, session.tenantId),
        eq(generatedDocuments.entityType, 'trip'),
        eq(generatedDocuments.entityId, id),
        eq(generatedDocuments.status, 'issued'),
      )),
      tx.update(tripAmendments).set({
        status: 'approved',
        approvedByUserId: session.user.id,
        approvedAt: now,
      }).where(and(
        eq(tripAmendments.id, body.amendmentId),
        eq(tripAmendments.status, 'pending'),
      )),
      tx.insert(auditEvents).values(auditEvent),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[authority/amendments] PATCH failed:', error);
    if ((error as { code?: string })?.code === '23505') {
      return NextResponse.json(
        { error: 'This Trip Authority changed while the amendment was being decided. Refresh and review the latest version.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Could not decide amendment' }, { status: 500 });
  }
}
