/**
 * Release Readiness API
 *
 * GET /api/trips/[id]/readiness — Check all release gates for a trip
 * Returns a checklist of conditions and their pass/fail/blocking status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  trips,
  vehicleAllocations,
  vehicleInspections,
  tripAuthorities,
} from '@/db/schema/trips';
import { vehicles, vehicleDefects, vehicleCategories } from '@/db/schema/fleet';

import { workflowInstances, workflowActions, workflowSteps } from '@/db/schema/workflows';
import { employees, driverProfiles, driverLicences } from '@/db/schema/people';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { requireRequestAuth } from '@/lib/auth-helpers';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Licence class hierarchy: key = driver's class, value = classes it covers */
const LICENCE_CLASS_HIERARCHY: Record<string, string[]> = {
  'A': ['A', 'A1'],
  'A1': ['A1'],
  'B': ['B', 'EB', 'C', 'EC', 'CE'],
  'EB': ['EB', 'B', 'C', 'EC', 'CE'],
  'C': ['C', 'EC', 'CE', 'B', 'EB'],
  'EC': ['EC', 'C', 'CE', 'EB', 'B'],
  'CE': ['CE', 'C', 'EC', 'EB', 'B'],
};

interface ReadinessGate {
  key: string;
  label: string;
  status: 'pass' | 'fail' | 'blocking' | 'pending';
  detail: string;
  required: boolean;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'Invalid trip identifier' }, { status: 400 });
    }

    const auth = await requireRequestAuth(_req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();
    const tenantId = session.tenantId;

    // Fetch trip with allocations and request
    const [trip] = await db
      .select({
        id: trips.id,
        status: trips.status,
        vehicleId: trips.vehicleId,
        requestId: trips.requestId,
        allocationId: trips.allocationId,
        issuedAt: trips.issuedAt,
        startedAt: trips.startedAt,
      })
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.tenantId, tenantId)))
      .limit(1);

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    const gates: ReadinessGate[] = [];

    // 1. Request has required approvals
    if (trip.requestId) {
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

      // 1b. Releasing officer has acted
      if (trip.requestId && workflow?.id) {
        // Find the release step in the workflow definition
        const [releaseStep] = await db
          .select({ stepOrder: workflowSteps.stepOrder })
          .from(workflowSteps)
          .where(
            and(
              eq(workflowSteps.definitionId, workflow.definitionId || ''),
              eq(workflowSteps.actionType, 'release'),
            ),
          )
          .orderBy(workflowSteps.stepOrder)
          .limit(1);

        if (releaseStep) {
          const [releaseAction] = await db
            .select({ id: workflowActions.id })
            .from(workflowActions)
            .where(
              and(
                eq(workflowActions.instanceId, workflow.id),
                eq(workflowActions.stepOrder, releaseStep.stepOrder),
                eq(workflowActions.actionType, 'release'),
                eq(workflowActions.result, 'approved'),
              ),
            )
            .limit(1);

          const releasingOfficerActed = !!releaseAction;
          gates.push({
            key: 'releasing_officer_acted',
            label: 'Releasing officer has acted',
            status: releasingOfficerActed ? 'pass' : 'blocking',
            detail: releasingOfficerActed
              ? 'The releasing officer has performed the release action.'
              : 'The release step has not been completed yet. An authorised releasing officer must act.',
            required: true,
          });
        } else {
          gates.push({
            key: 'releasing_officer_acted',
            label: 'Releasing officer has acted',
            status: 'pass',
            detail: 'No explicit release step in this workflow.',
            required: true,
          });
        }
      }
    }

    // 2. Vehicle is allocated
    const hasVehicle = !!trip.vehicleId;
    gates.push({
      key: 'vehicle_allocated',
      label: 'Vehicle allocated',
      status: hasVehicle ? 'pass' : 'blocking',
      detail: hasVehicle ? 'Vehicle assigned to this trip.' : 'No vehicle has been allocated.',
      required: true,
    });

    // 3. Driver is allocated
    let driverEmployeeId: string | null = null;
    if (trip.allocationId) {
      const [allocation] = await db
        .select({ driverEmployeeId: vehicleAllocations.driverEmployeeId })
        .from(vehicleAllocations)
        .where(eq(vehicleAllocations.id, trip.allocationId))
        .limit(1);
      driverEmployeeId = allocation?.driverEmployeeId || null;
    }
    const hasDriver = !!driverEmployeeId;
    gates.push({
      key: 'driver_allocated',
      label: 'Driver allocated',
      status: hasDriver ? 'pass' : 'blocking',
      detail: hasDriver ? 'Driver assigned to this trip.' : 'No driver has been allocated.',
      required: true,
    });

    // 4. Driver is active (employee + driver profile + licence valid)
    if (driverEmployeeId) {
      const [employee] = await db
        .select({ employmentStatus: employees.employmentStatus })
        .from(employees)
        .where(eq(employees.id, driverEmployeeId))
        .limit(1);

      const isActiveEmployee = employee?.employmentStatus === 'active';
      gates.push({
        key: 'driver_active_employee',
        label: 'Driver employment is active',
        status: isActiveEmployee ? 'pass' : 'blocking',
        detail: isActiveEmployee
          ? 'Driver has active employment status.'
          : `Driver status is "${employee?.employmentStatus || 'unknown'}".`,
        required: true,
      });

      // Driver licence check — the ACTIVE VERIFIED licence (highest version),
      // never an unverified renewal or a superseded record.
      const [profile] = await db
        .select({
          driverStatus: driverProfiles.driverStatus,
          licenceClass: driverLicences.licenceClass,
          expiryDate: driverLicences.expiryDate,
          verificationStatus: driverLicences.verificationStatus,
        })
        .from(driverProfiles)
        .leftJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
        .where(
          and(
            eq(driverProfiles.employeeId, driverEmployeeId),
            eq(driverLicences.isActive, true),
          ),
        )
        .orderBy(desc(driverLicences.version))
        .limit(1);

      const isAuthorised = profile?.driverStatus === 'authorised';
      const isVerified = profile?.verificationStatus === 'verified';
      const notExpired =
        profile?.expiryDate && new Date(`${profile.expiryDate}T23:59:59Z`) > new Date();

      const licenceValid = isAuthorised && isVerified && notExpired;
      gates.push({
        key: 'driver_licence_valid',
        label: 'Driver licence valid for trip dates',
        status: licenceValid ? 'pass' : !profile ? 'pending' : 'blocking',
        detail: !profile
          ? 'No driver licence record found.'
          : !isAuthorised
            ? `Driver status is "${profile.driverStatus}" (must be authorised).`
            : !isVerified
              ? 'Licence has not been verified.'
              : !notExpired
                ? `Licence expired on ${profile.expiryDate}.`
                : 'Licence is valid and verified.',
        required: true,
      });

      // Driver licence class vs vehicle category matching
      if (licenceValid && trip.vehicleId) {
        const [vehicleInfo] = await db
          .select({
            requiredLicenceClass: vehicles.requiredLicenceClass,
            categoryName: vehicleCategories.name,
          })
          .from(vehicles)
          .leftJoin(vehicleCategories, eq(vehicles.categoryId, vehicleCategories.id))
          .where(eq(vehicles.id, trip.vehicleId))
          .limit(1);

        const requiredClass = vehicleInfo?.requiredLicenceClass;
        const driverLicenceClass = profile?.licenceClass;

        if (requiredClass && driverLicenceClass) {
          const upperRequired = requiredClass.toUpperCase();
          const upperDriver = driverLicenceClass.toUpperCase();
          const covers = LICENCE_CLASS_HIERARCHY[upperDriver]?.includes(upperRequired) || upperDriver === upperRequired;

          gates.push({
            key: 'driver_licence_class_match',
            label: 'Driver licence class matches vehicle category',
            status: covers ? 'pass' : 'blocking',
            detail: covers
              ? `Driver licence (${driverLicenceClass}) covers required class (${requiredClass}) for ${vehicleInfo?.categoryName || 'this vehicle'}.`
              : `Driver licence class "${driverLicenceClass}" does not cover required class "${requiredClass}" for ${vehicleInfo?.categoryName || 'this vehicle'}.`,
            required: true,
          });
        } else if (!requiredClass) {
          gates.push({
            key: 'driver_licence_class_match',
            label: 'Driver licence class matches vehicle category',
            status: 'pass',
            detail: 'Vehicle has no specific licence class requirement.',
            required: true,
          });
        } else {
          gates.push({
            key: 'driver_licence_class_match',
            label: 'Driver licence class matches vehicle category',
            status: 'pending',
            detail: 'Driver licence class information is missing.',
            required: true,
          });
        }
      }
    }

    // 5. Vehicle is roadworthy (no unresolved blocking defects)
    if (trip.vehicleId) {
      const [blockingDefect] = await db
        .select({ count: sql<number>`count(*)` })
        .from(vehicleDefects)
        .where(
          and(
            eq(vehicleDefects.vehicleId, trip.vehicleId),
            isNull(vehicleDefects.resolvedAt),
            eq(vehicleDefects.isBlocking, true),
          ),
        );

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
    }

    // 6. Pre-departure inspection complete
    if (trip.id) {
      // Try to use the trip detail API response format — query directly
      const [departureInspection] = await db
        .select({
          id: vehicleInspections.id,
          overallPass: vehicleInspections.overallPass,
          status: vehicleInspections.status,
        })
        .from(vehicleInspections)
        .where(
          and(
            eq(vehicleInspections.tripId, id),
            eq(vehicleInspections.type, 'departure'),
          ),
        )
        .orderBy(desc(vehicleInspections.createdAt))
        .limit(1);

      const inspectionDone = !!departureInspection;
      const inspectionPassed = departureInspection?.overallPass === true;

      gates.push({
        key: 'departure_inspection',
        label: 'Pre-departure inspection completed',
        status: inspectionDone ? (inspectionPassed ? 'pass' : 'blocking') : 'pending',
        detail: !inspectionDone
          ? 'Pre-departure inspection has not been performed yet.'
          : inspectionPassed
            ? 'Pre-departure inspection passed.'
            : 'Pre-departure inspection recorded failures. Review required.',
        required: true,
      });
    }

    // 7. Trip Authority exists
    const [authority] = await db
      .select({
        id: tripAuthorities.id,
        status: tripAuthorities.status,
        validFrom: tripAuthorities.validFrom,
        validUntil: tripAuthorities.validUntil,
      })
      .from(tripAuthorities)
      .where(and(eq(tripAuthorities.tripId, id), eq(tripAuthorities.tenantId, tenantId)))
      .limit(1);

    const hasAuthority = !!authority;
    gates.push({
      key: 'trip_authority',
      label: 'Trip Authority issued',
      status: hasAuthority ? 'pass' : 'blocking',
      detail: hasAuthority
        ? `Trip Authority ${authority.id.slice(0, 8)}... (${authority.status.replace(/_/g, ' ')})`
        : 'Trip Authority has not been created.',
      required: true,
    });

    // 8. Driver has acknowledged Trip Authority
    if (hasAuthority) {
      const isDriverAccepted = authority.status === 'driver_accepted' ||
        authority.status === 'awaiting_pre_trip_inspection' ||
        authority.status === 'ready_for_departure';

      gates.push({
        key: 'driver_acknowledged',
        label: 'Driver has accepted trip',
        status: isDriverAccepted ? 'pass' : 'pending',
        detail: isDriverAccepted
          ? 'Driver has accepted the Trip Authority.'
          : `Trip Authority status: ${authority.status.replace(/_/g, ' ')}.`,
        required: true,
      });
    }

    // 9. Vehicle documents valid (via vehicle status — surface-level check)
    if (trip.vehicleId) {
      const [vehicle] = await db
        .select({ status: vehicles.status })
        .from(vehicles)
        .where(eq(vehicles.id, trip.vehicleId))
        .limit(1);

      const documentsValid =
        vehicle?.status !== 'out_of_service' &&
        vehicle?.status !== 'decommissioned' &&
        vehicle?.status !== 'expired';

      gates.push({
        key: 'vehicle_documents',
        label: 'Vehicle documents valid',
        status: documentsValid ? 'pass' : 'blocking',
        detail: documentsValid
          ? 'Vehicle is not marked out of service or decommissioned.'
          : `Vehicle status is "${vehicle?.status}". Documents may be invalid.`,
        required: true,
      });

      // 10. Vehicle is roadworthy (overall)
      const isAvailable =
        vehicle?.status === 'available' || vehicle?.status === 'allocated';
      gates.push({
        key: 'vehicle_roadworthy',
        label: 'Vehicle is roadworthy',
        status: isAvailable ? 'pass' : !documentsValid ? 'blocking' : 'pending',
        detail: isAvailable
          ? 'Vehicle is available/allocated and presumed roadworthy.'
          : `Vehicle status: "${vehicle?.status}".`,
        required: true,
      });
    }

    // 11. Vehicle already issued (keys, fuel card, etc.)
    const vehicleIssued = !!trip.issuedAt;
    gates.push({
      key: 'vehicle_issued',
      label: 'Vehicle physically issued',
      status: vehicleIssued ? 'pass' : 'pending',
      detail: vehicleIssued
        ? `Issued at ${new Date(trip.issuedAt!).toISOString().slice(0, 16).replace('T', ' ')}.`
        : 'Vehicle has not been physically issued (keys, fuel card).',
      required: false,
    });

    // Compute overall status
    const blockingCount = gates.filter((g) => g.status === 'blocking').length;
    const pendingCount = gates.filter((g) => g.status === 'pending').length;
    const overallReady = blockingCount === 0;
    const overallLocked = blockingCount > 0;

    return NextResponse.json({
      gates,
      summary: {
        total: gates.length,
        passed: gates.filter((g) => g.status === 'pass').length,
        failed: blockingCount,
        pending: pendingCount,
        ready: overallReady,
        locked: overallLocked,
      },
    });
  } catch (error) {
    console.error('[readiness] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to check release readiness' },
      { status: 500 },
    );
  }
}
