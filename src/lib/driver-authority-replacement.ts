import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { auditEvents } from '@/db/schema/audit';
import { vehicles } from '@/db/schema/fleet';
import {
  driverLicenceCodes,
  driverLicences,
  driverProfessionalAuthorisations,
  driverProfiles,
  employees,
} from '@/db/schema/people';
import { requestDrivers, transportRequests } from '@/db/schema/requests';
import {
  tripAmendments,
  tripAuthorities,
  tripAuthorisedDrivers,
  tripAuthorityVersions,
  trips,
  vehicleAllocations,
} from '@/db/schema/trips';
import type { AuthSession } from '@/lib/auth-helpers';
import { calculateDriverCompliance } from '@/lib/employee-lifecycle';
import { createScopedNotifications } from '@/lib/notification-service';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { maskLicenceNumber } from '@/lib/trip-authority';
import { WorkspaceIds } from '@/lib/workspaces';

const LIVE_ALLOCATION_STATES = ['provisional', 'confirmed'] as const;

export type DriverAuthorityReplacementRequestResult =
  | { handled: false }
  | { handled: true; response: NextResponse };

type ReplacementContext = {
  allocationId: string;
  allocationVersion: number;
  allocationState: string;
  allocationStartAt: Date;
  allocationEndAt: Date;
  allocationDriverEmployeeId: string | null;
  requestId: string;
  requestReference: string;
  requestStatus: string;
  requestAssignedDriverEmployeeId: string | null;
  tripId: string;
  tripStatus: string;
  tripIssuedAt: Date | null;
  tripDriverAcknowledgedAt: Date | null;
  authorityId: string;
  authorityStatus: string;
  authorityVersion: number;
  authorityDocumentVersion: number;
  authorityAuthorisedByUserId: string | null;
  vehicleId: string;
  requiredLicenceClass: string | null;
  professionalAuthorisationRequired: boolean;
};

type EligibleDriver = {
  employeeId: string;
  userId: string | null;
  email: string | null;
  firstName: string | null;
  employeeNumber: string | null;
  profileId: string;
  licenceId: string;
  licenceClass: string;
  licenceExpiry: string;
  compliance: ReturnType<typeof calculateDriverCompliance>;
};

async function loadReplacementContext(
  allocationId: string,
  tenantId: string,
): Promise<ReplacementContext | null> {
  const db = getDb();
  const [row] = await db
    .select({
      allocationId: vehicleAllocations.id,
      allocationVersion: vehicleAllocations.version,
      allocationState: vehicleAllocations.state,
      allocationStartAt: vehicleAllocations.startAt,
      allocationEndAt: vehicleAllocations.endAt,
      allocationDriverEmployeeId: vehicleAllocations.driverEmployeeId,
      requestId: transportRequests.id,
      requestReference: transportRequests.reference,
      requestStatus: transportRequests.status,
      requestAssignedDriverEmployeeId: transportRequests.assignedDriverEmployeeId,
      tripId: trips.id,
      tripStatus: trips.status,
      tripIssuedAt: trips.issuedAt,
      tripDriverAcknowledgedAt: trips.driverAcknowledgedAt,
      authorityId: tripAuthorities.id,
      authorityStatus: tripAuthorities.status,
      authorityVersion: tripAuthorities.version,
      authorityDocumentVersion: tripAuthorities.documentVersion,
      authorityAuthorisedByUserId: tripAuthorities.authorisedByUserId,
      vehicleId: vehicleAllocations.vehicleId,
      requiredLicenceClass: vehicles.requiredLicenceClass,
      professionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
    })
    .from(vehicleAllocations)
    .innerJoin(transportRequests, eq(transportRequests.id, vehicleAllocations.requestId))
    .innerJoin(vehicles, eq(vehicles.id, vehicleAllocations.vehicleId))
    .innerJoin(
      trips,
      and(
        eq(trips.allocationId, vehicleAllocations.id),
        eq(trips.requestId, vehicleAllocations.requestId),
        eq(trips.tenantId, tenantId),
      ),
    )
    .innerJoin(
      tripAuthorities,
      and(eq(tripAuthorities.tripId, trips.id), eq(tripAuthorities.tenantId, tenantId)),
    )
    .where(
      and(
        eq(vehicleAllocations.id, allocationId),
        eq(transportRequests.tenantId, tenantId),
        eq(vehicles.tenantId, tenantId),
      ),
    )
    .limit(1);

  return row ?? null;
}

