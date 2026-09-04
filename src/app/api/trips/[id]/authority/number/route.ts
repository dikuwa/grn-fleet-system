import { NextRequest, NextResponse } from 'next/server';
import { and, eq, ne, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { tripAuthorities } from '@/db/schema/trips';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  ManualAuthorityNumberError,
  normaliseManualAuthorityNumber,
  validateManualAuthorityNumber,
} from '@/lib/trip-authority';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const permission = await requirePermission(session, Permissions.TRIP_AUTHORITY_OVERRIDE_NUMBER);
  if (permission instanceof NextResponse) return permission;

  const { id: tripId } = await params;
  const body = await request.json();
  let authorityNumber: string;
  try {
    authorityNumber = validateManualAuthorityNumber(
      normaliseManualAuthorityNumber(body.authorityNumber),
    );
  } catch (error) {
    if (error instanceof ManualAuthorityNumberError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const reason = String(body.reason || '').trim();
  if (reason.length < 10) {
    return NextResponse.json(
      { error: 'Record an operational reason of at least 10 characters.' },
      { status: 400 },
    );
  }
  if (reason.length > 500) {
    return NextResponse.json({ error: 'Operational reason must be 500 characters or fewer.' }, { status: 422 });
  }

  if (!UUID_PATTERN.test(tripId)) {
    return NextResponse.json({ error: 'Trip Authority not found' }, { status: 404 });
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
  try {
    await db.execute(sql`
      WITH authority_claim AS (
        UPDATE trip_authorities
        SET authority_number = ${authorityNumber},
            authority_number_source = 'manual_override',
            manual_number_override_reason = ${reason},
            manual_number_override_by_user_id = ${session.user.id},
            manual_number_override_at = ${now},
            updated_at = ${now}
        WHERE id = ${authority.id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND status = ${authority.status}
          AND authority_number IS NOT DISTINCT FROM ${authority.authorityNumber}
          AND status NOT IN ('in_progress', 'returned', 'completed', 'closed', 'cancelled', 'superseded')
        RETURNING id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id, action,
          entity_type, entity_id, before, after, reason, summary, source_channel
        )
        SELECT
          ${session.tenantId}::uuid,
          ${Date.now()},
          'trip_authority_number_overridden',
          ${session.user.id},
          'override_number',
          'trip_authority',
          ${authority.id}::uuid,
          jsonb_build_object('authorityNumber', ${authority.authorityNumber}::text),
          jsonb_build_object('authorityNumber', ${authorityNumber}::text),
          ${reason},
          ${`Trip Authority number changed from ${authority.authorityNumber} to ${authorityNumber}`},
          'web'
        FROM authority_claim
        RETURNING id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM authority_claim) = 1
         AND (SELECT count(*) FROM audit_insert) = 1
        THEN '1'
        ELSE 'authority_number_correction_conflict'
      END AS integer) AS committed
    `);
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') {
      return NextResponse.json(
        { error: 'That Trip Authority number already exists in this organisation.' },
        { status: 409 },
      );
    }
    if (String(error).includes('authority_number_correction_conflict')) {
      return NextResponse.json(
        {
          error:
            'The Trip Authority changed while the number was being corrected. Refresh and review the current authority state before trying again.',
        },
        { status: 409 },
      );
    }
    throw error;
  }

  const [updated] = await db
    .select()
    .from(tripAuthorities)
    .where(and(eq(tripAuthorities.id, authority.id), eq(tripAuthorities.tenantId, session.tenantId)))
    .limit(1);
  return NextResponse.json({ success: true, data: updated });
}
