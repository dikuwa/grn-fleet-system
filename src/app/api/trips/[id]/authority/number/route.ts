import { NextRequest, NextResponse } from 'next/server';
import { and, eq, ne } from 'drizzle-orm';
import { getDb } from '@/db';
import { auditEvents } from '@/db/schema/audit';
import { tripAuthorities } from '@/db/schema/trips';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { runAtomicMutations } from '@/lib/db-atomic';

function normalizeAuthorityNumber(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9/-]/gi, '')
    .toUpperCase();
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const permission = await requirePermission(session, Permissions.TRIP_AUTHORITY_OVERRIDE_NUMBER);
  if (permission instanceof NextResponse) return permission;

  const { id: tripId } = await params;
  const body = await request.json();
  const authorityNumber = normalizeAuthorityNumber(String(body.authorityNumber || ''));
  const reason = String(body.reason || '').trim();
  if (!/^TA-[A-Z0-9/-]{4,40}$/.test(authorityNumber)) {
    return NextResponse.json(
      { error: 'Use an authority number beginning with TA- and containing letters or numbers.' },
      { status: 400 },
    );
  }
  if (reason.length < 10) {
    return NextResponse.json(
      { error: 'Record an operational reason of at least 10 characters.' },
      { status: 400 },
    );
  }
  if (reason.length > 500) {
    return NextResponse.json({ error: 'Operational reason must be 500 characters or fewer.' }, { status: 422 });
  }

  const db = getDb();
  const [authority] = await db
    .select()
    .from(tripAuthorities)
    .where(and(eq(tripAuthorities.tripId, tripId), eq(tripAuthorities.tenantId, session.tenantId)))
    .limit(1);
  if (!authority) return NextResponse.json({ error: 'Trip Authority not found' }, { status: 404 });
  if (
    ['in_progress', 'returned', 'completed', 'closed', 'cancelled', 'superseded'].includes(
      authority.status,
    )
  ) {
    return NextResponse.json(
      { error: 'An operational or final authority number cannot be changed.' },
      { status: 409 },
    );
  }
  const [duplicate] = await db
    .select({ id: tripAuthorities.id })
    .from(tripAuthorities)
    .where(
      and(
        eq(tripAuthorities.tenantId, session.tenantId),
        eq(tripAuthorities.authorityNumber, authorityNumber),
        ne(tripAuthorities.id, authority.id),
      ),
    )
    .limit(1);
  if (duplicate) {
    return NextResponse.json(
      { error: 'That Trip Authority number already exists in this organisation.' },
      { status: 409 },
    );
  }

  const now = new Date();
  await runAtomicMutations((tx) => [
    tx.update(tripAuthorities)
      .set({
        authorityNumber,
        authorityNumberSource: 'manual_override',
        manualNumberOverrideReason: reason,
        manualNumberOverrideByUserId: session.user.id,
        manualNumberOverrideAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(tripAuthorities.id, authority.id), eq(tripAuthorities.tenantId, session.tenantId)),
      ),
    tx.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: Date.now(),
      eventType: 'trip_authority_number_overridden',
      actorUserId: session.user.id,
      action: 'override_number',
      entityType: 'trip_authority',
      entityId: authority.id,
      before: { authorityNumber: authority.authorityNumber },
      after: { authorityNumber },
      reason,
      summary: `Trip Authority number changed from ${authority.authorityNumber} to ${authorityNumber}`,
      sourceChannel: 'web',
    }),
  ]);

  const [updated] = await db
    .select()
    .from(tripAuthorities)
    .where(and(eq(tripAuthorities.id, authority.id), eq(tripAuthorities.tenantId, session.tenantId)))
    .limit(1);
  return NextResponse.json({ success: true, data: updated });
}