async function loadPrimaryAuthorityDriver(authorityId: string) {
  const db = getDb();
  const [driver] = await db
    .select({
      id: tripAuthorisedDrivers.id,
      employeeId: tripAuthorisedDrivers.employeeId,
      employeeNumber: tripAuthorisedDrivers.employeeNumber,
      licenceNumberMasked: tripAuthorisedDrivers.licenceNumberMasked,
      licenceClass: tripAuthorisedDrivers.licenceClass,
      licenceExpiry: tripAuthorisedDrivers.licenceExpiry,
    })
    .from(tripAuthorisedDrivers)
    .where(
      and(
        eq(tripAuthorisedDrivers.authorityId, authorityId),
        eq(tripAuthorisedDrivers.driverType, 'primary'),
      ),
    )
    .orderBy(desc(tripAuthorisedDrivers.createdAt), desc(tripAuthorisedDrivers.id))
    .limit(1);
  return driver ?? null;
}

async function loadEligibleReplacementDriver(input: {
  tenantId: string;
  allocationId: string;
  driverEmployeeId: string;
  allocationStartAt: Date;
  allocationEndAt: Date;
  requiredLicenceClass: string | null;
  professionalAuthorisationRequired: boolean;
}): Promise<{ ok: true; driver: EligibleDriver } | { ok: false; response: NextResponse }> {
  const db = getDb();
  const [driver] = await db
    .select({
      employeeId: employees.id,
      userId: employees.userId,
      email: employees.email,
      firstName: employees.firstName,
      employeeNumber: employees.employeeNumber,
      employeeStatus: employees.employmentStatus,
      employeeAvailability: employees.availabilityStatus,
      profileId: driverProfiles.id,
      driverStatus: driverProfiles.driverStatus,
      profileAvailability: driverProfiles.availabilityStatus,
      licenceId: driverLicences.id,
      licenceStatus: driverLicences.verificationStatus,
      licenceExpiry: driverLicences.expiryDate,
      licenceClass: driverLicences.licenceClass,
    })
    .from(employees)
    .innerJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
    .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
    .where(
      and(
        eq(employees.id, input.driverEmployeeId),
        eq(employees.tenantId, input.tenantId),
        eq(employees.isDriver, true),
        eq(employees.employmentStatus, 'active'),
        eq(driverLicences.isActive, true),
        eq(driverLicences.isVerified, true),
        eq(driverLicences.verificationStatus, 'verified'),
      ),
    )
    .orderBy(desc(driverLicences.version))
    .limit(1);

  if (!driver) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Replacement driver requires an active verified licence profile.' },
        { status: 409 },
      ),
    };
  }

  const [conflict] = await db
    .select({ id: vehicleAllocations.id })
    .from(vehicleAllocations)
    .where(
      and(
        eq(vehicleAllocations.driverEmployeeId, input.driverEmployeeId),
        ne(vehicleAllocations.id, input.allocationId),
        inArray(vehicleAllocations.state, [...LIVE_ALLOCATION_STATES]),
        lt(vehicleAllocations.startAt, input.allocationEndAt),
        gt(vehicleAllocations.endAt, input.allocationStartAt),
      ),
    )
    .limit(1);
  if (conflict) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Replacement driver is already assigned during this trip period.' },
        { status: 409 },
      ),
    };
  }

  const [codes, professional] = await Promise.all([
    db
      .select({ code: driverLicenceCodes.code })
      .from(driverLicenceCodes)
      .where(
        and(
          eq(driverLicenceCodes.licenceId, driver.licenceId),
          eq(driverLicenceCodes.isActive, true),
        ),
      ),
    db
      .select({
        isVerified: driverProfessionalAuthorisations.isVerified,
        expiryDate: driverProfessionalAuthorisations.expiryDate,
        validFrom: driverProfessionalAuthorisations.validFrom,
      })
      .from(driverProfessionalAuthorisations)
      .where(eq(driverProfessionalAuthorisations.driverProfileId, driver.profileId))
      .orderBy(desc(driverProfessionalAuthorisations.expiryDate))
      .limit(1),
  ]);

  const licenceCodes = [
    ...codes.map((row) => row.code),
    ...String(driver.licenceClass || '')
      .split(',')
      .map((code) => code.trim())
      .filter(Boolean),
  ];
  const compliance = calculateDriverCompliance({
    employeeStatus: driver.employeeStatus,
    availabilityStatus:
      driver.employeeAvailability !== 'available'
        ? driver.employeeAvailability
        : driver.profileAvailability,
    driverStatus: driver.driverStatus,
    licenceStatus: driver.licenceStatus,
    licenceExpiry: driver.licenceExpiry,
    licenceCodes: Array.from(new Set(licenceCodes)),
    requiredLicenceClass: input.requiredLicenceClass,
    professionalRequired: input.professionalAuthorisationRequired,
    professionalVerified: professional[0]?.isVerified,
    professionalExpiry: professional[0]?.expiryDate,
    tripEndAt: input.allocationEndAt,
    hasScheduleConflict: false,
  });

  if (!['eligible', 'eligible_expiring_soon'].includes(compliance.status)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Replacement driver does not meet the compliance requirements for this vehicle and trip period.',
          compliance,
        },
        { status: 409 },
      ),
    };
  }

  return {
    ok: true,
    driver: {
      employeeId: driver.employeeId,
      userId: driver.userId,
      email: driver.email,
      firstName: driver.firstName,
      employeeNumber: driver.employeeNumber,
      profileId: driver.profileId,
      licenceId: driver.licenceId,
      licenceClass: driver.licenceClass,
      licenceExpiry: driver.licenceExpiry,
      compliance,
    },
  };
}

