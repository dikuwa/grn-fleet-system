/**
 * Enhanced Analytics API
 *
 * GET /api/reports/enhanced
 *
 * Returns 5 metrics:
 *   1. Approval turnaround detail (time per step, by approver, trends)
 *   2. Vehicle utilisation % (trip hours / available hours × 100)
 *   3. Fuel efficiency (km/L per vehicle)
 *   4. Late returns (delayed trips, avg delay, late rate)
 *   5. Rejection metrics (rejection rate, reasons, trends)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, tripClosures, fuelTransactions } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { workflowActions, workflowInstances } from '@/db/schema/workflows';
import { employees } from '@/db/schema/people';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { sql, eq, and, gte, lte, count, desc } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function getDateRange(period: string): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end);
  switch (period) {
    case '7d':
      start.setDate(start.getDate() - 7);
      break;
    case '30d':
      start.setDate(start.getDate() - 30);
      break;
    case '90d':
      start.setDate(start.getDate() - 90);
      break;
    case '1y':
      start.setFullYear(start.getFullYear() - 1);
      break;
    default:
      start.setDate(start.getDate() - 30);
  }
  return { start, end };
}

// ---------------------------------------------------------------------------
// 1. Approval Turnaround Detail
// ---------------------------------------------------------------------------

async function getApprovalTurnaround(db: ReturnType<typeof getDb>, tenantId: string, start: Date) {
  // Time per step: avg hours between consecutive actions per workflow
  const stepTimes = await db
    .select({
      stepOrder: workflowActions.stepOrder,
      actionType: workflowActions.actionType,
      result: workflowActions.result,
      createdAt: workflowActions.createdAt,
      instanceId: workflowActions.instanceId,
    })
    .from(workflowActions)
    .innerJoin(workflowInstances, eq(workflowActions.instanceId, workflowInstances.id))
    .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
    .where(and(eq(transportRequests.tenantId, tenantId), gte(workflowActions.createdAt, start)))
    .orderBy(workflowActions.createdAt);

  // Calculate step-to-step times per workflow
  const workflowMap = new Map<string, typeof stepTimes>();
  for (const action of stepTimes) {
    const existing = workflowMap.get(action.instanceId) || [];
    existing.push(action);
    workflowMap.set(action.instanceId, existing);
  }

  // Compute total approval times per workflow
  const workflowAverages: { workflowId: string; totalHours: number; stepCount: number }[] = [];
  for (const [workflowId, actions] of workflowMap) {
    if (actions.length < 2) continue;
    const first = new Date(actions[0].createdAt).getTime();
    const last = new Date(actions[actions.length - 1].createdAt).getTime();
    const totalHours = (last - first) / (1000 * 60 * 60);
    workflowAverages.push({ workflowId, totalHours, stepCount: actions.length });
  }

  // Get step-by-step average times
  const stepDurations: { stepOrder: number; avgHours: number }[] = [];
  for (const [, actions] of workflowMap) {
    for (let i = 1; i < actions.length; i++) {
      const hours = (new Date(actions[i].createdAt).getTime() - new Date(actions[i - 1].createdAt).getTime()) / (1000 * 60 * 60);
      const existing = stepDurations.find((s) => s.stepOrder === actions[i].stepOrder);
      if (existing) {
        existing.avgHours = (existing.avgHours + hours) / 2;
      } else {
        stepDurations.push({ stepOrder: actions[i].stepOrder, avgHours: hours });
      }
    }
  }

  const totalActions = stepTimes.length;
  const completedWorkflows = workflowAverages.length;
  const avgTotalHours =
    completedWorkflows > 0
      ? workflowAverages.reduce((s, w) => s + w.totalHours, 0) / completedWorkflows
      : 0;

  // Monthly trend of approval times
  const monthlyTrend = await db
    .select({
      month: sql<string>`to_char(${workflowActions.createdAt}, 'YYYY-MM')`,
      avgHours: sql<number>`COALESCE(
        EXTRACT(EPOCH FROM (MAX(${workflowActions.createdAt}) - MIN(${workflowActions.createdAt}))) / 3600 / COUNT(DISTINCT ${workflowActions.instanceId}),
        0
      )`,
      actionCount: count(),
    })
    .from(workflowActions)
    .innerJoin(workflowInstances, eq(workflowActions.instanceId, workflowInstances.id))
    .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
    .where(and(eq(transportRequests.tenantId, tenantId), gte(workflowActions.createdAt, start)))
    .groupBy(sql`to_char(${workflowActions.createdAt}, 'YYYY-MM')`)
    .orderBy(sql`month`);

  return {
    avgTotalHours: Math.round(avgTotalHours * 10) / 10,
    totalActions,
    completedWorkflows,
    stepDurations: stepDurations.sort((a, b) => a.stepOrder - b.stepOrder),
    monthlyTrend,
    workflowBreakdown: workflowAverages.slice(0, 10), // Top 10
  };
}

// ---------------------------------------------------------------------------
// 2. Vehicle Utilisation %
// ---------------------------------------------------------------------------

async function getVehicleUtilisation(db: ReturnType<typeof getDb>, tenantId: string, start: Date, end: Date) {
  const totalHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

  const utilisation = await db
    .select({
      vehicleId: trips.vehicleId,
      licenceNumber: vehicles.licenceNumber,
      totalTripHours: sql<number>`COALESCE(
        EXTRACT(EPOCH FROM (COALESCE(${trips.closedAt}, ${trips.returnedAt}, ${trips.startedAt}, ${trips.createdAt}) - ${trips.createdAt})) / 3600,
        0
      )`,
      totalTrips: count(),
      status: vehicles.status,
    })
    .from(trips)
    .innerJoin(vehicles, eq(trips.vehicleId, vehicles.id))
    .where(and(eq(vehicles.tenantId, tenantId), gte(trips.startedAt, start)))
    .groupBy(trips.vehicleId, vehicles.licenceNumber, vehicles.status)
    .orderBy(sql`totalTripHours DESC`);

  const totalVehicles = utilisation.length;
  const totalUtilisedHours = utilisation.reduce((s, v) => s + Number(v.totalTripHours || 0), 0);
  const avgUtilisation = totalVehicles > 0 ? (totalUtilisedHours / (totalVehicles * totalHours)) * 100 : 0;

  const underUtilised = utilisation.filter(
    (v) => Number(v.totalTripHours || 0) < totalHours * 0.1,
  );

  return {
    totalVehicles,
    totalHours,
    avgUtilisation: Math.round(avgUtilisation * 10) / 10,
    totalUtilisedHours: Math.round(totalUtilisedHours * 10) / 10,
    underUtilisedCount: underUtilised.length,
    underUtilisedVehicles: underUtilised.map((v) => ({
      vehicleId: v.vehicleId,
      licenceNumber: v.licenceNumber,
      totalTrips: v.totalTrips,
      totalTripHours: Math.round(Number(v.totalTripHours || 0) * 10) / 10,
      utilisationPct: Math.round((Number(v.totalTripHours || 0) / totalHours) * 100),
      status: v.status,
    })),
    vehicleBreakdown: utilisation.map((v) => ({
      vehicleId: v.vehicleId,
      licenceNumber: v.licenceNumber,
      totalTrips: v.totalTrips,
      totalTripHours: Math.round(Number(v.totalTripHours || 0) * 10) / 10,
      utilisationPct: Math.round((Number(v.totalTripHours || 0) / totalHours) * 100),
      status: v.status,
    })),
  };
}

// ---------------------------------------------------------------------------
// 3. Fuel Efficiency (km/L)
// ---------------------------------------------------------------------------

async function getFuelEfficiency(db: ReturnType<typeof getDb>, tenantId: string, start: Date) {
  const efficiency = await db
    .select({
      vehicleId: fuelTransactions.vehicleId,
      licenceNumber: vehicles.licenceNumber,
      totalLitres: sql<number>`COALESCE(SUM(${fuelTransactions.litres}), 0)`,
      totalAmount: sql<number>`COALESCE(SUM(${fuelTransactions.amount}), 0)`,
      transactionCount: count(),
      avgCostPerLitre: sql<number>`COALESCE(SUM(${fuelTransactions.amount}) / NULLIF(SUM(${fuelTransactions.litres}), 0), 0)`,
    })
    .from(fuelTransactions)
    .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
    .where(and(eq(vehicles.tenantId, tenantId), gte(fuelTransactions.createdAt, start)))
    .groupBy(fuelTransactions.vehicleId, vehicles.licenceNumber)
    .orderBy(sql`totalLitres DESC`);

  // Get trip distances per vehicle to calculate km/L
  const tripDistances = await db
    .select({
      vehicleId: trips.vehicleId,
      totalDistance: sql<number>`COALESCE(SUM(${tripClosures.actualKilometres}), 0)`,
    })
    .from(tripClosures)
    .innerJoin(trips, eq(tripClosures.tripId, trips.id))
    .innerJoin(vehicles, eq(trips.vehicleId, vehicles.id))
    .where(and(eq(vehicles.tenantId, tenantId), gte(trips.createdAt, start)))
    .groupBy(trips.vehicleId);

  const distMap = new Map(tripDistances.map((d) => [d.vehicleId, Number(d.totalDistance || 0)]));

  const fleetEfficiency = efficiency.map((v) => {
    const distance = distMap.get(v.vehicleId) || 0;
    const litres = Number(v.totalLitres || 0);
    return {
      vehicleId: v.vehicleId,
      licenceNumber: v.licenceNumber,
      totalLitres: Math.round(litres * 10) / 10,
      totalAmount: Math.round(Number(v.totalAmount || 0) * 100) / 100,
      estimatedDistanceKm: distance,
      kmPerLitre: litres > 0 ? Math.round((distance / litres) * 10) / 10 : null,
      avgCostPerLitre: Math.round(Number(v.avgCostPerLitre || 0) * 100) / 100,
      transactionCount: v.transactionCount,
    };
  });

  const totalLitres = fleetEfficiency.reduce((s, v) => s + v.totalLitres, 0);
  const totalDistance = fleetEfficiency.reduce((s, v) => s + v.estimatedDistanceKm, 0);
  const fleetAvgKmPerLitre = totalLitres > 0 ? Math.round((totalDistance / totalLitres) * 10) / 10 : null;

  return {
    fleetAvgKmPerLitre,
    totalLitres: Math.round(totalLitres * 10) / 10,
    totalDistance: Math.round(totalDistance / 10) * 10,
    totalFuelCost: fleetEfficiency.reduce((s, v) => s + v.totalAmount, 0),
    perVehicle: fleetEfficiency,
  };
}

// ---------------------------------------------------------------------------
// 4. Late Returns
// ---------------------------------------------------------------------------

async function getLateReturns(db: ReturnType<typeof getDb>, tenantId: string, start: Date) {
  // "Late" = trip where returnedAt - startedAt > expected duration × 1.5
  // We also consider trips that were authorised for a specific duration vs actual
  const lateTrips = await db
    .select({
      tripId: trips.id,
      vehicleLicence: vehicles.licenceNumber,
      startedAt: trips.startedAt,
      returnedAt: trips.returnedAt,
      closedAt: trips.closedAt,
      status: trips.status,
      expectedEnd: sql<Date>`${trips.startedAt}::timestamp + interval '8 hours'`,
    })
    .from(trips)
    .innerJoin(vehicles, eq(trips.vehicleId, vehicles.id))
    .where(
      and(
        eq(vehicles.tenantId, tenantId),
        gte(trips.startedAt, start),
        sql`${trips.returnedAt} IS NOT NULL`,
      ),
    )
    .orderBy(desc(trips.returnedAt));

  const lateOnes = lateTrips
    .filter((t) => {
      if (!t.startedAt || !t.returnedAt) return false;
      const actualDuration =
        (new Date(t.returnedAt).getTime() - new Date(t.startedAt).getTime()) / (1000 * 60 * 60);
      const expectedDuration = 8; // Default 8-hour shift
      return actualDuration > expectedDuration * 1.5;
    })
    .map((t) => {
      const started = new Date(t.startedAt!);
      const returned = new Date(t.returnedAt!);
      const actualHours = (returned.getTime() - started.getTime()) / (1000 * 60 * 60);
      return {
        tripId: t.tripId,
        vehicleLicence: t.vehicleLicence,
        startedAt: started.toISOString(),
        returnedAt: returned.toISOString(),
        actualHours: Math.round(actualHours * 10) / 10,
        delayHours: Math.round((actualHours - 8) * 10) / 10,
        status: t.status,
      };
    });

  const totalTripsInPeriod = lateTrips.length;
  const lateCount = lateOnes.length;
  const lateRate = totalTripsInPeriod > 0 ? Math.round((lateCount / totalTripsInPeriod) * 100) : 0;
  const avgDelay =
    lateOnes.length > 0
      ? Math.round(lateOnes.reduce((s, t) => s + t.delayHours, 0) / lateOnes.length * 10) / 10
      : 0;

  // Monthly late return trend
  const monthlyLateTrend = await db
    .select({
      month: sql<string>`to_char(${trips.startedAt}, 'YYYY-MM')`,
      totalTrips: count(),
      lateTrips: sql<number>`COUNT(*) FILTER (WHERE ${trips.returnedAt} IS NOT NULL AND EXTRACT(EPOCH FROM (${trips.returnedAt} - ${trips.startedAt})) / 3600 > 12)`,
    })
    .from(trips)
    .innerJoin(vehicles, eq(trips.vehicleId, vehicles.id))
    .where(
      and(
        eq(vehicles.tenantId, tenantId),
        gte(trips.startedAt, start),
        sql`${trips.returnedAt} IS NOT NULL`,
      ),
    )
    .groupBy(sql`to_char(${trips.startedAt}, 'YYYY-MM')`)
    .orderBy(sql`month`);

  return {
    lateCount,
    totalTrips: totalTripsInPeriod,
    lateRate,
    avgDelayHours: avgDelay,
    lateTrips: lateOnes.slice(0, 20),
    monthlyLateTrend,
  };
}

// ---------------------------------------------------------------------------
// 5. Rejection Metrics
// ---------------------------------------------------------------------------

async function getRejectionMetrics(db: ReturnType<typeof getDb>, tenantId: string, start: Date) {
  // Transport requests that were rejected vs total
  const [rejectionSummary] = await db
    .select({
      totalRequests: count(),
      rejectedCount: sql<number>`COUNT(*) FILTER (WHERE ${transportRequests.status} = 'rejected')`,
      approvedCount: sql<number>`COUNT(*) FILTER (WHERE ${transportRequests.status} = 'approved')`,
      draftCount: sql<number>`COUNT(*) FILTER (WHERE ${transportRequests.status} = 'draft')`,
      submittedCount: sql<number>`COUNT(*) FILTER (WHERE ${transportRequests.status} = 'submitted')`,
      closedCount: sql<number>`COUNT(*) FILTER (WHERE ${transportRequests.status} = 'closed')`,
      cancelledCount: sql<number>`COUNT(*) FILTER (WHERE ${transportRequests.status} = 'cancelled')`,
    })
    .from(transportRequests)
    .where(and(eq(transportRequests.tenantId, tenantId), gte(transportRequests.createdAt, start)));

  // Rejection reasons from workflow actions
  const rejections = await db
    .select({
      instanceId: workflowActions.instanceId,
      reason: workflowActions.comment,
      createdAt: workflowActions.createdAt,
    })
    .from(workflowActions)
    .innerJoin(workflowInstances, eq(workflowActions.instanceId, workflowInstances.id))
    .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
    .where(
      and(
        eq(transportRequests.tenantId, tenantId),
        eq(workflowActions.result, 'rejected'),
        gte(workflowActions.createdAt, start),
      ),
    )
    .orderBy(desc(workflowActions.createdAt))
    .limit(50);

  // Monthly rejection trend
  const monthlyRejectionTrend = await db
    .select({
      month: sql<string>`to_char(${transportRequests.createdAt}, 'YYYY-MM')`,
      total: count(),
      rejected: sql<number>`COUNT(*) FILTER (WHERE ${transportRequests.status} = 'rejected')`,
      approved: sql<number>`COUNT(*) FILTER (WHERE ${transportRequests.status} = 'approved')`,
    })
    .from(transportRequests)
    .where(and(eq(transportRequests.tenantId, tenantId), gte(transportRequests.createdAt, start)))
    .groupBy(sql`to_char(${transportRequests.createdAt}, 'YYYY-MM')`)
    .orderBy(sql`month`);

  const total = Number(rejectionSummary?.totalRequests || 0);
  const rejected = Number(rejectionSummary?.rejectedCount || 0);
  const approved = Number(rejectionSummary?.approvedCount || 0);
  const rejectionRate = total > 0 ? Math.round((rejected / total) * 100) : 0;
  const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;

  return {
    totalRequests: total,
    rejected,
    approved,
    cancelled: Number(rejectionSummary?.cancelledCount || 0),
    rejectionRate,
    approvalRate,
    rejectionReasons: rejections.map((r) => ({
      reason: r.reason || 'No reason provided',
      date: r.createdAt.toISOString().split('T')[0],
    })),
    monthlyTrend: monthlyRejectionTrend,
  };
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.REPORT_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '30d';
    const { start, end } = getDateRange(period);
    const db = getDb();
    const tenantId = session.tenantId;

    // Run all 5 metric queries in parallel
    const [approvalTurnaround, vehicleUtilisation, fuelEfficiency, lateReturns, rejectionMetrics] =
      await Promise.all([
        getApprovalTurnaround(db, tenantId, start),
        getVehicleUtilisation(db, tenantId, start, end),
        getFuelEfficiency(db, tenantId, start),
        getLateReturns(db, tenantId, start),
        getRejectionMetrics(db, tenantId, start),
      ]);

    return NextResponse.json({
      success: true,
      period,
      generatedAt: new Date().toISOString(),
      data: {
        approvalTurnaround,
        vehicleUtilisation,
        fuelEfficiency,
        lateReturns,
        rejectionMetrics,
      },
    });
  } catch (error) {
    console.error('[Enhanced Reports] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to generate enhanced analytics: ' + String(error) },
      { status: 500 },
    );
  }
}
