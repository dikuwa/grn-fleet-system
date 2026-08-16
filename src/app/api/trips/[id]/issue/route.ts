/**
 * Vehicle Issue API
 *
 * POST /api/trips/[id]/issue — Record physical vehicle issue (keys, fuel card, odometer)
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import {
  trips,
  tripAuthorities,
  tripIssues,
  vehicleInspections,
  vehicleAllocations,
} from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicleDefects, vehicles } from '@/db/schema/fleet';
import {
  driverLicences,
  driverProfessionalAuthorisations,
  driverProfiles,
  employees,
} from '@/db/schema/people';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { namibiaLicenceClassCovers } from '@/lib/namibia-licence';
import { Permissions } from '@/lib/permissions';

function snapshotAuthorityVersion(snapshotData: unknown): number | null {
  if (!snapshotData || typeof snapshotData !== 'object' || Array.isArray(snapshotData)) return null;
  const renderData = (snapshotData as Record<string, unknown>).renderData;
  if (!renderData || typeof renderData !== 'object' || Array.isArray(renderData)) return null;
  const raw = (renderData as Record<string, unknown>).documentVersion;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function postgresErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as { code?: unknown; cause?: unknown };
  if (typeof record.code === 'string') return record.code;
  if (record.cause && typeof record.cause === 'object') {
    const cause = record.cause as { code?: unknown };
    if (typeof cause.code === 'string') return cause.code;
  }
  return null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/trips', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permCheck = await requirePermission(session, Permissions.TRIP_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const [trip] = await db
      .select({
        id: trips.id,
        status: trips.status,
        vehicleId: trips.vehicleId,
        allocationId: trips.allocationId,
        requestId: trips.requestId,
        issuedAt: trips.issuedAt,
        driverAcknowledgedAt: trips.driverAcknowledgedAt,
        driverAcknowledgedByEmployeeId: trips.driverAcknowledgedByEmployeeId,
        requestStatus: transportRequests.status,
        requestAssignedDriverEmployeeId: transportRequests.assignedDriverEmployeeId,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        allocationState: vehicleAllocations.state,
        allocationVersion: vehicleAllocations.version,
        authorityStatus: tripAuthorities.status,
        authorityDocumentVersion: tripAuthorities.documentVersion,
        authorityBeginningOdometer: tripAuthorities.beginningOdometer,
        authorityValidUntil: tripAuthorities.validUntil,
        vehicleOdometer: vehicles.currentOdometer,
        vehicleStatus: vehicles.status,
        requiredLicenceClass: vehicles.requiredLicenceClass,
        professionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
      })
      .from(trips)
      .innerJoin(transportRequests, eq(trips.requestId, transportRequests.id))
      .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
      .where(and(
        eq(trips.id, id),
        eq(trips.tenantId, session.tenantId),
        eq(transportRequests.tenantId, session.tenantId),
        eq(tripAuthorities.tenantId, session.tenantId),
        eq(vehicles.tenantId, session.tenantId),
      ))
      .limit(1);

    if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    if (trip.issuedAt) return NextResponse.json({ error: 'Vehicle has already been physically issued for this trip' }, { status: 409 });
    if (trip.status !== 'pending') {
      return NextResponse.json({ error: `Cannot issue vehicle for trip with status "${trip.status}".` }, { status: 409 });
    }
    if (trip.allocationState !== 'confirmed') {
      return NextResponse.json({ error: `Allocation must be confirmed before physical issue (${trip.allocationState})` }, { status: 409 });
    }
    if (trip.requestStatus !== 'authorised') {
      return NextResponse.json({ error: 'Final authorisation is required before issue' }, { status: 409 });
    }
    if (trip.authorityStatus !== 'ready_for_departure') {
      return NextResponse.json({ error: `Trip Authority is not ready for physical issue (${trip.authorityStatus})` }, { status: 409 });
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
        eq(generatedDocuments.tenantId, session.tenantId),
        eq(generatedDocuments.entityType, 'vehicle_allocation'),
        eq(generatedDocuments.entityId, trip.allocationId),
        eq(generatedDocuments.documentType, 'trip_authority'),
      ))
      .orderBy(desc(generatedDocuments.documentVersion))
      .limit(1);
    const issuedSnapshotAuthorityVersion = snapshotAuthorityVersion(latestAuthorityDocument?.snapshotData);
    if (
      !latestAuthorityDocument ||
      latestAuthorityDocument.status !== 'issued' ||
      issuedSnapshotAuthorityVersion !== trip.authorityDocumentVersion
    ) {
      return NextResponse.json(
        {
          error: !latestAuthorityDocument
            ? 'The Trip Authority document must be generated and formally issued before physical vehicle issue.'
            : latestAuthorityDocument.status !== 'issued'
              ? `The current Trip Authority (v${latestAuthorityDocument.documentVersion}) must be formally issued before physical vehicle issue.`
              : `The issued Trip Authority snapshot represents authority version ${issuedSnapshotAuthorityVersion ?? 'unknown'}, but the current authority is version ${trip.authorityDocumentVersion}. Regenerate and formally issue the current authority before physical vehicle issue.`,
        },
        { status: 409 },
      );
    }

    if (trip.vehicleStatus !== 'available') {
      return NextResponse.json({ error: `Vehicle is not available for issue (${trip.vehicleStatus})` }, { status: 409 });
    }
    if (
      !trip.driverEmployeeId ||
      trip.requestAssignedDriverEmployeeId !== trip.driverEmployeeId ||
      !trip.driverAcknowledgedAt ||
      trip.driverAcknowledgedByEmployeeId !== trip.driverEmployeeId
    ) {
      return NextResponse.json({ error: 'The current assigned driver must acknowledge the trip before issue' }, { status: 409 });
    }

    const [driverEvidence] = await db
      .select({
        employeeStatus: employees.employmentStatus,
        profileId: driverProfiles.id,
        driverStatus: driverProfiles.driverStatus,
        licenceId: driverLicences.id,
        licenceClass: driverLicences.licenceClass,
        expiryDate: driverLicences.expiryDate,
      })
      .from(employees)
      .innerJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
      .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
      .where(and(
        eq(employees.id, trip.driverEmployeeId),
        eq(employees.tenantId, session.tenantId),
        eq(employees.employmentStatus, 'active'),
        eq(driverProfiles.driverStatus, 'authorised'),
        eq(driverLicences.isActive, true),
        eq(driverLicences.isVerified, true),
        eq(driverLicences.verificationStatus, 'verified'),
      ))
      .orderBy(desc(driverLicences.version))
      .limit(1);
    const requiredThrough = trip.authorityValidUntil ?? new Date();
    const licenceExpiry = driverEvidence?.expiryDate
      ? new Date(`${driverEvidence.expiryDate}T23:59:59.999Z`)
      : null;
    if (!driverEvidence || !licenceExpiry || licenceExpiry < requiredThrough) {
      return NextResponse.json(
        { error: 'The assigned driver must have an active verified licence valid through the authorised trip period' },
        { status: 409 },
      );
    }
    if (
      trip.requiredLicenceClass &&
      !namibiaLicenceClassCovers(driverEvidence.licenceClass, trip.requiredLicenceClass)
    ) {
      return NextResponse.json(
        { error: `Driver licence class ${driverEvidence.licenceClass} does not cover vehicle requirement ${trip.requiredLicenceClass}` },
        { status: 409 },
      );
    }

    let professionalAuthorisationId: string | null = null;
    if (trip.professionalAuthorisationRequired) {
      const requiredThroughDate = requiredThrough.toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const [professionalAuthorisation] = await db
        .select({ id: driverProfessionalAuthorisations.id })
        .from(driverProfessionalAuthorisations)
        .where(and(
          eq(driverProfessionalAuthorisations.driverProfileId, driverEvidence.profileId),
          eq(driverProfessionalAuthorisations.isVerified, true),
          sql`${driverProfessionalAuthorisations.expiryDate} >= ${requiredThroughDate}::date`,
          sql`(${driverProfessionalAuthorisations.validFrom} IS NULL OR ${driverProfessionalAuthorisations.validFrom} <= ${today}::date)`,
        ))
        .orderBy(desc(driverProfessionalAuthorisations.expiryDate))
        .limit(1);
      if (!professionalAuthorisation) {
        return NextResponse.json(
          { error: 'This vehicle requires verified professional driving authorisation valid through the trip period' },
          { status: 409 },
        );
      }
      professionalAuthorisationId = professionalAuthorisation.id;
    }

    const [departureInspection] = await db
      .select({
        id: vehicleInspections.id,
        odometerReading: vehicleInspections.odometerReading,
        status: vehicleInspections.status,
        overallPass: vehicleInspections.overallPass,
      })
      .from(vehicleInspections)
      .where(and(
        eq(vehicleInspections.tenantId, session.tenantId),
        eq(vehicleInspections.tripId, id),
        eq(vehicleInspections.vehicleId, trip.vehicleId),
        eq(vehicleInspections.type, 'departure'),
      ))
      .orderBy(desc(vehicleInspections.createdAt), desc(vehicleInspections.id))
      .limit(1);
    if (!departureInspection || departureInspection.status !== 'completed' || departureInspection.overallPass !== true) {
      return NextResponse.json(
        { error: 'The latest pre-departure inspection for the currently allocated vehicle must be completed and passed before issue' },
        { status: 409 },
      );
    }

    const [blockingDefect] = await db
      .select({ id: vehicleDefects.id })
      .from(vehicleDefects)
      .innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
      .where(and(
        eq(vehicleDefects.vehicleId, trip.vehicleId),
        eq(vehicles.tenantId, session.tenantId),
        eq(vehicleDefects.isBlocking, true),
        isNull(vehicleDefects.resolvedAt),
      ))
      .limit(1);
    if (blockingDefect) {
      return NextResponse.json({ error: 'Vehicle issue is blocked by an unresolved safety-critical defect' }, { status: 409 });
    }

    const body = (await req.json().catch(() => ({}))) as {
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

    const minimumOdometer = Math.max(
      trip.authorityBeginningOdometer ?? 0,
      departureInspection.odometerReading ?? 0,
      trip.vehicleOdometer ?? 0,
    );
    if (!Number.isInteger(issueOdometer) || issueOdometer < minimumOdometer) {
      return NextResponse.json(
        { error: `Issue odometer must be a whole number at or above ${minimumOdometer}` },
        { status: 422 },
      );
    }
    if (keysIssued !== true) {
      return NextResponse.json({ error: 'Vehicle keys must be issued before departure' }, { status: 422 });
    }

    const now = new Date();
    const issueId = randomUUID();
    const auditSequence = Date.now();
    const requiredThroughDate = requiredThrough.toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);

    await db.execute(sql`
      WITH allocation_claim AS (
        UPDATE vehicle_allocations
        SET version = version + 1, updated_at = ${now}
        WHERE id = ${trip.allocationId}::uuid
          AND state = 'confirmed'
          AND version = ${trip.allocationVersion}
          AND driver_employee_id = ${trip.driverEmployeeId}::uuid
          AND vehicle_id = ${trip.vehicleId}::uuid
        RETURNING id
      ),
      trip_claim AS (
        UPDATE trips
        SET issued_at = ${now}, updated_at = ${now}
        WHERE id = ${id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND status = 'pending'
          AND issued_at IS NULL
          AND vehicle_id = ${trip.vehicleId}::uuid
          AND allocation_id = ${trip.allocationId}::uuid
          AND driver_acknowledged_at IS NOT NULL
          AND driver_acknowledged_by_employee_id = ${trip.driverEmployeeId}::uuid
          AND EXISTS (SELECT 1 FROM allocation_claim)
          AND EXISTS (
            SELECT 1
            FROM transport_requests tr
            WHERE tr.id = trips.request_id
              AND tr.tenant_id = ${session.tenantId}::uuid
              AND tr.status = 'authorised'
              AND tr.assigned_driver_employee_id = ${trip.driverEmployeeId}::uuid
          )
          AND EXISTS (
            SELECT 1
            FROM employees e
            INNER JOIN driver_profiles dp ON dp.employee_id = e.id
            INNER JOIN driver_licences dl ON dl.driver_profile_id = dp.id
            WHERE e.id = ${trip.driverEmployeeId}::uuid
              AND e.tenant_id = ${session.tenantId}::uuid
              AND e.employment_status = 'active'
              AND dp.id = ${driverEvidence.profileId}::uuid
              AND dp.driver_status = 'authorised'
              AND dl.id = ${driverEvidence.licenceId}::uuid
              AND dl.is_active = true
              AND dl.is_verified = true
              AND dl.verification_status = 'verified'
              AND dl.licence_class = ${driverEvidence.licenceClass}
              AND dl.expiry_date >= ${requiredThroughDate}::date
          )
          AND EXISTS (
            SELECT 1
            FROM trip_authorities ta
            WHERE ta.trip_id = trips.id
              AND ta.tenant_id = ${session.tenantId}::uuid
              AND ta.status = 'ready_for_departure'
              AND ta.document_version = ${trip.authorityDocumentVersion}
          )
          AND EXISTS (
            SELECT 1
            FROM generated_documents gd
            WHERE gd.tenant_id = ${session.tenantId}::uuid
              AND gd.entity_type = 'vehicle_allocation'
              AND gd.entity_id = trips.allocation_id
              AND gd.document_type = 'trip_authority'
              AND gd.status = 'issued'
              AND (gd.snapshot_data #>> '{renderData,documentVersion}') ~ '^[0-9]+$'
              AND (gd.snapshot_data #>> '{renderData,documentVersion}')::integer = ${trip.authorityDocumentVersion}
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
            SELECT 1
            FROM vehicles v
            WHERE v.id = trips.vehicle_id
              AND v.tenant_id = ${session.tenantId}::uuid
              AND v.status = 'available'
              AND (
                v.required_licence_class IS NULL
                OR CASE
                  WHEN upper(replace(${driverEvidence.licenceClass}::text, ' ', '')) IN ('EC', 'CE') THEN upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'C1', 'C', 'BE', 'EB', 'C1E', 'CE1', 'CE', 'EC')
                  WHEN upper(replace(${driverEvidence.licenceClass}::text, ' ', '')) IN ('C1E', 'CE1') THEN upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'C1', 'BE', 'EB', 'C1E', 'CE1')
                  WHEN upper(replace(${driverEvidence.licenceClass}::text, ' ', '')) = 'C' THEN upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'C1', 'C')
                  WHEN upper(replace(${driverEvidence.licenceClass}::text, ' ', '')) = 'C1' THEN upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'C1')
                  WHEN upper(replace(${driverEvidence.licenceClass}::text, ' ', '')) IN ('BE', 'EB') THEN upper(replace(v.required_licence_class, ' ', '')) IN ('B', 'BE', 'EB')
                  WHEN upper(replace(${driverEvidence.licenceClass}::text, ' ', '')) = 'B' THEN upper(replace(v.required_licence_class, ' ', '')) = 'B'
                  WHEN upper(replace(${driverEvidence.licenceClass}::text, ' ', '')) = 'A' THEN upper(replace(v.required_licence_class, ' ', '')) IN ('A', 'A1')
                  WHEN upper(replace(${driverEvidence.licenceClass}::text, ' ', '')) = 'A1' THEN upper(replace(v.required_licence_class, ' ', '')) = 'A1'
                  ELSE upper(replace(${driverEvidence.licenceClass}::text, ' ', '')) = upper(replace(v.required_licence_class, ' ', ''))
                END
              )
              AND (
                v.professional_authorisation_required = false
                OR EXISTS (
                  SELECT 1
                  FROM driver_professional_authorisations dpa
                  WHERE dpa.id = ${professionalAuthorisationId}::uuid
                    AND dpa.driver_profile_id = ${driverEvidence.profileId}::uuid
                    AND dpa.is_verified = true
                    AND dpa.expiry_date >= ${requiredThroughDate}::date
                    AND (dpa.valid_from IS NULL OR dpa.valid_from <= ${today}::date)
                )
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM vehicle_defects vd
            INNER JOIN vehicles dv ON dv.id = vd.vehicle_id
            WHERE vd.vehicle_id = trips.vehicle_id
              AND dv.tenant_id = ${session.tenantId}::uuid
              AND vd.is_blocking = true
              AND vd.resolved_at IS NULL
          )
          AND EXISTS (
            SELECT 1
            FROM vehicle_inspections vi
            WHERE vi.id = (
              SELECT latest.id
              FROM vehicle_inspections latest
              WHERE latest.tenant_id = ${session.tenantId}::uuid
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
          ${trip.allocationId}::uuid,
          ${now},
          ${issueOdometer},
          true,
          ${fuelCardIssued},
          ${session.user.id},
          ${trip.driverEmployeeId}::uuid,
          ${trip.driverAcknowledgedAt},
          ${notes}
        FROM trip_claim
        RETURNING id
      ),
      request_claim AS (
        UPDATE transport_requests
        SET status = 'vehicle_issued', updated_at = ${now}
        WHERE id = ${trip.requestId}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND assigned_driver_employee_id = ${trip.driverEmployeeId}::uuid
          AND status = 'authorised'
          AND EXISTS (SELECT 1 FROM issue_insert)
        RETURNING id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id,
          action, entity_type, entity_id, summary, after, source_channel
        )
        SELECT
          ${session.tenantId}::uuid,
          ${auditSequence},
          'vehicle_issued',
          ${session.user.id},
          'issue',
          'trip',
          ${id}::uuid,
          ${`Vehicle issued: keys=true, fuelCard=${fuelCardIssued}, odometer=${issueOdometer}`},
          jsonb_build_object(
            'driverEmployeeId', ${trip.driverEmployeeId}::text,
            'licenceId', ${driverEvidence.licenceId}::text,
            'professionalAuthorisationId', ${professionalAuthorisationId}::text,
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
         AND (SELECT count(*) FROM request_claim) = 1
         AND (SELECT count(*) FROM audit_insert) = 1
        THEN '1'
        ELSE 'atomic_trip_issue_failed_'
          || (SELECT count(*) FROM allocation_claim)::text
          || (SELECT count(*) FROM trip_claim)::text
          || (SELECT count(*) FROM issue_insert)::text
          || (SELECT count(*) FROM request_claim)::text
          || (SELECT count(*) FROM audit_insert)::text
      END AS integer) AS committed
    `);

    const [issue] = await db
      .select()
      .from(tripIssues)
      .where(eq(tripIssues.id, issueId))
      .limit(1);
    return NextResponse.json({ success: true, issue });
  } catch (error) {
    console.error('[trips/issue] POST failed:', error);
    const code = postgresErrorCode(error);
    if (
      String(error).includes('atomic_trip_issue_failed') ||
      (code === '23514' && String(error).includes('trip_issue_authority_conflict'))
    ) {
      return NextResponse.json(
        { error: 'Trip, allocation, authority document, driver, vehicle, or compliance state changed while the vehicle was being issued. Refresh and review the latest trip state.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to issue vehicle' }, { status: 500 });
  }
}
