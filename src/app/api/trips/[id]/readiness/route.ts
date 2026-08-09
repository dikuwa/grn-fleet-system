/**
 * Release Readiness API
 *
 * GET /api/trips/[id]/readiness — Check release gates for a trip.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, vehicleAllocations, vehicleInspections, tripAuthorities } from '@/db/schema/trips';
import { vehicles, vehicleDefects, vehicleCategories } from '@/db/schema/fleet';
import { workflowInstances, workflowActions, workflowSteps } from '@/db/schema/workflows';
import { employees, driverProfiles, driverLicences } from '@/db/schema/people';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { namibiaLicenceClassCovers } from '@/lib/namibia-licence';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ReadinessGate {
  key: string;
  label: string;
  status: 'pass' | 'fail' | 'blocking' | 'pending';
  detail: string;
  required: boolean;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'Invalid trip identifier' }, { status: 400 });
    }

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const db = getDb();
    const tenantId = session.tenantId;

    const [trip] = await db
      .select({
        id: trips.id,
        status: trips.status,
        vehicleId: trips.vehicleId,
        requestId: trips.requestId,
        allocationId: trips.allocationId,
        issuedAt: trips.issuedAt,
        startedAt: trips.startedAt,
        allocationState: vehicleAllocations.state,
        allocationEndAt: vehicleAllocations.endAt,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
      })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, trips.allocationId))
      .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
      .where(and(
        eq(trips.id, id),
        eq(trips.tenantId, tenantId),
        eq(vehicles.tenantId, tenantId),
      ))
      .limit(1);

    if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const gates: ReadinessGate[] = [];

    const [workflow] = await db
      .select({
        id: workflowInstances.id,
        status: workflowInstances.status,
        definitionId: workflowInstances.definitionId,
      })
      .from(workflowInstances)
      .where(eq(workflowInstances.requestId, trip.requestId))
      .limit(1);

    const requestApproved = workflow?.status === 'approved' || workflow?.status === 'completed';
    gates.push({
      key: 'request_approvals',
      label: 'Transport request approvals completed',
      status: requestApproved ? 'pass' : 'blocking',
      detail: requestApproved
        ? 'All required approvals have been obtained.'
        : `Awaiting approval (workflow: ${workflow?.status || 'not started'}).`,
      required: true,
    });

    if (workflow?.id && workflow.definitionId) {
      const [releaseStep] = await db
        .select({ stepOrder: workflowSteps.stepOrder })
        .from(workflowSteps)
        .where(and(
          eq(workflowSteps.definitionId, workflow.definitionId),
          eq(workflowSteps.actionType, 'release'),
        ))
        .orderBy(workflowSteps.stepOrder)
        .limit(1);

      if (releaseStep) {
        const [releaseAction] = await db
          .select({ id: workflowActions.id })
          .from(workflowActions)
          .where(and(
            eq(workflowActions.instanceId, workflow.id),
            eq(workflowActions.stepOrder, releaseStep.stepOrder),
            eq(workflowActions.actionType, 'release'),
            eq(workflowActions.result, 'approved'),
          ))
          .limit(1);
        gates.push({
          key: 'releasing_officer_acted',
          label: 'Releasing officer has acted',
          status: releaseAction ? 'pass' : 'blocking',
          detail: releaseAction
            ? 'The releasing officer has performed the release action.'
            : 'The release step has not been completed yet.',
          required: true,
        });
      }
    }

    gates.push({
      key: 'vehicle_allocated',
      label: 'Vehicle allocated',
      status: trip.vehicleId && trip.allocationState === 'confirmed' ? 'pass' : 'blocking',
      detail: trip.vehicleId && trip.allocationState === 'confirmed'
        ? 'Vehicle is assigned on an active confirmed allocation.'
        : `Allocation is ${trip.allocationState || 'missing'}.`,
      required: true,
    });

    gates.push({
      key: 'driver_allocated',
      label: 'Driver allocated',
      status: trip.driverEmployeeId ? 'pass' : 'blocking',
      detail: trip.driverEmployeeId ? 'Driver assigned to this trip.' : 'No driver has been allocated.',
      required: true,
    });

    if (trip.driverEmployeeId) {
      const [employee] = await db
        .select({ employmentStatus: employees.employmentStatus })
        .from(employees)
        .where(and(eq(employees.id, trip.driverEmployeeId), eq(employees.tenantId, tenantId)))
        .limit(1);
      const active = employee?.employmentStatus === 'active';
      gates.push({
        key: 'driver_active_employee',
        label: 'Driver employment is active',
        status: active ? 'pass' : 'blocking',
        detail: active ? 'Driver has active employment status.' : `Driver status is "${employee?.employmentStatus || 'unknown'}".`,
        required: true,
      });

      const [profile] = await db
        .select({
          driverStatus: driverProfiles.driverStatus,
          licenceClass: driverLicences.licenceClass,
          expiryDate: driverLicences.expiryDate,
          verificationStatus: driverLicences.verificationStatus,
        })
        .from(driverProfiles)
        .innerJoin(employees, eq(employees.id, driverProfiles.employeeId))
        .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
        .where(and(
          eq(driverProfiles.employeeId, trip.driverEmployeeId),
          eq(employees.tenantId, tenantId),
          eq(driverLicences.isActive, true),
          eq(driverLicences.isVerified, true),
        ))
        .orderBy(desc(driverLicences.version))
        .limit(1);

      const licenceExpiry = profile?.expiryDate
        ? new Date(`${profile.expiryDate}T23:59:59.999Z`)
        : null;
      const licenceValid = !!profile &&
        profile.driverStatus === 'authorised' &&
        profile.verificationStatus === 'verified' &&
        !!licenceExpiry &&
        licenceExpiry >= trip.allocationEndAt;

      gates.push({
        key: 'driver_licence_valid',
        label: 'Driver licence valid for trip dates',
        status: licenceValid ? 'pass' : profile ? 'blocking' : 'pending',
        detail: !profile
          ? 'No active verified driver licence record found.'
          : profile.driverStatus !== 'authorised'
            ? `Driver status is "${profile.driverStatus}" (must be authorised).`
            : profile.verificationStatus !== 'verified'
              ? 'Licence has not been verified.'
              : !licenceExpiry || licenceExpiry < trip.allocationEndAt
                ? `Licence expires before the trip ends (${profile.expiryDate}).`
                : 'Licence is valid and verified through the trip end date.',
        required: true,
      });

      if (trip.vehicleId && profile?.licenceClass) {
        const [vehicleInfo] = await db
          .select({
            requiredLicenceClass: vehicles.requiredLicenceClass,
            categoryName: vehicleCategories.name,
          })
          .from(vehicles)
          .leftJoin(vehicleCategories, eq(vehicles.categoryId, vehicleCategories.id))
          .where(and(eq(vehicles.id, trip.vehicleId), eq(vehicles.tenantId, tenantId)))
          .limit(1);

        const requiredClass = vehicleInfo?.requiredLicenceClass;
        if (requiredClass) {
          const covers = namibiaLicenceClassCovers(profile.licenceClass, requiredClass);
          gates.push({
            key: 'driver_licence_class_match',
            label: 'Driver licence class matches vehicle category',
            status: covers ? 'pass' : 'blocking',
            detail: covers
              ? `Driver licence (${profile.licenceClass}) covers required class (${requiredClass}) for ${vehicleInfo?.categoryName || 'this vehicle'}.`
              : `Driver licence class "${profile.licenceClass}" does not authorise required class "${requiredClass}" for ${vehicleInfo?.categoryName || 'this vehicle'}.`,
            required: true,
          });
        }
      }
    }

    const [blockingDefect] = await db
      .select({ count: sql<number>`count(*)` })
      .from(vehicleDefects)
      .innerJoin(vehicles, eq(vehicles.id, vehicleDefects.vehicleId))
      .where(and(
        eq(vehicleDefects.vehicleId, trip.vehicleId),
        eq(vehicles.tenantId, tenantId),
        isNull(vehicleDefects.resolvedAt),
        eq(vehicleDefects.isBlocking, true),
      ));
    const noBlockingDefects = Number(blockingDefect?.count || 0) === 0;
    gates.push({
      key: 'vehicle_no_blocking_defects',
      label: 'No unresolved blocking defects',
      status: noBlockingDefects ? 'pass' : 'blocking',
      detail: noBlockingDefects
        ? 'Vehicle has no unresolved critical defects.'
        : `${blockingDefect?.count || 0} blocking defect(s) must be resolved.`,
      required: true,
    });

    const [departureInspection] = await db
      .select({ id: vehicleInspections.id, overallPass: vehicleInspections.overallPass, status: vehicleInspections.status })
      .from(vehicleInspections)
      .where(and(
        eq(vehicleInspections.tenantId, tenantId),
        eq(vehicleInspections.tripId, id),
        eq(vehicleInspections.vehicleId, trip.vehicleId),
        eq(vehicleInspections.type, 'departure'),
      ))
      .orderBy(desc(vehicleInspections.createdAt))
      .limit(1);
    const inspectionDone = departureInspection?.status === 'completed' || departureInspection?.status === 'failed';
    const inspectionPassed = departureInspection?.status === 'completed' && departureInspection.overallPass === true;
    gates.push({
      key: 'departure_inspection',
      label: 'Current vehicle pre-departure inspection completed',
      status: inspectionPassed ? 'pass' : inspectionDone ? 'blocking' : 'pending',
      detail: !departureInspection
        ? 'The currently allocated vehicle has not been inspected for this trip.'
        : inspectionPassed
          ? 'The currently allocated vehicle passed its pre-departure inspection.'
          : 'The current vehicle inspection did not pass. A replacement vehicle requires its own inspection.',
      required: true,
    });

    const [authority] = await db
      .select({ id: tripAuthorities.id, status: tripAuthorities.status, validFrom: tripAuthorities.validFrom, validUntil: tripAuthorities.validUntil })
      .from(tripAuthorities)
      .where(and(eq(tripAuthorities.tripId, id), eq(tripAuthorities.tenantId, tenantId)))
      .limit(1);
    gates.push({
      key: 'trip_authority',
      label: 'Trip Authority issued',
      status: authority ? 'pass' : 'blocking',
      detail: authority
        ? `Trip Authority ${authority.id.slice(0, 8)}... (${authority.status.replace(/_/g, ' ')})`
        : 'Trip Authority has not been created.',
      required: true,
    });

    if (authority) {
      const acceptedStatuses = new Set(['driver_accepted', 'awaiting_pre_trip_inspection', 'ready_for_departure', 'in_progress']);
      gates.push({
        key: 'driver_acknowledged',
        label: 'Driver has accepted trip',
        status: acceptedStatuses.has(authority.status) ? 'pass' : 'pending',
        detail: acceptedStatuses.has(authority.status)
          ? 'Driver has accepted the Trip Authority.'
          : `Trip Authority status: ${authority.status.replace(/_/g, ' ')}.`,
        required: true,
      });

      const now = new Date();
      const withinValidity = (!authority.validFrom || now >= authority.validFrom) &&
        (!authority.validUntil || now <= authority.validUntil);
      gates.push({
        key: 'authority_validity',
        label: 'Trip Authority is within its validity period',
        status: withinValidity ? 'pass' : 'blocking',
        detail: withinValidity ? 'Trip Authority is currently valid.' : 'Trip Authority is outside its approved validity period.',
        required: true,
      });
    }

    const [vehicle] = await db
      .select({ status: vehicles.status, licenceExpiryDate: vehicles.licenceExpiryDate })
      .from(vehicles)
      .where(and(eq(vehicles.id, trip.vehicleId), eq(vehicles.tenantId, tenantId)))
      .limit(1);
    const licenceDiscValid = !vehicle?.licenceExpiryDate ||
      new Date(`${vehicle.licenceExpiryDate}T23:59:59.999Z`) >= trip.allocationEndAt;
    const usableStatus = !!vehicle && !['maintenance', 'out_of_service', 'written_off', 'decommissioned', 'expired'].includes(vehicle.status);
    gates.push({
      key: 'vehicle_documents',
      label: 'Vehicle documents valid for trip dates',
      status: usableStatus && licenceDiscValid ? 'pass' : 'blocking',
      detail: !vehicle
        ? 'Vehicle record is missing.'
        : !licenceDiscValid
          ? `Vehicle licence expires before the trip ends (${vehicle.licenceExpiryDate}).`
          : usableStatus
            ? 'Vehicle status and licence expiry permit release.'
            : `Vehicle status is "${vehicle.status}".`,
      required: true,
    });

    const vehicleIssued = !!trip.issuedAt;
    gates.push({
      key: 'vehicle_issued',
      label: 'Vehicle physically issued',
      status: vehicleIssued ? 'pass' : 'pending',
      detail: vehicleIssued
        ? `Issued at ${new Date(trip.issuedAt!).toISOString().slice(0, 16).replace('T', ' ')}.`
        : 'Vehicle has not yet been physically issued.',
      required: false,
    });

    const blockingCount = gates.filter((gate) => gate.status === 'blocking').length;
    const pendingRequired = gates.filter((gate) => gate.required && gate.status === 'pending').length;
    const pendingCount = gates.filter((gate) => gate.status === 'pending').length;
    const overallReady = blockingCount === 0 && pendingRequired === 0;

    return NextResponse.json({
      gates,
      summary: {
        total: gates.length,
        passed: gates.filter((gate) => gate.status === 'pass').length,
        failed: blockingCount,
        pending: pendingCount,
        ready: overallReady,
        locked: !overallReady,
      },
    });
  } catch (error) {
    console.error('[readiness] GET failed:', error);
    return NextResponse.json({ error: 'Failed to check release readiness' }, { status: 500 });
  }
}
