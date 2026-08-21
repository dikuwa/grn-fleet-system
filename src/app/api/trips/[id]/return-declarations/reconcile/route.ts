import { NextRequest, NextResponse } from 'next/server';
import { and, eq, ne, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  fuelReceipts,
  fuelTransactions,
  tripAuthorities,
  tripExpenses,
  tripIncidents,
  trips,
} from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

type RouteContext = { params: Promise<{ id: string }> };

type ReturnDeclaration = {
  incidentDeclared?: boolean;
  outstandingReceiptsDeclared?: boolean;
  reconciledAt?: string | null;
};

function readReturnDeclaration(data: Record<string, unknown> | null | undefined): ReturnDeclaration | null {
  const value = data?.returnDeclaration;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as ReturnDeclaration;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const actionCheck = await requireDashboardAction(
      session,
      '/dashboard/trips/closure-review',
      'approve',
    );
    if (actionCheck instanceof NextResponse) return actionCheck;
    const permissionCheck = await requirePermission(session, Permissions.TRIP_CLOSE);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const { id: tripId } = await context.params;
    const db = getDb();
    const tenantId = session.tenantId;

    const [record] = await db
      .select({
        tripStatus: trips.status,
        authorityId: tripAuthorities.id,
        authorityStatus: tripAuthorities.status,
        authorityData: tripAuthorities.data,
      })
      .from(trips)
      .innerJoin(
        tripAuthorities,
        and(eq(tripAuthorities.tripId, trips.id), eq(tripAuthorities.tenantId, tenantId)),
      )
      .where(and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)))
      .limit(1);

    if (!record) return NextResponse.json({ error: 'Trip Authority not found' }, { status: 404 });
    if (!['return_inspection', 'closure_review'].includes(record.tripStatus)) {
      return NextResponse.json(
        { error: 'Return declarations can only be reconciled after the vehicle has returned.' },
        { status: 409 },
      );
    }
    if (!['awaiting_reconciliation', 'completed'].includes(record.authorityStatus)) {
      return NextResponse.json(
        { error: `Trip Authority is not ready for return reconciliation (${record.authorityStatus}).` },
        { status: 409 },
      );
    }

    const declaration = readReturnDeclaration(record.authorityData);
    if (!declaration) {
      return NextResponse.json(
        { error: 'A recorded return declaration is required before reconciliation.' },
        { status: 409 },
      );
    }
    if (declaration.reconciledAt) {
      return NextResponse.json({ success: true, idempotentReplay: true, reconciledAt: declaration.reconciledAt });
    }

    const incidentDeclared = declaration.incidentDeclared === true;
    const receiptsDeclared = declaration.outstandingReceiptsDeclared === true;

    const [[incidentEvidence], [receiptEvidence], [expenseReceiptEvidence], [unverifiedFuel], [unverifiedExpense]] =
      await Promise.all([
        db
          .select({ id: tripIncidents.id })
          .from(tripIncidents)
          .where(and(eq(tripIncidents.tripId, tripId), eq(tripIncidents.tenantId, tenantId)))
          .limit(1),
        db
          .select({ id: fuelReceipts.id })
          .from(fuelReceipts)
          .innerJoin(fuelTransactions, eq(fuelTransactions.id, fuelReceipts.transactionId))
          .innerJoin(vehicles, eq(vehicles.id, fuelTransactions.vehicleId))
          .where(
            and(
              eq(fuelTransactions.tripId, tripId),
              eq(vehicles.tenantId, tenantId),
              sql`(${fuelReceipts.tenantId} is null or ${fuelReceipts.tenantId} = ${tenantId}::uuid)`,
            ),
          )
          .limit(1),
        db
          .select({ id: tripExpenses.id })
          .from(tripExpenses)
          .where(
            and(
              eq(tripExpenses.tripId, tripId),
              eq(tripExpenses.tenantId, tenantId),
              sql`${tripExpenses.receiptKey} is not null and length(trim(${tripExpenses.receiptKey})) > 0`,
            ),
          )
          .limit(1),
        db
          .select({ id: fuelTransactions.id })
          .from(fuelTransactions)
          .innerJoin(vehicles, eq(vehicles.id, fuelTransactions.vehicleId))
          .where(
            and(
              eq(fuelTransactions.tripId, tripId),
              eq(vehicles.tenantId, tenantId),
              eq(fuelTransactions.isVerified, false),
            ),
          )
          .limit(1),
        db
          .select({ id: tripExpenses.id })
          .from(tripExpenses)
          .where(
            and(
              eq(tripExpenses.tripId, tripId),
              eq(tripExpenses.tenantId, tenantId),
              ne(tripExpenses.verificationStatus, 'verified'),
            ),
          )
          .limit(1),
      ]);

    const incidentEvidenceMismatch = !incidentDeclared && Boolean(incidentEvidence);
    const hasPositiveDeclaration = incidentDeclared || receiptsDeclared;
    if (!hasPositiveDeclaration && !incidentEvidenceMismatch) {
      return NextResponse.json(
        { error: 'The recorded return declarations already match the available trip evidence.' },
        { status: 409 },
      );
    }

    if (incidentDeclared && !incidentEvidence) {
      return NextResponse.json(
        { error: 'An incident was declared at return, but no incident record has been captured for this trip.' },
        { status: 409 },
      );
    }
    if (receiptsDeclared && !receiptEvidence && !expenseReceiptEvidence) {
      return NextResponse.json(
        { error: 'Outstanding receipts were declared at return, but no receipt evidence has been attached to this trip.' },
        { status: 409 },
      );
    }
    if (unverifiedFuel || unverifiedExpense) {
      return NextResponse.json(
        { error: 'Verify all trip fuel and expense entries before reconciling the return declarations.' },
        { status: 409 },
      );
    }

    const now = new Date();
    await db.execute(sql`
      WITH authority_claim AS (
        UPDATE trip_authorities ta
        SET data = jsonb_set(
              jsonb_set(
                jsonb_set(
                  COALESCE(ta.data, '{}'::jsonb),
                  '{returnDeclaration,reconciledAt}',
                  to_jsonb(${now}::timestamptz),
                  true
                ),
                '{returnDeclaration,reconciledByUserId}',
                to_jsonb(${session.user.id}::text),
                true
              ),
              '{returnDeclaration,reconciliationReason}',
              to_jsonb(${incidentEvidenceMismatch ? 'incident_evidence_after_negative_declaration' : 'positive_return_declaration'}::text),
              true
            ),
            updated_at = ${now}
        WHERE ta.id = ${record.authorityId}::uuid
          AND ta.tenant_id = ${tenantId}::uuid
          AND ta.status IN ('awaiting_reconciliation', 'completed')
          AND NULLIF(ta.data -> 'returnDeclaration' ->> 'reconciledAt', '') IS NULL
          AND EXISTS (
            SELECT 1
            FROM trips t
            WHERE t.id = ${tripId}::uuid
              AND t.tenant_id = ${tenantId}::uuid
              AND t.status IN ('return_inspection', 'closure_review')
          )
          AND (
            COALESCE((ta.data -> 'returnDeclaration' ->> 'incidentDeclared')::boolean, false)
            OR COALESCE((ta.data -> 'returnDeclaration' ->> 'outstandingReceiptsDeclared')::boolean, false)
            OR (
              NOT COALESCE((ta.data -> 'returnDeclaration' ->> 'incidentDeclared')::boolean, false)
              AND EXISTS (
                SELECT 1 FROM trip_incidents ti
                WHERE ti.trip_id = ${tripId}::uuid
                  AND ti.tenant_id = ${tenantId}::uuid
              )
            )
          )
          AND (
            NOT COALESCE((ta.data -> 'returnDeclaration' ->> 'incidentDeclared')::boolean, false)
            OR EXISTS (
              SELECT 1 FROM trip_incidents ti
              WHERE ti.trip_id = ${tripId}::uuid
                AND ti.tenant_id = ${tenantId}::uuid
            )
          )
          AND (
            NOT COALESCE((ta.data -> 'returnDeclaration' ->> 'outstandingReceiptsDeclared')::boolean, false)
            OR EXISTS (
              SELECT 1
              FROM fuel_receipts fr
              JOIN fuel_transactions ft ON ft.id = fr.transaction_id
              JOIN vehicles v ON v.id = ft.vehicle_id
              WHERE ft.trip_id = ${tripId}::uuid
                AND v.tenant_id = ${tenantId}::uuid
                AND (fr.tenant_id IS NULL OR fr.tenant_id = ${tenantId}::uuid)
            )
            OR EXISTS (
              SELECT 1
              FROM trip_expenses te
              WHERE te.trip_id = ${tripId}::uuid
                AND te.tenant_id = ${tenantId}::uuid
                AND te.receipt_key IS NOT NULL
                AND length(trim(te.receipt_key)) > 0
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM fuel_transactions ft
            JOIN vehicles v ON v.id = ft.vehicle_id
            WHERE ft.trip_id = ${tripId}::uuid
              AND v.tenant_id = ${tenantId}::uuid
              AND ft.is_verified = false
          )
          AND NOT EXISTS (
            SELECT 1 FROM trip_expenses te
            WHERE te.trip_id = ${tripId}::uuid
              AND te.tenant_id = ${tenantId}::uuid
              AND te.verification_status <> 'verified'
          )
        RETURNING id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id, action,
          entity_type, entity_id, summary, after, source_channel
        )
        SELECT
          ${tenantId}::uuid,
          ${Date.now()},
          'trip_return_declarations_reconciled',
          ${session.user.id},
          'reconcile',
          'trip',
          ${tripId}::uuid,
          ${incidentEvidenceMismatch
            ? 'Return declaration reconciled after incident evidence contradicted the recorded negative declaration'
            : 'Return declarations reconciled before trip closure'},
          jsonb_build_object(
            'incidentDeclared', ${incidentDeclared}::boolean,
            'outstandingReceiptsDeclared', ${receiptsDeclared}::boolean,
            'incidentEvidencePresent', ${Boolean(incidentEvidence)}::boolean,
            'incidentEvidenceMismatch', ${incidentEvidenceMismatch}::boolean,
            'reconciledAt', ${now}::timestamptz
          ),
          'web'
        FROM authority_claim
        RETURNING id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM authority_claim) = 1
         AND (SELECT count(*) FROM audit_insert) = 1
        THEN '1'
        ELSE 'return_declaration_reconciliation_conflict'
      END AS integer) AS committed
    `);

    return NextResponse.json({
      success: true,
      idempotentReplay: false,
      reconciledAt: now.toISOString(),
      incidentEvidenceMismatch,
    });
  } catch (error) {
    console.error('[return-declarations/reconcile] POST failed:', error);
    if (String(error).includes('return_declaration_reconciliation_conflict')) {
      return NextResponse.json(
        { error: 'Return declaration evidence changed while reconciliation was being recorded. Refresh and review the latest trip.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to reconcile return declarations' }, { status: 500 });
  }
}
