import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalDriverLicences, externalParties } from '@/db/schema/external-parties';
import { vehicleDefects, vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import {
  tripAuthorities,
  trips,
  vehicleAllocations,
  vehicleInspections,
} from '@/db/schema/trips';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { namibiaLicenceClassCovers } from '@/lib/namibia-licence';
import { Permissions } from '@/lib/permissions';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

type RouteContext = { params: Promise<{ id: string }> };

function snapshotAuthorityVersion(snapshotData: unknown): number | null {
  if (!snapshotData || typeof snapshotData !== 'object' || Array.isArray(snapshotData)) return null;
  const renderData = (snapshotData as Record<string, unknown>).renderData;
  if (!renderData || typeof renderData !== 'object' || Array.isArray(renderData)) return null;
  const raw = (renderData as Record<string, unknown>).documentVersion;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const actionCheck = await requireDashboardAction(session, '/dashboard/trips', 'update');
    if (actionCheck instanceof NextResponse) return actionCheck;
    const permissionCheck = await requirePermission(session, Permissions.TRIP_MANAGE);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      issueOdometer?: number;
      keysIssued?: boolean;
      fuelCardIssued?: boolean;
      notes?: string;
    };
    const issueOdometer = Number(body.issueOdometer);
    const keysIssued = body.keysIssued ?? true;
    const fuelCardIssued = body.fuelCardIssued ?? false;
    const notes = body.notes?.trim() || null;
    if (notes && notes.length > 2000) {
      return NextResponse.json({ error: 'Issue notes must be 2000 characters or fewer' }, { status: 422 });
    }
    if (keysIssued !== true) {
      return NextResponse.json({ error: 'Vehicle keys must be issued before departure' }, { status: 422 });
    }

    const db = getDb();
    const tenantId = session.tenantId;
    const [record] = await db
      .select({
        assignmentId: externalDriverAssignments.id,
        externalPartyId: externalDriverAssignments.externalPartyId,
        assignmentState: externalDriverAssignments.state,
        assignmentIssueId: externalDriverAssignments.issueId,
        assignmentAcceptedAt: externalDriverAssignments.acceptedAt,
        licenceId: externalDriverAssignments.licenceId,
        licenceStatus: externalDriverLicences.verificationStatus,
        licenceClass: externalDriverLicences.licenceClass,
        licenceExpiry: externalDriverLicences.expiryDate,
        partyStatus: externalParties.status,
        tripStatus: trips.status,
        tripIssuedAt: trips.issuedAt,
        requestId: trips.requestId,
        requestReference: transportRequests.reference,
        requestStatus: transportRequests.status,
        requestExternalDriverPartyId: transportRequests.assignedDriverExternalPartyId,
        allocationId: trips.allocationId,
        allocationState: vehicleAllocations.state,
        allocationVersion: vehicleAllocations.version,
        vehicleId: trips.vehicleId,
        vehicleStatus: vehicles.status,
        vehicleOdometer: vehicles.currentOdometer,
        vehicleRequiredLicenceClass: vehicles.requiredLicenceClass,
        vehicleProfessionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
        authorityId: tripAuthorities.id,
        authorityStatus: tripAuthorities.status,
        authorityDocumentVersion: tripAuthorities.documentVersion,
        authorityBeginningOdometer: tripAuthorities.beginningOdometer,
        authorityValidUntil: tripAuthorities.validUntil,
      })
      .from(externalDriverAssignments)
      .innerJoin(trips, eq(trips.id, externalDriverAssignments.tripId))
      .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, externalDriverAssignments.allocationId))
      .innerJoin(transportRequests, eq(transportRequests.id, externalDriverAssignments.requestId))
      .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .innerJoin(externalParties, eq(externalParties.id, externalDriverAssignments.externalPartyId))
      .innerJoin(externalDriverLicences, eq(externalDriverLicences.id, externalDriverAssignments.licenceId))
      .where(
        and(
          eq(externalDriverAssignments.tripId, id),
          eq(externalDriverAssignments.tenantId, tenantId),
          eq(trips.tenantId, tenantId),
          eq(transportRequests.tenantId, tenantId),
          eq(vehicles.tenantId, tenantId),
          eq(tripAuthorities.tenantId, tenantId),
          eq(externalParties.tenantId, tenantId),
          eq(externalDriverLicences.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!record) return NextResponse.json({ error: 'External-driver trip not found' }, { status: 404 });
    if (record.assignmentState !== 'accepted' || !record.assignmentAcceptedAt) {
      return NextResponse.json({ error: 'External driver acceptance must be recorded before vehicle issue' }, { status: 409 });
    }
    if (record.requestExternalDriverPartyId !== record.externalPartyId) {
      return NextResponse.json({ error: 'The accepted external driver is no longer the request’s assigned driver' }, { status: 409 });
    }
    if (record.assignmentIssueId || record.tripIssuedAt) {
      return NextResponse.json({ error: 'Vehicle has already been physically issued for this trip' }, { status: 409 });
    }
    if (record.tripStatus !== 'pending') {
      return NextResponse.json({ error: `Cannot issue vehicle for trip with status "${record.tripStatus}".` }, { status: 409 });
    }
    if (record.allocationState !== 'confirmed') {
      return NextResponse.json({ error: `Allocation must be confirmed before physical issue (${record.allocationState})` }, { status: 409 });
    }
    if (record.requestStatus !== 'authorised') {
      return NextResponse.json({ error: 'Final authorisation is required before issue' }, { status: 409 });
    }
    if (record.authorityStatus !== 'ready_for_departure') {
      return NextResponse.json({ error: `Trip Authority is not ready for physical issue (${record.authorityStatus})` }, { status: 409 });
    }

    const [latestAuthorityDocument] = await db
      .select({
        id: generatedDocuments.id,
        status: generatedDocuments.status,
        documentVersion: generatedDocuments.documentVersion,
        snapshotData: generatedDocuments.snapshotData,
      })
      .from(generatedDocuments)
      .where(and(
        eq(generatedDocuments.tenantId, tenantId),
        eq(generatedDocuments.entityType, 'vehicle_allocation'),
        eq(generatedDocuments.entityId, record.allocationId),
        eq(generatedDocuments.documentType, 'trip_authority'),
      ))
      .orderBy(desc(generatedDocuments.documentVersion))
      .limit(1);
    const issuedSnapshotAuthorityVersion = snapshotAuthorityVersion(latestAuthorityDocument?.snapshotData);
    if (
      !latestAuthorityDocument ||
      latestAuthorityDocument.status !== 'issued' ||
      issuedSnapshotAuthorityVersion !== record.authorityDocumentVersion
    ) {
      return NextResponse.json(
        {
          error: !latestAuthorityDocument
            ? 'The Trip Authority document must be generated and formally issued before physical vehicle issue.'
            : latestAuthorityDocument.status !== 'issued'
              ? `The current Trip Authority (v${latestAuthorityDocument.documentVersion}) must be formally issued before physical vehicle issue.`
              : `The issued Trip Authority snapshot represents authority version ${issuedSnapshotAuthorityVersion ?? 'unknown'}, but the current authority is version ${record.authorityDocumentVersion}. Regenerate and formally issue the current authority before physical vehicle issue.`,
        },
        { status: 409 },
      );
    }

    if (record.vehicleStatus !== 'available') {
      return NextResponse.json({ error: `Vehicle is not available for issue (${record.vehicleStatus})` }, { status: 409 });
    }
    if (record.vehicleProfessionalAuthorisationRequired) {
      return NextResponse.json(
        {
          error:
            'This vehicle now requires professional driving authorisation. External issue is blocked until verified professional-authorisation evidence is supported for the assignment.',
        },
        { status: 409 },
      );
    }
    if (record.partyStatus !== 'active' || record.licenceStatus !== 'verified') {
      return NextResponse.json({ error: 'External driver eligibility is no longer valid' }, { status: 409 });
    }
    if (
      record.vehicleRequiredLicenceClass &&
      !namibiaLicenceClassCovers(record.licenceClass, record.vehicleRequiredLicenceClass)
    ) {
      return NextResponse.json(
        { error: `External driver licence class ${record.licenceClass} does not cover vehicle requirement ${record.vehicleRequiredLicenceClass}` },
        { status: 409 },
      );
    }
    const expiryAt = new Date(`${record.licenceExpiry}T23:59:59.999Z`);
    const requiredThrough = record.authorityValidUntil ?? new Date();
    if (!Number.isFinite(expiryAt.getTime()) || expiryAt < requiredThrough) {
      return NextResponse.json({ error: 'External driver licence no longer covers the authorised trip period' }, { status: 409 });
    }

    const [departureInspection] = await db
      .select({
        id: vehicleInspections.id,
        odometerReading: vehicleInspections.odometerReading,
        status: vehicleInspections.status,
        overallPass: vehicleInspections.overallPass,
      })
      .from(vehicleInspections)
      .where(
        and(
          eq(vehicleInspections.tenantId, tenantId),
          eq(vehicleInspections.tripId, id),
          eq(vehicleInspections.vehicleId, record.vehicleId),
          eq(vehicleInspections.type, 'departure'),
        ),
      )
      .orderBy(desc(vehicleInspections.createdAt), desc(vehicleInspections.id))
      .limit(1);
    if (!departureInspection || departureInspection.status !== 'completed' || departureInspection.overallPass !== true) {
      return NextResponse.json(
        { error: 'The latest pre-departure inspection must be completed and passed before issue' },
        { status: 409 },
      );
    }

    const [blockingDefect] = await db
      .select({ id: vehicleDefects.id })
      .from(vehicleDefects)
      .innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
      .where(
        and(
          eq(vehicleDefects.vehicleId, record.vehicleId),
          eq(vehicles.tenantId, tenantId),
          eq(vehicleDefects.isBlocking, true),
          isNull(vehicleDefects.resolvedAt),
        ),
      )
      .limit(1);
    if (blockingDefect) {
      return NextResponse.json({ error: 'Vehicle issue is blocked by an unresolved safety-critical defect' }, { status: 409 });
    }

    const minimumOdometer = Math.max(
      record.authorityBeginningOdometer ?? 0,
      departureInspection.odometerReading ?? 0,
      record.vehicleOdometer ?? 0,
    );
    if (!Number.isInteger(issueOdometer) || issueOdometer < minimumOdometer) {
      return NextResponse.json(
        { error: `Issue odometer must be a whole number at or above ${minimumOdometer}` },
        { status: 422 },
      );
    }

    const issueId = randomUUID();
    const nowIso = new Date().toISOString();
    const assignmentAcceptedAtIso = new Date(record.assignmentAcceptedAt).toISOString();
    const auditSequence = Date.now();

    await db.execute(sql`
      WITH allocation_claim AS (
        UPDATE vehicle_allocations
        SET version = version + 1, updated_at = ${nowIso}::timestamptz
        WHERE id = ${record.allocationId}::uuid
          AND state = 'confirmed'
          AND version = ${record.allocationVersion}
          AND vehicle_id = ${record.vehicleId}::uuid
          AND driver_employee_id IS NULL
        RETURNING id
      ),
      trip_claim AS (
        UPDATE trips
        SET issued_at = ${nowIso}::timestamptz, updated_at = ${nowIso}::timestamptz
        WHERE id = ${id}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND status = 'pending'
          AND issued_at IS NULL
          AND allocation_id = ${record.allocationId}::uuid
          AND vehicle_id = ${record.vehicleId}::uuid
          AND EXISTS (SELECT 1 FROM allocation_claim)
          AND EXISTS (
            SELECT 1
            FROM external_driver_assignments eda
            INNER JOIN external_parties ep ON ep.id = eda.external_party_id
            INNER JOIN external_driver_licences edl ON edl.id = eda.licence_id
            WHERE eda.id = ${record.assignmentId}::uuid
              AND eda.tenant_id = ${tenantId}::uuid
              AND eda.trip_id = trips.id
              AND eda.allocation_id = trips.allocation_id
              AND eda.external_party_id = ${record.externalPartyId}::uuid
              AND eda.state = 'accepted'
              AND eda.issue_id IS NULL
              AND eda.accepted_at IS NOT NULL
              AND ep.tenant_id = ${tenantId}::uuid
              AND ep.status = 'active'
              AND edl.tenant_id = ${tenantId}::uuid
              AND edl.id = ${record.licenceId}::uuid
              AND edl.verification_status = 'verified'
              AND edl.licence_class = ${record.licenceClass}
              AND edl.expiry_date >= COALESCE(
                (SELECT ta.valid_until::date FROM trip_authorities ta WHERE ta.trip_id = trips.id AND ta.tenant_id = ${tenantId}::uuid),
                CURRENT_DATE
              )
          )
          AND EXISTS (
            SELECT 1 FROM transport_requests tr
            WHERE tr.id = trips.request_id
              AND tr.tenant_id = ${tenantId}::uuid
              AND tr.status = 'authorised'
              AND tr.assigned_driver_external_party_id = ${record.externalPartyId}::uuid
          )
          AND EXISTS (
            SELECT 1 FROM trip_authorities ta
            WHERE ta.trip_id = trips.id
              AND ta.tenant_id = ${tenantId}::uuid
              AND ta.status = 'ready_for_departure'
              AND ta.document_version = ${record.authorityDocumentVersion}
          )
          AND EXISTS (
            SELECT 1
            FROM generated_documents gd
            WHERE gd.tenant_id = ${tenantId}::uuid
              AND gd.entity_type = 'vehicle_allocation'
              AND gd.entity_id = trips.allocation_id
              AND gd.document_type = 'trip_authority'
              AND gd.status = 'issued'
              AND (gd.snapshot_data #>> '{renderData,documentVersion}') ~ '^[0-9]+$'
              AND (gd.snapshot_data #>> '{renderData,documentVersion}')::integer = ${record.authorityDocumentVersion}
              AND NOT EXISTS (
                SELECT 1
                FROM generated_documents newer
                WHERE newer.tenant_id = gd.tenant_id
                  AND newer.entity_type = gd.entity_type
                  AND newer.entity_id = gd.entity_id
                  AND newer.document_type = gd.document_type
                  AND newer.document_version > gd.document_version
              )
          )
          AND EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = trips.vehicle_id
              AND v.tenant_id = ${tenantId}::uuid
              AND v.status = 'available'
              AND v.professional_authorisation_required = false
              AND (
                v.required_licence_class IS NULL
                OR CASE
                  WHEN upper(replace(${record.licenceClass}::text, ' ', '')) IN ('EC', 'CE') THEN upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'C1', 'C', 'BE', 'EB', 'C1E', 'CE1', 'CE', 'EC')
                  WHEN upper(replace(${record.licenceClass}::text, ' ', '')) IN ('C1E', 'CE1') THEN upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'C1', 'BE', 'EB', 'C1E', 'CE1')
                  WHEN upper(replace(${record.licenceClass}::text, ' ', '')) = 'C' THEN upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'C1', 'C')
                  WHEN upper(replace(${record.licenceClass}::text, ' ', '')) = 'C1' THEN upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'C1')
                  WHEN upper(replace(${record.licenceClass}::text, ' ', '')) IN ('BE', 'EB') THEN upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'BE', 'EB')
                  WHEN upper(replace(${record.licenceClass}::text, ' ', '')) = 'B' THEN upper(replace(v.required_licence_class, ' ', '')) = 'B'
                  WHEN upper(replace(${record.licenceClass}::text, ' ', '')) = 'A' THEN upper(replace(v.required_licence_class, ' ', '')) IN ('A', 'A1')
                  WHEN upper(replace(${record.licenceClass}::text, ' ', '')) = 'A1' THEN upper(replace(v.required_licence_class, ' ', '')) = 'A1'
                  ELSE upper(replace(${record.licenceClass}::text, ' ', '')) = upper(replace(v.required_licence_class, ' ', ''))
                END
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM vehicle_defects vd
            INNER JOIN vehicles dv ON dv.id = vd.vehicle_id
            WHERE vd.vehicle_id = trips.vehicle_id
              AND dv.tenant_id = ${tenantId}::uuid
              AND vd.is_blocking = true
              AND vd.resolved_at IS NULL
          )
          AND EXISTS (
            SELECT 1
            FROM vehicle_inspections vi
            WHERE vi.id = (
              SELECT latest.id
              FROM vehicle_inspections latest
              WHERE latest.tenant_id = ${tenantId}::uuid
                AND latest.trip_id = trips.id
                AND latest.vehicle_id = trips.vehicle_id
                AND latest.type = 'departure'
              ORDER BY latest.created_at DESC, latest.id DESC
              LIMIT 1
            )
              AND vi.status = 'completed'
              AND vi.overall_pass = true
              AND COALESCE(vi.odometer_reading, 0) <= ${issueOdometer}
          )
        RETURNING id, request_id, allocation_id
      ),
      issue_insert AS (
        INSERT INTO trip_issues (
          id, trip_id, allocation_id, issued_at, issue_odometer,
          keys_issued, fuel_card_issued, issued_by_user_id,
          acknowledged_by_driver_id, acknowledged_at, notes
        )
        SELECT
          ${issueId}::uuid,
          ${id}::uuid,
          ${record.allocationId}::uuid,
          ${nowIso}::timestamptz,
          ${issueOdometer},
          true,
          ${fuelCardIssued},
          ${session.user.id},
          NULL,
          ${assignmentAcceptedAtIso}::timestamptz,
          ${notes}
        FROM trip_claim
        RETURNING id
      ),
      assignment_claim AS (
        UPDATE external_driver_assignments
        SET issue_id = ${issueId}::uuid, updated_at = ${nowIso}::timestamptz
        WHERE id = ${record.assignmentId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND external_party_id = ${record.externalPartyId}::uuid
          AND state = 'accepted'
          AND issue_id IS NULL
          AND EXISTS (SELECT 1 FROM issue_insert)
        RETURNING id
      ),
      request_claim AS (
        UPDATE transport_requests
        SET status = 'vehicle_issued', updated_at = ${nowIso}::timestamptz
        WHERE id = ${record.requestId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND assigned_driver_external_party_id = ${record.externalPartyId}::uuid
          AND status = 'authorised'
          AND EXISTS (SELECT 1 FROM assignment_claim)
        RETURNING id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id,
          action, entity_type, entity_id, summary, after, source_channel
        )
        SELECT
          ${tenantId}::uuid,
          ${auditSequence},
          'vehicle_issued_external_driver',
          ${session.user.id},
          'external_issue',
          'trip',
          ${id}::uuid,
          ${`Vehicle issued to accepted external driver for ${record.requestReference}`},
          jsonb_build_object(
            'externalDriverAssignmentId', ${record.assignmentId}::text,
            'externalDriverPartyId', ${record.externalPartyId}::text,
            'licenceId', ${record.licenceId}::text,
            'issueId', ${issueId}::text,
            'issueOdometer', ${issueOdometer}::integer,
            'keysIssued', true,
            'fuelCardIssued', ${fuelCardIssued}::boolean
          ),
          'web'
        FROM request_claim
        RETURNING id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM allocation_claim) = 1
         AND (SELECT count(*) FROM trip_claim) = 1
         AND (SELECT count(*) FROM issue_insert) = 1
         AND (SELECT count(*) FROM assignment_claim) = 1
         AND (SELECT count(*) FROM request_claim) = 1
         AND (SELECT count(*) FROM audit_insert) = 1
        THEN '1'
        ELSE 'atomic_external_issue_failed_'
          || (SELECT count(*) FROM allocation_claim)::text
          || (SELECT count(*) FROM trip_claim)::text
          || (SELECT count(*) FROM issue_insert)::text
          || (SELECT count(*) FROM assignment_claim)::text
          || (SELECT count(*) FROM request_claim)::text
      END AS integer) AS committed
    `);

    await recordTenantRequestActivity({
      tenantId,
      requestId: record.requestId,
      reference: record.requestReference,
      stage: 'vehicle_issued',
      officeLabel: 'Transport office',
    }).catch((error) => console.warn('[trips/external-issue] Post-commit activity failed:', error));

    return NextResponse.json({ success: true, tripId: id, issueId, externalDriverAssignmentId: record.assignmentId });
  } catch (error) {
    console.error('[trips/external-issue] POST failed:', error);
    return NextResponse.json(
      { error: 'Trip, allocation, authority document, driver, or vehicle state changed while physical issue was being recorded. Refresh and review the latest state.' },
      { status: 409 },
    );
  }
}
