/**
 * Get all trips with readiness status — pooled into one server-side query
 * so the dashboard can group by gate category without calling per-trip APIs.
 *
 * GET /api/trips/readiness-dashboard — returns trip list enriched with
 * readiness summary per trip (pass/blocking/pending counts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  trips,
  vehicleAllocations,
  vehicleInspections,
  tripAuthorities,
} from '@/db/schema/trips';
import { vehicles, vehicleDefects } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { workflowInstances } from '@/db/schema/workflows';
import { employees, driverProfiles, driverLicences } from '@/db/schema/people';
import { eq, and, desc, ne, isNull, sql } from 'drizzle-orm';
import { getSessionWorkspace, requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';
import { WorkspaceIds } from '@/lib/workspaces';

export async function GET(_req: NextRequest) {
  try {
    const auth = await requireRequestAuth(_req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const routeCheck = await requireDashboardAction(session, '/dashboard/trips/readiness', 'view');
    if (routeCheck instanceof NextResponse) return routeCheck;

    const db = getDb();
    const tenantId = session.tenantId;
    const { activeWorkspace } = await getSessionWorkspace(session);

    let assignedEmployeeId: string | null = null;
    if (activeWorkspace === WorkspaceIds.DRIVER) {
      const [employee] = await db
        .select({ id: employees.id })
        .from(employees)
        .where(and(
          eq(employees.userId, session.user.id),
          eq(employees.tenantId, tenantId),
          eq(employees.employmentStatus, 'active'),
        ))
        .limit(1);
      if (!employee) {
        return NextResponse.json({ trips: [], summary: { total: 0, ready: 0, blocked: 0, pending: 0 }, topBlockers: [] });
      }
      assignedEmployeeId = employee.id;
    }

    const tripRows = await db
      .select({
        id: trips.id,
        status: trips.status,
        issuedAt: trips.issuedAt,
        startedAt: trips.startedAt,
        createdAt: trips.createdAt,
        vehicleId: trips.vehicleId,
        requestId: trips.requestId,
        allocationId: trips.allocationId,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
        requestReference: transportRequests.reference,
        requesterFirstName: employees.firstName,
        requesterLastName: employees.lastName,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
      })
      .from(trips)
      .leftJoin(vehicles, and(eq(trips.vehicleId, vehicles.id), eq(vehicles.tenantId, tenantId)))
      .leftJoin(transportRequests, and(eq(trips.requestId, transportRequests.id), eq(transportRequests.tenantId, tenantId)))
      .leftJoin(employees, and(eq(transportRequests.requesterEmployeeId, employees.id), eq(employees.tenantId, tenantId)))
      .leftJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .where(
        and(
          eq(trips.tenantId, tenantId),
          ne(trips.status, 'closed'),
          ...(assignedEmployeeId ? [eq(vehicleAllocations.driverEmployeeId, assignedEmployeeId)] : []),
        ),
      )
      .orderBy(desc(trips.createdAt));

    const enrichedTrips = await Promise.all(
      tripRows.map(async (trip) => {
        if (!trip.requestId) {
          return { ...trip, readiness: { status: 'pending', blockingCount: 0, pendingCount: 0, passedCount: 0, total: 7, label: 'No request linked', gates: [] } };
        }

        const [workflow] = await db
          .select({ status: workflowInstances.status })
          .from(workflowInstances)
          .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
          .where(and(
            eq(workflowInstances.requestId, trip.requestId),
            eq(transportRequests.tenantId, tenantId),
          ))
          .limit(1);

        const requestApproved = workflow?.status === 'approved' || workflow?.status === 'completed';

        let blockingDefects = 0;
        if (trip.vehicleId) {
          const [defect] = await db
            .select({ count: sql<number>`count(*)` })
            .from(vehicleDefects)
            .innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
            .where(
              and(
                eq(vehicleDefects.vehicleId, trip.vehicleId),
                eq(vehicles.tenantId, tenantId),
                isNull(vehicleDefects.resolvedAt),
                eq(vehicleDefects.isBlocking, true),
              ),
            );
          blockingDefects = Number(defect?.count || 0);
        }

        let depInspectionPassed = false;
        let depInspectionExists = false;
        if (trip.id) {
          const [dep] = await db
            .select({
              id: vehicleInspections.id,
              overallPass: vehicleInspections.overallPass,
            })
            .from(vehicleInspections)
            .where(
              and(
                eq(vehicleInspections.tenantId, tenantId),
                eq(vehicleInspections.tripId, trip.id),
                eq(vehicleInspections.vehicleId, trip.vehicleId),
                eq(vehicleInspections.type, 'departure'),
              ),
            )
            .orderBy(desc(vehicleInspections.createdAt))
            .limit(1);
          depInspectionExists = !!dep;
          depInspectionPassed = dep?.overallPass === true;
        }

        const [authority] = await db
          .select({ id: tripAuthorities.id, status: tripAuthorities.status })
          .from(tripAuthorities)
          .where(and(eq(tripAuthorities.tripId, trip.id), eq(tripAuthorities.tenantId, tenantId)))
          .limit(1);

        const hasAuthority = !!authority;
        const driverAccepted = authority?.status === 'driver_accepted' ||
          authority?.status === 'awaiting_pre_trip_inspection' ||
          authority?.status === 'ready_for_departure';

        let driverIssue = false;
        if (trip.driverEmployeeId) {
          const [profile] = await db
            .select({
              driverStatus: driverProfiles.driverStatus,
              expiryDate: driverLicences.expiryDate,
              verificationStatus: driverLicences.verificationStatus,
            })
            .from(driverProfiles)
            .innerJoin(employees, eq(employees.id, driverProfiles.employeeId))
            .leftJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
            .where(and(
              eq(driverProfiles.employeeId, trip.driverEmployeeId),
              eq(employees.tenantId, tenantId),
              eq(driverLicences.isActive, true),
            ))
            .orderBy(desc(driverLicences.version))
            .limit(1);

          if (!profile || profile.driverStatus !== 'authorised' || profile.verificationStatus !== 'verified') {
            driverIssue = true;
          }
          if (profile?.expiryDate && new Date(`${profile.expiryDate}T23:59:59Z`) <= new Date()) {
            driverIssue = true;
          }
        }

        const gates: { key: string; passed: boolean }[] = [
          { key: 'approvals', passed: requestApproved },
          { key: 'vehicle_allocated', passed: !!trip.vehicleId },
          { key: 'driver_allocated', passed: !!trip.driverEmployeeId && !driverIssue },
          { key: 'no_blocking_defects', passed: blockingDefects === 0 },
          { key: 'departure_inspection', passed: depInspectionExists && depInspectionPassed },
          { key: 'trip_authority', passed: hasAuthority },
          { key: 'driver_accepted', passed: driverAccepted },
        ];

        const blockingCount = gates.filter((g) => !g.passed).length;
        const passedCount = gates.filter((g) => g.passed).length;

        let readinessStatus: 'ready' | 'blocked' | 'pending';
        let readinessLabel: string;

        if (blockingCount === 0 && passedCount === gates.length) {
          readinessStatus = 'ready';
          readinessLabel = 'Ready for release';
        } else if (blockingCount > 3) {
          readinessStatus = 'blocked';
          readinessLabel = `Blocked (${blockingCount} issues)`;
        } else if (blockingCount > 0) {
          readinessStatus = 'blocked';
          readinessLabel = `${blockingCount} gate${blockingCount > 1 ? 's' : ''} blocking`;
        } else {
          readinessStatus = 'pending';
          readinessLabel = `${gates.length - passedCount} pending`;
        }

        return {
          ...trip,
          readiness: {
            status: readinessStatus,
            blockingCount,
            pendingCount: gates.length - passedCount - blockingCount,
            passedCount,
            total: gates.length,
            label: readinessLabel,
            gates,
          },
        };
      }),
    );

    const readyCount = enrichedTrips.filter((t) => t.readiness.status === 'ready').length;
    const blockedCount = enrichedTrips.filter((t) => t.readiness.status === 'blocked').length;
    const pendingSortCount = enrichedTrips.filter((t) => t.readiness.status === 'pending').length;

    const gateCounts = new Map<string, number>();
    for (const t of enrichedTrips) {
      for (const g of t.readiness.gates ?? []) {
        if (!g.passed) {
          gateCounts.set(g.key, (gateCounts.get(g.key) || 0) + 1);
        }
      }
    }
    const topBlockers = [...gateCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, count]) => ({ key, count }));

    return NextResponse.json({
      trips: enrichedTrips,
      summary: {
        total: enrichedTrips.length,
        ready: readyCount,
        blocked: blockedCount,
        pending: pendingSortCount,
      },
      topBlockers,
    });
  } catch (error) {
    console.error('[readiness-dashboard] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch readiness dashboard' }, { status: 500 });
  }
}