/**
 * Intercepts only a post-authorisation driver change. Before Trip Authority
 * creation the caller continues through the ordinary allocation assignment
 * path. Once an authority exists, a different primary driver becomes a pending
 * immutable authority amendment instead of mutating the live allocation.
 */
export async function requestPostAuthorisationDriverReplacement(input: {
  allocationId: string;
  driverEmployeeId: string;
  reason: string;
  session: AuthSession;
}): Promise<DriverAuthorityReplacementRequestResult> {
  const context = await loadReplacementContext(input.allocationId, input.session.tenantId);
  if (!context) return { handled: false };

  if (
    context.tripStatus !== 'pending' ||
    context.tripIssuedAt ||
    context.tripDriverAcknowledgedAt ||
    context.authorityStatus !== 'awaiting_driver_acceptance'
  ) {
    return {
      handled: true,
      response: NextResponse.json(
        {
          error:
            'The authorised assignment can only change driver before driver acknowledgement and physical vehicle issue.',
        },
        { status: 409 },
      ),
    };
  }
  if (!LIVE_ALLOCATION_STATES.includes(context.allocationState as (typeof LIVE_ALLOCATION_STATES)[number])) {
    return {
      handled: true,
      response: NextResponse.json(
        { error: 'The authorised allocation is no longer active for driver replacement.' },
        { status: 409 },
      ),
    };
  }
  if (!input.reason.trim()) {
    return {
      handled: true,
      response: NextResponse.json(
        { error: 'A reason is required to replace a driver after final authorisation.' },
        { status: 422 },
      ),
    };
  }

  const currentPrimary = await loadPrimaryAuthorityDriver(context.authorityId);
  if (!currentPrimary) {
    return {
      handled: true,
      response: NextResponse.json(
        { error: 'The Trip Authority has no current primary driver and requires administrative repair.' },
        { status: 409 },
      ),
    };
  }

  // Reassigning the same authority driver after a pre-acceptance unassignment
  // does not change the signed authority and can safely use the normal path.
  if (currentPrimary.employeeId === input.driverEmployeeId) return { handled: false };

  const eligible = await loadEligibleReplacementDriver({
    tenantId: input.session.tenantId,
    allocationId: context.allocationId,
    driverEmployeeId: input.driverEmployeeId,
    allocationStartAt: context.allocationStartAt,
    allocationEndAt: context.allocationEndAt,
    requiredLicenceClass: context.requiredLicenceClass,
    professionalAuthorisationRequired: context.professionalAuthorisationRequired,
  });
  if (!eligible.ok) return { handled: true, response: eligible.response };

  const db = getDb();
  const [pending] = await db
    .select({ id: tripAmendments.id, newValue: tripAmendments.newValue })
    .from(tripAmendments)
    .where(
      and(
        eq(tripAmendments.authorityId, context.authorityId),
        eq(tripAmendments.amendmentType, 'driver_replacement'),
        eq(tripAmendments.status, 'pending'),
      ),
    )
    .orderBy(desc(tripAmendments.createdAt))
    .limit(1);
  if (pending) {
    if (pending.newValue?.driverEmployeeId === input.driverEmployeeId) {
      return {
        handled: true,
        response: NextResponse.json(
          {
            success: true,
            pendingApproval: true,
            amendmentId: pending.id,
            message: 'This replacement driver is already awaiting Trip Authority amendment approval.',
          },
          { status: 202 },
        ),
      };
    }
    return {
      handled: true,
      response: NextResponse.json(
        {
          error:
            'Another driver replacement is already awaiting Trip Authority amendment approval. Decide or reject it before nominating a different driver.',
          amendmentId: pending.id,
        },
        { status: 409 },
      ),
    };
  }

  const amendmentId = randomUUID();
  const auditId = randomUUID();
  const now = new Date();
  const originalValue = {
    driverEmployeeId: currentPrimary.employeeId,
    employeeNumber: currentPrimary.employeeNumber,
    licenceNumberMasked: currentPrimary.licenceNumberMasked,
    licenceClass: currentPrimary.licenceClass,
    licenceExpiry: currentPrimary.licenceExpiry?.toISOString() ?? null,
    allocationDriverEmployeeId: context.allocationDriverEmployeeId,
    allocationVersion: context.allocationVersion,
  };
  const newValue = {
    driverEmployeeId: eligible.driver.employeeId,
    employeeNumber: eligible.driver.employeeNumber,
    licenceId: eligible.driver.licenceId,
    licenceClass: eligible.driver.licenceClass,
    licenceExpiry: eligible.driver.licenceExpiry,
    allocationId: context.allocationId,
    expectedAllocationVersion: context.allocationVersion,
    previousPrimaryDriverEmployeeId: currentPrimary.employeeId,
    complianceStatus: eligible.driver.compliance.status,
  };

  try {
    await db.execute(sql`
      WITH amendment_insert AS (
        INSERT INTO trip_amendments (
          id, authority_id, amendment_type, original_value, new_value, reason,
          status, requested_by_user_id, version, created_at
        )
        SELECT
          ${amendmentId}::uuid,
          ${context.authorityId}::uuid,
          'driver_replacement',
          ${JSON.stringify(originalValue)}::jsonb,
          ${JSON.stringify(newValue)}::jsonb,
          ${input.reason.trim()},
          'pending',
          ${input.session.user.id},
          ${context.authorityVersion + 1},
          ${now}
        WHERE EXISTS (
          SELECT 1
          FROM trip_authorities ta
          INNER JOIN trips t ON t.id = ta.trip_id
          INNER JOIN vehicle_allocations va ON va.id = ta.allocation_id
          WHERE ta.id = ${context.authorityId}::uuid
            AND ta.tenant_id = ${input.session.tenantId}::uuid
            AND ta.status = 'awaiting_driver_acceptance'
            AND ta.version = ${context.authorityVersion}
            AND t.id = ${context.tripId}::uuid
            AND t.status = 'pending'
            AND t.issued_at IS NULL
            AND t.driver_acknowledged_at IS NULL
            AND va.id = ${context.allocationId}::uuid
            AND va.version = ${context.allocationVersion}
            AND va.state IN ('provisional', 'confirmed')
        )
        AND NOT EXISTS (
          SELECT 1 FROM trip_amendments pending
          WHERE pending.authority_id = ${context.authorityId}::uuid
            AND pending.amendment_type = 'driver_replacement'
            AND pending.status = 'pending'
        )
        RETURNING id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          id, tenant_id, tenant_sequence, event_type, actor_user_id, action,
          entity_type, entity_id, before, after, reason, source_channel, summary
        )
        SELECT
          ${auditId}::uuid,
          ${input.session.tenantId}::uuid,
          ${Date.now()},
          'trip_authority_driver_replacement_requested',
          ${input.session.user.id},
          'request_driver_replacement',
          'trip_amendment',
          amendment_insert.id,
          ${JSON.stringify(originalValue)}::jsonb,
          ${JSON.stringify(newValue)}::jsonb,
          ${input.reason.trim()},
          'web',
          'Post-authorisation driver replacement requested'
        FROM amendment_insert
        RETURNING id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM amendment_insert) = 1
         AND (SELECT count(*) FROM audit_insert) = 1
        THEN '1'
        ELSE 'atomic_driver_replacement_request_failed'
      END AS integer) AS committed
    `);
  } catch (error) {
    if (String(error).includes('atomic_driver_replacement_request_failed')) {
      return {
        handled: true,
        response: NextResponse.json(
          { error: 'The authority or allocation changed while the replacement was being requested. Refresh and try again.' },
          { status: 409 },
        ),
      };
    }
    throw error;
  }

  if (context.authorityAuthorisedByUserId) {
    await createScopedNotifications({
      tenantId: input.session.tenantId,
      recipientUserIds: [context.authorityAuthorisedByUserId],
      category: 'action_required',
      eventType: 'driver_replacement_authority_approval_required',
      title: 'Driver replacement requires authority approval',
      body: `Transport Administration nominated a replacement driver for ${context.requestReference}. Approve the revised Trip Authority before the replacement driver can acknowledge the trip.`,
      entityType: 'trip_amendment',
      entityId: amendmentId,
      actionUrl: `/dashboard/trips/${context.tripId}`,
      workspace: WorkspaceIds.APPROVER,
      priority: 'high',
    }).catch(() => undefined);
  }

  return {
    handled: true,
    response: NextResponse.json(
      {
        success: true,
        pendingApproval: true,
        amendmentId,
        message:
          'Replacement driver nominated. The live allocation and Trip Authority remain unchanged until the authority amendment is approved.',
      },
      { status: 202 },
    ),
  };
}

