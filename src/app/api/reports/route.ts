import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { fuelTransactions, reimbursements, trips } from '@/db/schema/trips';
import { vehicles, maintenanceEvents } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { workflowActions, workflowInstances } from '@/db/schema/workflows';
import { sql, eq, and, gte, count } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCSV(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const header = columns.map((c) => JSON.stringify(c.label)).join(',');
  const body = rows
    .map((row) => columns.map((c) => JSON.stringify(String(row[c.key] ?? ''))).join(','))
    .join('\n');
  return header + '\n' + body;
}

function buildCSVResponse(csv: string, filename: string): NextResponse {
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

async function buildExcelBuffer(
  rows: Record<string, unknown>[],
  columns: { key: string; label: string }[],
  sheetName: string,
): Promise<Uint8Array> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.default.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.max(c.label.length + 5, 15),
  }));

  rows.forEach((row) => sheet.addRow(row));

  sheet.getRow(1).font = { bold: true };

  const buf = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Date range calculation
// ---------------------------------------------------------------------------

function getDateRange(period: string): Date {
  const now = new Date();
  switch (period) {
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '90d':
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case '1y':
      return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
}

// ---------------------------------------------------------------------------
// Export row builders
// ---------------------------------------------------------------------------

async function buildFuelRows(db: ReturnType<typeof getDb>, tenantId: string, startDate: Date) {
  return db
    .select({
      vehicle: vehicles.licenceNumber,
      date: fuelTransactions.transactionAt,
      litres: fuelTransactions.litres,
      amount: fuelTransactions.amount,
      fuelType: fuelTransactions.fuelType,
      station: fuelTransactions.stationName,
      paymentMethod: fuelTransactions.paymentMethod,
      odometer: fuelTransactions.odometerReading,
    })
    .from(fuelTransactions)
    .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
    .where(and(eq(vehicles.tenantId, tenantId), gte(fuelTransactions.createdAt, startDate)))
    .orderBy(sql`fuel_transactions.transaction_at DESC`);
}

async function buildTripRows(db: ReturnType<typeof getDb>, tenantId: string, startDate: Date) {
  return db
    .select({
      status: trips.status,
      vehicle: vehicles.licenceNumber,
      started: trips.startedAt,
      returned: trips.returnedAt,
      closed: trips.closedAt,
      createdAt: trips.createdAt,
    })
    .from(trips)
    .innerJoin(vehicles, eq(trips.vehicleId, vehicles.id))
    .where(and(eq(vehicles.tenantId, tenantId), gte(trips.createdAt, startDate)))
    .orderBy(sql`trips.created_at DESC`);
}

async function buildRequestRows(db: ReturnType<typeof getDb>, tenantId: string, startDate: Date) {
  return db
    .select({
      reference: transportRequests.reference,
      status: transportRequests.status,
      purpose: transportRequests.purpose,
      scope: transportRequests.scope,
      createdAt: transportRequests.createdAt,
    })
    .from(transportRequests)
    .where(and(eq(transportRequests.tenantId, tenantId), gte(transportRequests.createdAt, startDate)))
    .orderBy(sql`transport_requests.created_at DESC`);
}

async function buildMaintenanceRows(db: ReturnType<typeof getDb>, tenantId: string, startDate: Date) {
  return db
    .select({
      vehicle: vehicles.licenceNumber,
      type: maintenanceEvents.serviceType,
      description: maintenanceEvents.description,
      date: maintenanceEvents.serviceDate,
      cost: maintenanceEvents.cost,
      vendor: maintenanceEvents.vendorName,
    })
    .from(maintenanceEvents)
    .innerJoin(vehicles, eq(maintenanceEvents.vehicleId, vehicles.id))
    .where(
      and(
        eq(vehicles.tenantId, tenantId),
        gte(maintenanceEvents.serviceDate, startDate.toISOString().split('T')[0]),
      ),
    )
    .orderBy(sql`maintenance_events.service_date DESC`);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const reportType = searchParams.get('type') || 'fuel';
    const exportFormat = searchParams.get('export'); // 'csv' | 'excel'

    // Require auth — reports are tenant-scoped
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    // Require REPORT_VIEW permission
    const permCheck = await requirePermission(session, Permissions.REPORT_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const tenantId = session.tenantId;
    const period = searchParams.get('period') || '30d';
    const startDate = getDateRange(period);
    const db = getDb();

    // Handle export formats first
    if (exportFormat === 'csv') {
      let rows: Record<string, unknown>[] = [];
      let columns: { key: string; label: string }[] = [];
      let filename = '';

      switch (reportType) {
        case 'fuel':
          rows = await buildFuelRows(db, tenantId, startDate);
          columns = [
            { key: 'vehicle', label: 'Vehicle' },
            { key: 'date', label: 'Date' },
            { key: 'litres', label: 'Litres' },
            { key: 'amount', label: 'Amount (N$)' },
            { key: 'fuelType', label: 'Fuel Type' },
            { key: 'station', label: 'Station' },
            { key: 'paymentMethod', label: 'Payment' },
            { key: 'odometer', label: 'Odometer' },
          ];
          filename = `fuel-report-${period}-${new Date().toISOString().split('T')[0]}.csv`;
          break;
        case 'trips':
          rows = await buildTripRows(db, tenantId, startDate);
          columns = [
            { key: 'status', label: 'Status' },
            { key: 'vehicle', label: 'Vehicle' },
            { key: 'started', label: 'Started' },
            { key: 'returned', label: 'Returned' },
            { key: 'closed', label: 'Closed' },
            { key: 'createdAt', label: 'Created' },
          ];
          filename = `trip-report-${period}-${new Date().toISOString().split('T')[0]}.csv`;
          break;
        case 'requests':
          rows = await buildRequestRows(db, tenantId, startDate);
          columns = [
            { key: 'reference', label: 'Reference' },
            { key: 'status', label: 'Status' },
            { key: 'purpose', label: 'Purpose' },
            { key: 'scope', label: 'Scope' },
            { key: 'createdAt', label: 'Created' },
          ];
          filename = `requests-report-${period}-${new Date().toISOString().split('T')[0]}.csv`;
          break;
        case 'maintenance':
          rows = await buildMaintenanceRows(db, tenantId, startDate);
          columns = [
            { key: 'vehicle', label: 'Vehicle' },
            { key: 'type', label: 'Service Type' },
            { key: 'description', label: 'Description' },
            { key: 'date', label: 'Service Date' },
            { key: 'cost', label: 'Cost (N$)' },
            { key: 'vendor', label: 'Vendor' },
          ];
          filename = `maintenance-report-${period}-${new Date().toISOString().split('T')[0]}.csv`;
          break;
        case 'approvals':
          rows = await db
            .select({
              workflowId: workflowActions.instanceId,
              stepOrder: workflowActions.stepOrder,
              actionType: workflowActions.actionType,
              result: workflowActions.result,
              createdAt: workflowActions.createdAt,
            })
            .from(workflowActions)
            .innerJoin(workflowInstances, eq(workflowActions.instanceId, workflowInstances.id))
            .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
            .where(and(eq(transportRequests.tenantId, tenantId), gte(workflowActions.createdAt, startDate)))
            .orderBy(sql`workflow_actions.created_at DESC`);
          columns = [
            { key: 'workflowId', label: 'Workflow ID' },
            { key: 'stepOrder', label: 'Step' },
            { key: 'actionType', label: 'Action Type' },
            { key: 'result', label: 'Result' },
            { key: 'createdAt', label: 'Date' },
          ];
          filename = `approvals-report-${period}-${new Date().toISOString().split('T')[0]}.csv`;
          break;
        default:
          rows = [];
          columns = [{ key: 'info', label: 'Information' }];
          filename = `report-${period}.csv`;
      }

      const csv = buildCSV(rows, columns);
      return buildCSVResponse(csv, filename);
    }

    if (exportFormat === 'excel') {
      let rows: Record<string, unknown>[] = [];
      let columns: { key: string; label: string }[] = [];
      let sheetName = 'Report';

      switch (reportType) {
        case 'fuel':
          rows = await buildFuelRows(db, tenantId, startDate);
          columns = [
            { key: 'vehicle', label: 'Vehicle' },
            { key: 'date', label: 'Date' },
            { key: 'litres', label: 'Litres' },
            { key: 'amount', label: 'Amount (N$)' },
            { key: 'fuelType', label: 'Fuel Type' },
            { key: 'station', label: 'Station' },
            { key: 'paymentMethod', label: 'Payment' },
            { key: 'odometer', label: 'Odometer' },
          ];
          sheetName = 'Fuel';
          break;
        case 'trips':
          rows = await buildTripRows(db, tenantId, startDate);
          columns = [
            { key: 'status', label: 'Status' },
            { key: 'vehicle', label: 'Vehicle' },
            { key: 'started', label: 'Started' },
            { key: 'returned', label: 'Returned' },
            { key: 'closed', label: 'Closed' },
          ];
          sheetName = 'Trips';
          break;
        case 'requests':
          rows = await buildRequestRows(db, tenantId, startDate);
          columns = [
            { key: 'reference', label: 'Reference' },
            { key: 'status', label: 'Status' },
            { key: 'purpose', label: 'Purpose' },
            { key: 'scope', label: 'Scope' },
            { key: 'createdAt', label: 'Created' },
          ];
          sheetName = 'Requests';
          break;
        case 'maintenance':
          rows = await buildMaintenanceRows(db, tenantId, startDate);
          columns = [
            { key: 'vehicle', label: 'Vehicle' },
            { key: 'type', label: 'Service Type' },
            { key: 'description', label: 'Description' },
            { key: 'date', label: 'Service Date' },
            { key: 'cost', label: 'Cost (N$)' },
            { key: 'vendor', label: 'Vendor' },
          ];
          sheetName = 'Maintenance';
          break;
        case 'approvals':
          rows = await db
            .select({
              workflowId: workflowActions.instanceId,
              stepOrder: workflowActions.stepOrder,
              actionType: workflowActions.actionType,
              result: workflowActions.result,
              createdAt: workflowActions.createdAt,
            })
            .from(workflowActions)
            .innerJoin(workflowInstances, eq(workflowActions.instanceId, workflowInstances.id))
            .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
            .where(and(eq(transportRequests.tenantId, tenantId), gte(workflowActions.createdAt, startDate)))
            .orderBy(sql`workflow_actions.created_at DESC`);
          columns = [
            { key: 'workflowId', label: 'Workflow ID' },
            { key: 'stepOrder', label: 'Step' },
            { key: 'actionType', label: 'Action Type' },
            { key: 'result', label: 'Result' },
            { key: 'createdAt', label: 'Date' },
          ];
          sheetName = 'Approvals';
          break;
        default:
          break;
      }

      const buffer = await buildExcelBuffer(rows, columns, sheetName);
      const filename = `${reportType}-report-${period}-${new Date().toISOString().split('T')[0]}.xlsx`;
      return new NextResponse(buffer as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    // -----------------------------------------------------------------------
    // Normal JSON responses
    // -----------------------------------------------------------------------

    switch (reportType) {
      case 'fuel': {
        const fuelSummary = await db
          .select({
            totalLitres: sql`COALESCE(SUM(litres), 0)`.as('total_litres'),
            totalAmount: sql`COALESCE(SUM(amount), 0)`.as('total_amount'),
            transactionCount: count(),
            avgCostPerLitre: sql`COALESCE(SUM(amount) / NULLIF(SUM(litres), 0), 0)`.as('avg_cost'),
          })
          .from(fuelTransactions)
          .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
          .where(and(eq(vehicles.tenantId, tenantId), gte(fuelTransactions.createdAt, startDate)));

        const topConsumers = await db
          .select({
            vehicleId: fuelTransactions.vehicleId,
            licenceNumber: vehicles.licenceNumber,
            litres: sql`COALESCE(SUM(${fuelTransactions.litres}), 0)`.as('total_litres'),
            amount: sql`COALESCE(SUM(${fuelTransactions.amount}), 0)`.as('total_amount'),
          })
          .from(fuelTransactions)
          .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
          .where(and(eq(vehicles.tenantId, tenantId), gte(fuelTransactions.createdAt, startDate)))
          .groupBy(fuelTransactions.vehicleId, vehicles.licenceNumber)
          .orderBy(sql`total_litres DESC`)
          .limit(10);

        const reimbursementSummary = await db
          .select({ totalPending: count(), totalAmount: sql`COALESCE(SUM(reimbursements.amount), 0)`.as('total_amount') })
          .from(reimbursements)
          .innerJoin(fuelTransactions, eq(reimbursements.transactionId, fuelTransactions.id))
          .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
          .where(and(eq(vehicles.tenantId, tenantId), eq(reimbursements.state, 'pending')));

        return NextResponse.json({
          success: true,
          data: { summary: fuelSummary[0], topConsumers, reimbursements: reimbursementSummary[0] },
        });
      }

      case 'fleet': {
        const fleetStatus = await db
          .select({ status: vehicles.status, count: count() })
          .from(vehicles)
          .where(eq(vehicles.tenantId, tenantId))
          .groupBy(vehicles.status);
        const [totalVehicles] = await db
          .select({ count: count() })
          .from(vehicles)
          .where(eq(vehicles.tenantId, tenantId));
        return NextResponse.json({
          success: true,
          data: { statusDistribution: fleetStatus, totalVehicles: totalVehicles?.count || 0 },
        });
      }

      case 'trips': {
        const tripStats = await db
          .select({ totalTrips: count(), status: trips.status })
          .from(trips)
          .innerJoin(vehicles, eq(trips.vehicleId, vehicles.id))
          .where(and(eq(vehicles.tenantId, tenantId), gte(trips.createdAt, startDate)))
          .groupBy(trips.status);
        return NextResponse.json({ success: true, data: { tripStats } });
      }

      case 'requests': {
        const requestStats = await db
          .select({ totalRequests: count(), status: transportRequests.status })
          .from(transportRequests)
          .where(and(eq(transportRequests.tenantId, tenantId), gte(transportRequests.createdAt, startDate)))
          .groupBy(transportRequests.status);
        return NextResponse.json({ success: true, data: { requestStats } });
      }

      case 'maintenance': {
        const maintStats = await db
          .select({
            totalEvents: count(),
            totalCost: sql`COALESCE(SUM(${maintenanceEvents.cost}), 0)`.as('total_cost'),
            serviceType: maintenanceEvents.serviceType,
          })
          .from(maintenanceEvents)
          .innerJoin(vehicles, eq(maintenanceEvents.vehicleId, vehicles.id))
          .where(
            and(
              eq(vehicles.tenantId, tenantId),
              gte(maintenanceEvents.serviceDate, startDate.toISOString().split('T')[0]),
            ),
          )
          .groupBy(maintenanceEvents.serviceType);
        return NextResponse.json({ success: true, data: { maintenanceStats: maintStats } });
      }

      // Approval Analytics
      case 'approvals': {
        // Average approval time (in hours) across all completed workflows
        const [avgApprovalTime] = await db
          .select({
            avgHours: sql`COALESCE(
              EXTRACT(EPOCH FROM (MAX(${workflowActions.createdAt}) - MIN(${workflowActions.createdAt}))) / 3600,
              0
            )`.as('avg_hours'),
            totalActions: count(),
          })
          .from(workflowActions)
          .innerJoin(workflowInstances, eq(workflowActions.instanceId, workflowInstances.id))
          .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
          .where(and(eq(transportRequests.tenantId, tenantId), gte(workflowActions.createdAt, startDate)));

        // Approval rate by result type
        const approvalRate = await db
          .select({
            result: workflowActions.result,
            count: count(),
          })
          .from(workflowActions)
          .innerJoin(workflowInstances, eq(workflowActions.instanceId, workflowInstances.id))
          .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
          .where(and(eq(transportRequests.tenantId, tenantId), gte(workflowActions.createdAt, startDate)))
          .groupBy(workflowActions.result);

        // Steps histogram — how many actions per step order
        const stepsHistogram = await db
          .select({
            stepOrder: workflowActions.stepOrder,
            count: count(),
          })
          .from(workflowActions)
          .innerJoin(workflowInstances, eq(workflowActions.instanceId, workflowInstances.id))
          .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
          .where(and(eq(transportRequests.tenantId, tenantId), gte(workflowActions.createdAt, startDate)))
          .groupBy(workflowActions.stepOrder)
          .orderBy(workflowActions.stepOrder);

        // Unique workflows affected
        const [workflowCount] = await db
          .select({ count: count() })
          .from(workflowInstances)
          .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
          .where(and(eq(transportRequests.tenantId, tenantId), gte(workflowInstances.createdAt, startDate)));

        return NextResponse.json({
          success: true,
          data: {
            avgApprovalTime: avgApprovalTime?.avgHours || 0,
            totalActions: avgApprovalTime?.totalActions || 0,
            totalWorkflows: workflowCount?.count || 0,
            approvalRate,
            stepsHistogram,
          },
        });
      }

      default: {
        const [activeRequests] = await db
          .select({ count: count() })
          .from(transportRequests)
          .where(and(eq(transportRequests.tenantId, tenantId), sql`${transportRequests.status} NOT IN ('closed', 'cancelled')`));

        const [activeTrips] = await db
          .select({ count: count() })
          .from(trips)
          .innerJoin(vehicles, eq(trips.vehicleId, vehicles.id))
          .where(and(eq(vehicles.tenantId, tenantId), sql`${trips.status} IN ('pending', 'in_progress')`));

        const [openDefects] = await db
          .select({ count: count() })
          .from(vehicles)
          .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.status, 'maintenance')));

        return NextResponse.json({ success: true, data: { activeRequests: activeRequests?.count || 0, activeTrips: activeTrips?.count || 0, openDefects: openDefects?.count || 0 } });
      }
    }
  } catch (error) {
    console.error('Reports API failed:', error);
    return NextResponse.json({ error: 'Failed to generate report: ' + String(error) }, { status: 500 });
  }
}