export async function decidePostAuthorisationDriverReplacement(input: {
  tripId: string;
  amendmentId: string;
  action: 'approve' | 'reject';
  comment?: string;
  session: AuthSession;
}): Promise<NextResponse> {
  const db = getDb();
  const [record] = await db
    .select({
      amendmentId: tripAmendments.id,
      amendmentType: tripAmendments.amendmentType,
      amendmentStatus: tripAmendments.status,
      amendmentVersion: tripAmendments.version,
      amendmentReason: tripAmendments.reason,
      amendmentNewValue: tripAmendments.newValue,
      amendmentOriginalValue: tripAmendments.originalValue,
      authorityId: tripAuthorities.id,
      authorityVersion: tripAuthorities.version,
      authorityStatus: tripAuthorities.status,
      allocationId: vehicleAllocations.id,
      allocationVersion: vehicleAllocations.version,
      allocationState: vehicleAllocations.state,
      allocationStartAt: vehicleAllocations.startAt,
      allocationEndAt: vehicleAllocations.endAt,
      allocationDriverEmployeeId: vehicleAllocations.driverEmployeeId,
      requestId: transportRequests.id,
      requestReference: transportRequests.reference,
      requestStatus: transportRequests.status,
      tripStatus: trips.status,
      tripIssuedAt: trips.issuedAt,
      tripDriverAcknowledgedAt: trips.driverAcknowledgedAt,
      vehicleId: vehicles.id,
      requiredLicenceClass: vehicles.requiredLicenceClass,
      professionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
    })
    .from(tripAmendments)
    .innerJoin(tripAuthorities, eq(tripAuthorities.id, tripAmendments.authorityId))
    .innerJoin(trips, eq(trips.id, tripAuthorities.tripId))
    .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, tripAuthorities.allocationId))
    .innerJoin(transportRequests, eq(transportRequests.id, tripAuthorities.requestId))
    .innerJoin(vehicles, eq(vehicles.id, vehicleAllocations.vehicleId))
    .where(
      and(
        eq(tripAmendments.id, input.amendmentId),
        eq(tripAuthorities.tripId, input.tripId),
        eq(tripAuthorities.tenantId, input.session.tenantId),
        eq(trips.tenantId, input.session.tenantId),
        eq(transportRequests.tenantId, input.session.tenantId),
        eq(vehicles.tenantId, input.session.tenantId),
      ),
    )
    .limit(1);

  if (!record) return NextResponse.json({ error: 'Driver replacement amendment not found.' }, { status: 404 });
  if (record.amendmentType !== 'driver_replacement') {
    return NextResponse.json({ error: 'This is not a driver replacement amendment.' }, { status: 409 });
  }
  if (record.amendmentStatus !== 'pending') {
    return NextResponse.json({ error: 'This driver replacement amendment already has a decision.' }, { status: 409 });
  }
  if (record.amendmentVersion !== record.authorityVersion + 1) {
    return NextResponse.json(
      { error: 'The Trip Authority changed after this replacement was requested. Reject it and nominate the driver again against the current authority.' },
      { status: 409 },
    );
  }

  const now = new Date();
  const decisionReason = input.comment?.trim() || record.amendmentReason;
  if (input.action === 'reject') {
    try {
      await db.execute(sql`
        WITH amendment_claim AS (
          UPDATE trip_amendments
          SET status = 'rejected', approved_by_user_id = ${input.session.user.id}, approved_at = ${now}
          WHERE id = ${input.amendmentId}::uuid
            AND status = 'pending'
            AND version = ${record.amendmentVersion}
          RETURNING id
        ),
        audit_insert AS (
          INSERT INTO audit_events (
            tenant_id, tenant_sequence, event_type, actor_user_id, action,
            entity_type, entity_id, before, after, reason, source_channel, summary
          )
          SELECT
            ${input.session.tenantId}::uuid,
            ${Date.now()},
            'trip_authority_driver_replacement_rejected',
            ${input.session.user.id},
            'reject_driver_replacement',
            'trip_amendment',
            amendment_claim.id,
            ${JSON.stringify(record.amendmentOriginalValue ?? {})}::jsonb,
            ${JSON.stringify(record.amendmentNewValue)}::jsonb,
            ${decisionReason},
            'web',
            'Post-authorisation driver replacement rejected'
          FROM amendment_claim
          RETURNING id
        )
        SELECT CAST(CASE
          WHEN (SELECT count(*) FROM amendment_claim) = 1
           AND (SELECT count(*) FROM audit_insert) = 1
          THEN '1'
          ELSE 'atomic_driver_replacement_reject_failed'
        END AS integer) AS committed
      `);
    } catch (error) {
      return NextResponse.json(
        { error: 'The replacement decision changed concurrently. Refresh and review the latest authority.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, rejected: true });
  }

  if (
    record.tripStatus !== 'pending' ||
    record.tripIssuedAt ||
    record.tripDriverAcknowledgedAt ||
    record.authorityStatus !== 'awaiting_driver_acceptance' ||
    !LIVE_ALLOCATION_STATES.includes(record.allocationState as (typeof LIVE_ALLOCATION_STATES)[number])
  ) {
    return NextResponse.json(
      { error: 'The trip can no longer change its primary driver before departure.' },
      { status: 409 },
    );
  }

  const newDriverEmployeeId =
    typeof record.amendmentNewValue.driverEmployeeId === 'string'
      ? record.amendmentNewValue.driverEmployeeId
      : '';
  const expectedPreviousDriverEmployeeId =
    typeof record.amendmentNewValue.previousPrimaryDriverEmployeeId === 'string'
      ? record.amendmentNewValue.previousPrimaryDriverEmployeeId
      : '';
  if (!newDriverEmployeeId || !expectedPreviousDriverEmployeeId) {
    return NextResponse.json({ error: 'The replacement amendment is missing its driver identity snapshot.' }, { status: 409 });
  }

  const currentPrimary = await loadPrimaryAuthorityDriver(record.authorityId);
  if (!currentPrimary || currentPrimary.employeeId !== expectedPreviousDriverEmployeeId) {
    return NextResponse.json(
      { error: 'The Trip Authority primary driver changed after this replacement was requested.' },
      { status: 409 },
    );
  }
  if (
    record.allocationDriverEmployeeId !== null &&
    record.allocationDriverEmployeeId !== expectedPreviousDriverEmployeeId
  ) {
    return NextResponse.json(
      { error: 'The live allocation driver no longer matches the authority state used for this amendment.' },
      { status: 409 },
    );
  }

  const eligible = await loadEligibleReplacementDriver({
    tenantId: input.session.tenantId,
    allocationId: record.allocationId,
    driverEmployeeId: newDriverEmployeeId,
    allocationStartAt: record.allocationStartAt,
    allocationEndAt: record.allocationEndAt,
    requiredLicenceClass: record.requiredLicenceClass,
    professionalAuthorisationRequired: record.professionalAuthorisationRequired,
  });
  if (!eligible.ok) return eligible.response;

  const licenceExpiry = new Date(`${eligible.driver.licenceExpiry}T23:59:59.999Z`);
  const replacementSnapshot = {
    previousPrimaryDriverEmployeeId: currentPrimary.employeeId,
    primaryDriverEmployeeId: eligible.driver.employeeId,
    licenceId: eligible.driver.licenceId,
    licenceClass: eligible.driver.licenceClass,
    licenceExpiry: licenceExpiry.toISOString(),
    complianceStatus: eligible.driver.compliance.status,
    replacementReason: record.amendmentReason,
    approvedByUserId: input.session.user.id,
    approvedAt: now.toISOString(),
  };
  const auditId = randomUUID();
  const nowIso = now.toISOString();

  try {
    await db.execute(sql`
      WITH amendment_claim AS (
        UPDATE trip_amendments
        SET status = 'approved', approved_by_user_id = ${input.session.user.id}, approved_at = ${nowIso}::timestamptz
        WHERE id = ${input.amendmentId}::uuid
          AND authority_id = ${record.authorityId}::uuid
          AND amendment_type = 'driver_replacement'
          AND status = 'pending'
          AND version = ${record.authorityVersion + 1}
        RETURNING id
      ),
      previous_primary AS (
        UPDATE trip_authorised_drivers tad
        SET driver_type = 'superseded',
            reason = ${`Superseded before departure: ${record.amendmentReason}`}
        WHERE tad.id = ${currentPrimary.id}::uuid
          AND tad.authority_id = ${record.authorityId}::uuid
          AND tad.employee_id = ${currentPrimary.employeeId}::uuid
          AND tad.driver_type = 'primary'
          AND EXISTS (SELECT 1 FROM amendment_claim)
        RETURNING id
      ),
      new_primary AS (
        INSERT INTO trip_authorised_drivers (
          authority_id, employee_id, driver_type, employee_number,
          licence_number_masked, licence_class, licence_expiry,
          reason, authorised_by_user_id, authorised_at
        )
        SELECT
          ${record.authorityId}::uuid,
          ${eligible.driver.employeeId}::uuid,
          'primary',
          ${eligible.driver.employeeNumber},
          ${maskLicenceNumber(eligible.driver.licenceId)},
          ${eligible.driver.licenceClass},
          ${licenceExpiry},
          ${record.amendmentReason},
          ${input.session.user.id},
          ${nowIso}::timestamptz
        FROM previous_primary
        ON CONFLICT (authority_id, employee_id)
        DO UPDATE SET
          driver_type = 'primary',
          employee_number = EXCLUDED.employee_number,
          licence_number_masked = EXCLUDED.licence_number_masked,
          licence_class = EXCLUDED.licence_class,
          licence_expiry = EXCLUDED.licence_expiry,
          reason = EXCLUDED.reason,
          authorised_by_user_id = EXCLUDED.authorised_by_user_id,
          authorised_at = EXCLUDED.authorised_at
        RETURNING id
      ),
      authority_claim AS (
        UPDATE trip_authorities ta
        SET version = version + 1,
            document_version = document_version + 1,
            status = 'awaiting_driver_acceptance',
            accepted_at = NULL,
            accepted_by_employee_id = NULL,
            acceptance_data = NULL,
            data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
              'driverReplacement', ${JSON.stringify(replacementSnapshot)}::jsonb
            ),
            updated_at = ${nowIso}::timestamptz
        WHERE ta.id = ${record.authorityId}::uuid
          AND ta.tenant_id = ${input.session.tenantId}::uuid
          AND ta.version = ${record.authorityVersion}
          AND ta.status = 'awaiting_driver_acceptance'
          AND EXISTS (SELECT 1 FROM new_primary)
        RETURNING *
      ),
      allocation_claim AS (
        UPDATE vehicle_allocations va
        SET driver_employee_id = ${eligible.driver.employeeId}::uuid,
            override_reason = ${record.amendmentReason},
            version = version + 1,
            updated_at = ${nowIso}::timestamptz
        WHERE va.id = ${record.allocationId}::uuid
          AND va.version = ${record.allocationVersion}
          AND va.state IN ('provisional', 'confirmed')
          AND va.driver_employee_id IS NOT DISTINCT FROM ${record.allocationDriverEmployeeId}::uuid
          AND EXISTS (SELECT 1 FROM authority_claim)
          AND NOT EXISTS (
            SELECT 1 FROM trips t
            WHERE t.id = ${input.tripId}::uuid
              AND (t.issued_at IS NOT NULL OR t.driver_acknowledged_at IS NOT NULL)
          )
        RETURNING request_id
      ),
      request_claim AS (
        UPDATE transport_requests tr
        SET assigned_driver_employee_id = ${eligible.driver.employeeId}::uuid,
            updated_at = ${nowIso}::timestamptz
        FROM allocation_claim ac
        WHERE tr.id = ac.request_id
          AND tr.id = ${record.requestId}::uuid
          AND tr.tenant_id = ${input.session.tenantId}::uuid
          AND tr.status = 'driver_acknowledgement_pending'
          AND tr.assigned_driver_employee_id IS NOT DISTINCT FROM ${record.allocationDriverEmployeeId}::uuid
        RETURNING tr.id
      ),
      request_drivers_cleared AS (
        UPDATE request_drivers rd
        SET is_confirmed = false
        FROM request_claim rc
        WHERE rd.request_id = rc.id
        RETURNING rd.id
      ),
      request_driver_updated AS (
        UPDATE request_drivers rd
        SET is_confirmed = true, licence_validated = true, driver_type = 'assigned'
        FROM request_claim rc
        WHERE rd.request_id = rc.id
          AND rd.employee_id = ${eligible.driver.employeeId}::uuid
        RETURNING rd.id
      ),
      request_driver_inserted AS (
        INSERT INTO request_drivers (
          request_id, employee_id, driver_type, is_confirmed, licence_validated
        )
        SELECT
          rc.id,
          ${eligible.driver.employeeId}::uuid,
          'assigned',
          true,
          true
        FROM request_claim rc
        WHERE NOT EXISTS (SELECT 1 FROM request_driver_updated)
        RETURNING id
      ),
      version_insert AS (
        INSERT INTO trip_authority_versions (
          authority_id, version, status, snapshot, reason, created_by_user_id
        )
        SELECT
          ac.id,
          ac.version,
          ac.status,
          to_jsonb(ac) || jsonb_build_object(
            'primaryDriverEmployeeId', ${eligible.driver.employeeId}::text,
            'previousPrimaryDriverEmployeeId', ${currentPrimary.employeeId}::text,
            'driverReplacementAmendmentId', ${input.amendmentId}::text
          ),
          ${record.amendmentReason},
          ${input.session.user.id}
        FROM authority_claim ac
        INNER JOIN allocation_claim alc ON alc.request_id = ${record.requestId}::uuid
        INNER JOIN request_claim rc ON rc.id = alc.request_id
        WHERE (SELECT count(*) FROM request_driver_updated) + (SELECT count(*) FROM request_driver_inserted) = 1
        RETURNING id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          id, tenant_id, tenant_sequence, event_type, actor_user_id, action,
          entity_type, entity_id, before, after, reason, source_channel, summary
        )
        SELECT
          ${auditId}::uuid,
          ${input.session.tenantId}::uuid,
          ${Date.now()},
          'trip_authority_driver_replacement_approved',
          ${input.session.user.id},
          'approve_driver_replacement',
          'trip_amendment',
          ${input.amendmentId}::uuid,
          ${JSON.stringify(record.amendmentOriginalValue ?? {})}::jsonb,
          ${JSON.stringify(replacementSnapshot)}::jsonb,
          ${decisionReason},
          'web',
          'Post-authorisation driver replacement approved and authority versioned'
        FROM version_insert
        RETURNING id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM amendment_claim) = 1
         AND (SELECT count(*) FROM previous_primary) = 1
         AND (SELECT count(*) FROM new_primary) = 1
         AND (SELECT count(*) FROM authority_claim) = 1
         AND (SELECT count(*) FROM allocation_claim) = 1
         AND (SELECT count(*) FROM request_claim) = 1
         AND (SELECT count(*) FROM version_insert) = 1
         AND (SELECT count(*) FROM audit_insert) = 1
        THEN '1'
        ELSE 'atomic_driver_replacement_approval_failed'
      END AS integer) AS committed
    `);
  } catch (error) {
    console.warn('[driver-authority-replacement] Approval rolled back:', error);
    return NextResponse.json(
      {
        error:
          'The driver, allocation or Trip Authority changed while approval was being committed. Refresh and review the current state.',
      },
      { status: 409 },
    );
  }

  await recordTenantRequestActivity({
    tenantId: input.session.tenantId,
    requestId: record.requestId,
    reference: record.requestReference,
    stage: 'driver_reassigned_authority_versioned',
    officeLabel: 'Final authorisation',
  }).catch(() => undefined);

  const affected = await db
    .select({
      id: employees.id,
      userId: employees.userId,
      firstName: employees.firstName,
    })
    .from(employees)
    .where(
      and(
        eq(employees.tenantId, input.session.tenantId),
        inArray(employees.id, [currentPrimary.employeeId, eligible.driver.employeeId]),
      ),
    );
  const replacementUserId = affected.find((row) => row.id === eligible.driver.employeeId)?.userId;
  const previousUserId = affected.find((row) => row.id === currentPrimary.employeeId)?.userId;

  if (replacementUserId) {
    await createScopedNotifications({
      tenantId: input.session.tenantId,
      recipientUserIds: [replacementUserId],
      category: 'action_required',
      eventType: 'driver_replacement_authority_ready',
      title: 'Revised Trip Authority ready for acknowledgement',
      body: `You are now the authorised replacement driver for ${record.requestReference}. Review the revised Trip Authority and acknowledge it before departure.`,
      entityType: 'trip',
      entityId: input.tripId,
      actionUrl: '/dashboard/trips',
      workspace: WorkspaceIds.DRIVER,
      priority: 'high',
    }).catch(() => undefined);
  }
  if (previousUserId && previousUserId !== replacementUserId) {
    await createScopedNotifications({
      tenantId: input.session.tenantId,
      recipientUserIds: [previousUserId],
      category: 'awareness',
      eventType: 'driver_replacement_authority_superseded',
      title: 'Trip driver assignment changed',
      body: `You are no longer the authorised primary driver for ${record.requestReference}.`,
      entityType: 'trip',
      entityId: input.tripId,
      actionUrl: '/dashboard/trips',
      workspace: WorkspaceIds.DRIVER,
      priority: 'normal',
    }).catch(() => undefined);
  }

  return NextResponse.json({
    success: true,
    approved: true,
    driverEmployeeId: eligible.driver.employeeId,
    authorityVersion: record.authorityVersion + 1,
    message: 'Replacement driver approved. A new Trip Authority version is ready for driver acknowledgement.',
  });
}
