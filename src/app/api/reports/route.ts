import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getDb } from '@/db';
import { fuelTransactions, reimbursements, tripAuthorities, trips, tripClosures } from '@/db/schema/trips';
import { vehicles, maintenanceEvents } from '@/db/schema/fleet';
import { transportRequests, requestRoutes } from '@/db/schema/requests';
import { workflowActions, workflowInstances } from '@/db/schema/workflows';
import { sql, eq, and, gte, count } from 'drizzle-orm';
import { offices } from '@/db/schema/people';
import { regions } from '@/db/schema/fleet';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { resolveTenantDocumentBranding } from '@/lib/tenant-branding';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCSV(
  rows: Record<string, unknown>[],
  columns: { key: string; label: string }[],
): string {
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
    .where(and(eq(vehicles.tenantId, tenantId), gte(fuelTransactions.transactionAt, startDate)))
    .orderBy(sql`fuel_transactions.transaction_at DESC`);
}

async function buildTripRows(db: ReturnType<typeof getDb>, tenantId: string, startDate: Date) {
  return db
    .select({
      status: trips.status,
      authorityNumber: tripAuthorities.authorityNumber,
      authorityStatus: tripAuthorities.status,
      vehicle: vehicles.licenceNumber,
      started: trips.startedAt,
      returned: trips.returnedAt,
      closed: trips.closedAt,
      createdAt: trips.createdAt,
      purpose: tripAuthorities.purpose,
      origin: tripAuthorities.origin,
      destination: tripAuthorities.destination,
      beginningOdometer: tripAuthorities.beginningOdometer,
      endingOdometer: tripAuthorities.endingOdometer,
      routeKm: sql<number>`COALESCE((
        SELECT SUM(rr.total_kilometres) FROM ${requestRoutes} rr
        WHERE rr.request_id = ${trips.requestId}
      ), 0)`.as('route_km'),
      actualKm: sql<number>`COALESCE((
        SELECT tc.actual_kilometres FROM ${tripClosures} tc
        WHERE tc.trip_id = ${trips.id}
      ), 0)`.as('actual_km'),
    })
    .from(trips)
    .innerJoin(vehicles, eq(trips.vehicleId, vehicles.id))
    .leftJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
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
    .where(
      and(eq(transportRequests.tenantId, tenantId), gte(transportRequests.createdAt, startDate)),
    )
    .orderBy(sql`transport_requests.created_at DESC`);
}

async function buildFleetRows(db: ReturnType<typeof getDb>, tenantId: string) {
  return db
    .select({
      licenceNumber: vehicles.licenceNumber,
      vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
      make: vehicles.make,
      model: vehicles.model,
      category: vehicles.vehicleCategory,
      status: vehicles.status,
      fuelType: vehicles.fuelType,
      transmission: vehicles.transmission,
      currentOdometer: vehicles.currentOdometer,
      seatedCapacity: vehicles.seatedCapacity,
      licenceExpiryDate: vehicles.licenceExpiryDate,
      roadworthyTestDate: vehicles.roadworthyTestDate,
      officeName: offices.name,
      regionName: regions.name,
      createdAt: vehicles.createdAt,
    })
    .from(vehicles)
    .leftJoin(offices, eq(vehicles.assignedOfficeId, offices.id))
    .leftJoin(regions, eq(vehicles.assignedRegionId, regions.id))
    .where(eq(vehicles.tenantId, tenantId))
    .orderBy(sql`vehicles.created_at DESC`);
}

async function buildMaintenanceRows(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  startDate: Date,
) {
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

    const supportedReportTypes = new Set([
      'snapshot',
      'fuel',
      'trips',
      'fleet',
      'maintenance',
      'requests',
      'approvals',
    ]);
    if (!supportedReportTypes.has(reportType)) {
      return NextResponse.json(
        { error: `Unsupported report type: ${reportType}` },
        { status: 400 },
      );
    }

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
    if (exportFormat === 'pdf') {
      // PDF export — generate a formatted report PDF
      const { renderToStream } = await import('@react-pdf/renderer');
      const { ReportDocument } = await import('@/lib/pdf/report');
      const React = await import('react');

      let rows: Record<string, unknown>[] = [];
      let columns: { key: string; label: string }[] = [];
      let summary: { label: string; value: string }[] = [];
      let title = 'Report';

      switch (reportType) {
        case 'fuel': {
          const fuelData = await buildFuelRows(db, tenantId, startDate);
          rows = fuelData;
          columns = [
            { key: 'vehicle', label: 'Vehicle' },
            { key: 'date', label: 'Date' },
            { key: 'litres', label: 'Litres' },
            { key: 'amount', label: 'Amount (N$)' },
            { key: 'fuelType', label: 'Fuel Type' },
            { key: 'station', label: 'Station' },
          ];
          title = 'Fuel Consumption Report';
          const totalL = fuelData.reduce((s, r) => s + Number(r.litres || 0), 0);
          const totalA = fuelData.reduce((s, r) => s + Number(r.amount || 0), 0);
          summary = [
            { label: 'Total Litres', value: totalL.toFixed(1) },
            { label: 'Total Cost', value: `N$${totalA.toFixed(2)}` },
            { label: 'Transactions', value: String(fuelData.length) },
          ];
          break;
        }      case 'trips': {
        const tripData = await buildTripRows(db, tenantId, startDate);
        rows = tripData;
        columns = [
          { key: 'authorityNumber', label: 'Trip Authority' },
          { key: 'authorityStatus', label: 'Authority Status' },
          { key: 'status', label: 'Status' },
          { key: 'vehicle', label: 'Vehicle' },
          { key: 'origin', label: 'Origin' },
          { key: 'destination', label: 'Destination' },
          { key: 'routeKm', label: 'Route (km)' },
          { key: 'actualKm', label: 'Actual (km)' },
          { key: 'started', label: 'Started' },
          { key: 'returned', label: 'Returned' },
        ];
          title = 'Trip Summary Report';
          const totalRouteKm = tripData.reduce((s, r) => s + Number(r.routeKm || 0), 0);
          const totalActualKm = tripData.reduce((s, r) => s + Number(r.actualKm || 0), 0);
          summary = [
            { label: 'Total Trips', value: String(tripData.length) },
            { label: 'Total Route (km)', value: String(totalRouteKm) },
            { label: 'Total Actual (km)', value: String(totalActualKm) },
          ];
          break;
        }
        case 'requests': {
          const reqData = await buildRequestRows(db, tenantId, startDate);
          rows = reqData;
          columns = [
            { key: 'reference', label: 'Reference' },
            { key: 'status', label: 'Status' },
            { key: 'purpose', label: 'Purpose' },
            { key: 'scope', label: 'Scope' },
          ];
          title = 'Transport Requests Report';
          summary = [{ label: 'Total Requests', value: String(reqData.length) }];
          break;
        }
        case 'fleet': {
          const fleetData = await buildFleetRows(db, tenantId);
          rows = fleetData;
          columns = [
            { key: 'licenceNumber', label: 'Licence Number' },
            { key: 'vehicleRegisterNumber', label: 'NaTIS Register No' },
            { key: 'make', label: 'Make' },
            { key: 'model', label: 'Model' },
            { key: 'category', label: 'Category' },
            { key: 'status', label: 'Status' },
            { key: 'fuelType', label: 'Fuel' },
            { key: 'currentOdometer', label: 'Odometer (km)' },
            { key: 'licenceExpiryDate', label: 'Licence Expiry' },
            { key: 'roadworthyTestDate', label: 'Roadworthy Date' },
          ];
          title = 'Fleet Utilisation Report';
          const available = fleetData.filter((v) => v.status === 'available').length;
          const maintenance = fleetData.filter((v) => v.status === 'maintenance').length;
          summary = [
            { label: 'Total Vehicles', value: String(fleetData.length) },
            { label: 'Available', value: String(available) },
            { label: 'In Maintenance', value: String(maintenance) },
          ];
          break;
        }
        case 'maintenance': {
          const maintData = await buildMaintenanceRows(db, tenantId, startDate);
          rows = maintData;
          columns = [
            { key: 'vehicle', label: 'Vehicle' },
            { key: 'type', label: 'Type' },
            { key: 'description', label: 'Description' },
            { key: 'date', label: 'Date' },
          ];
          title = 'Maintenance Report';
          summary = [{ label: 'Total Events', value: String(maintData.length) }];
          break;
        }
        case 'approvals': {
          const approvalData = await db
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
            .where(
              and(
                eq(transportRequests.tenantId, tenantId),
                gte(workflowActions.createdAt, startDate),
              ),
            )
            .orderBy(sql`workflow_actions.created_at DESC`);
          rows = approvalData;
          columns = [
            { key: 'workflowId', label: 'Workflow' },
            { key: 'stepOrder', label: 'Step' },
            { key: 'actionType', label: 'Action' },
            { key: 'result', label: 'Result' },
          ];
          title = 'Approval Analytics Report';
          summary = [{ label: 'Total Actions', value: String(approvalData.length) }];
          break;
        }
        default:
          break;
      }

      const [tenant] = (await db
        .select({ name: sql`name` })
        .from(sql`tenants`)
        .where(eq(sql`id`, tenantId))
        .limit(1)) as unknown as { name: string }[];

      const generatedAt = new Date().toLocaleDateString('en-NA', {
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
      });
      const reportPayload = {
          title,
          period:
            period === '7d'
              ? 'Last 7 Days'
              : period === '30d'
                ? 'Last 30 Days'
                : period === '90d'
                  ? 'Last Quarter'
                  : 'Year to Date',
          tenantName: tenant?.name || 'Fleet Management',
          generatedAt,
          summary,
          columns,
          rows,
          totalRowCount: rows.length,
      };
      const documentHash = createHash('sha256').update(JSON.stringify(reportPayload)).digest('hex');
      const element = React.createElement(ReportDocument as never, {
        data: {
          ...reportPayload,
          branding: await resolveTenantDocumentBranding(tenantId),
          verificationCode: documentHash.slice(0, 8).toUpperCase(),
          documentHash,
        },
      }) as never;

      const stream = await renderToStream(
        element as unknown as React.ReactElement<Record<string, unknown>>,
      );
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream) {
        chunks.push(new Uint8Array(chunk as unknown as ArrayBuffer));
      }
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const pdfBuffer = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        pdfBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      const filename = `${reportType}-report-${period}-${new Date().toISOString().split('T')[0]}.pdf`;
      return new NextResponse(pdfBuffer as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

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
            { key: 'authorityNumber', label: 'Trip Authority' },
            { key: 'authorityStatus', label: 'Authority Status' },
            { key: 'status', label: 'Status' },
            { key: 'vehicle', label: 'Vehicle' },
            { key: 'origin', label: 'Origin' },
            { key: 'destination', label: 'Destination' },
            { key: 'routeKm', label: 'Route (km)' },
            { key: 'actualKm', label: 'Actual (km)' },
            { key: 'beginningOdometer', label: 'Beginning Odometer' },
            { key: 'endingOdometer', label: 'Ending Odometer' },
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
        case 'fleet':
          rows = await buildFleetRows(db, tenantId);
          columns = [
            { key: 'licenceNumber', label: 'Licence Number' },
            { key: 'vehicleRegisterNumber', label: 'NaTIS Register No' },
            { key: 'make', label: 'Make' },
            { key: 'model', label: 'Model' },
            { key: 'category', label: 'Category' },
            { key: 'status', label: 'Status' },
            { key: 'fuelType', label: 'Fuel' },
            { key: 'transmission', label: 'Transmission' },
            { key: 'currentOdometer', label: 'Odometer (km)' },
            { key: 'seatedCapacity', label: 'Seats' },
            { key: 'licenceExpiryDate', label: 'Licence Expiry' },
            { key: 'roadworthyTestDate', label: 'Roadworthy Date' },
            { key: 'officeName', label: 'Office' },
            { key: 'regionName', label: 'Region' },
            { key: 'createdAt', label: 'Created' },
          ];
          filename = `fleet-report-${period}-${new Date().toISOString().split('T')[0]}.csv`;
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
            .where(
              and(
                eq(transportRequests.tenantId, tenantId),
                gte(workflowActions.createdAt, startDate),
              ),
            )
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
            { key: 'authorityNumber', label: 'Trip Authority' },
            { key: 'authorityStatus', label: 'Authority Status' },
            { key: 'status', label: 'Status' },
            { key: 'vehicle', label: 'Vehicle' },
            { key: 'origin', label: 'Origin' },
            { key: 'destination', label: 'Destination' },
            { key: 'routeKm', label: 'Route (km)' },
            { key: 'actualKm', label: 'Actual (km)' },
            { key: 'beginningOdometer', label: 'Beginning Odometer' },
            { key: 'endingOdometer', label: 'Ending Odometer' },
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
        case 'fleet':
          rows = await buildFleetRows(db, tenantId);
          columns = [
            { key: 'licenceNumber', label: 'Licence Number' },
            { key: 'vehicleRegisterNumber', label: 'NaTIS Register No' },
            { key: 'make', label: 'Make' },
            { key: 'model', label: 'Model' },
            { key: 'category', label: 'Category' },
            { key: 'status', label: 'Status' },
            { key: 'fuelType', label: 'Fuel' },
            { key: 'transmission', label: 'Transmission' },
            { key: 'currentOdometer', label: 'Odometer (km)' },
            { key: 'seatedCapacity', label: 'Seats' },
            { key: 'licenceExpiryDate', label: 'Licence Expiry' },
            { key: 'roadworthyTestDate', label: 'Roadworthy Date' },
            { key: 'officeName', label: 'Office' },
            { key: 'regionName', label: 'Region' },
            { key: 'createdAt', label: 'Created' },
          ];
          sheetName = 'Fleet';
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
            .where(
              and(
                eq(transportRequests.tenantId, tenantId),
                gte(workflowActions.createdAt, startDate),
              ),
            )
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
          .select({
            totalPending: count(),
            totalAmount: sql`COALESCE(SUM(reimbursements.amount), 0)`.as('total_amount'),
          })
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

        // Route distance (mapped km) from request routes created in the period
        const [routeDistance] = await db
          .select({
            totalRouteKm:
              sql`COALESCE(SUM(${requestRoutes.totalKilometres}), 0)`.as('total_route_km'),
            routeCount: count(),
          })
          .from(requestRoutes)
          .innerJoin(transportRequests, eq(requestRoutes.requestId, transportRequests.id))
          .where(
            and(
              eq(transportRequests.tenantId, tenantId),
              gte(transportRequests.createdAt, startDate),
            ),
          );

        // Actual km driven from trip closures in the period
        const [actualDistance] = await db
          .select({
            totalActualKm:
              sql`COALESCE(SUM(${tripClosures.actualKilometres}), 0)`.as('total_actual_km'),
            closureCount: count(),
          })
          .from(tripClosures)
          .innerJoin(trips, eq(tripClosures.tripId, trips.id))
          .innerJoin(vehicles, eq(trips.vehicleId, vehicles.id))
          .where(and(eq(vehicles.tenantId, tenantId), gte(trips.createdAt, startDate)));

        return NextResponse.json({
          success: true,
          data: {
            tripStats,
            routeDistanceKm: Number(routeDistance?.totalRouteKm || 0),
            routeCount: Number(routeDistance?.routeCount || 0),
            actualDistanceKm: Number(actualDistance?.totalActualKm || 0),
            closureCount: Number(actualDistance?.closureCount || 0),
          },
        });
      }

      case 'requests': {
        const requestStats = await db
          .select({ totalRequests: count(), status: transportRequests.status })
          .from(transportRequests)
          .where(
            and(
              eq(transportRequests.tenantId, tenantId),
              gte(transportRequests.createdAt, startDate),
            ),
          )
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
          .where(
            and(
              eq(transportRequests.tenantId, tenantId),
              gte(workflowActions.createdAt, startDate),
            ),
          );

        // Approval rate by result type
        const approvalRate = await db
          .select({
            result: workflowActions.result,
            count: count(),
          })
          .from(workflowActions)
          .innerJoin(workflowInstances, eq(workflowActions.instanceId, workflowInstances.id))
          .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
          .where(
            and(
              eq(transportRequests.tenantId, tenantId),
              gte(workflowActions.createdAt, startDate),
            ),
          )
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
          .where(
            and(
              eq(transportRequests.tenantId, tenantId),
              gte(workflowActions.createdAt, startDate),
            ),
          )
          .groupBy(workflowActions.stepOrder)
          .orderBy(workflowActions.stepOrder);

        // Unique workflows affected
        const [workflowCount] = await db
          .select({ count: count() })
          .from(workflowInstances)
          .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
          .where(
            and(
              eq(transportRequests.tenantId, tenantId),
              gte(workflowInstances.createdAt, startDate),
            ),
          );

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
          .where(
            and(
              eq(transportRequests.tenantId, tenantId),
              sql`${transportRequests.status} NOT IN ('closed', 'cancelled')`,
            ),
          );

        const [activeTrips] = await db
          .select({ count: count() })
          .from(trips)
          .innerJoin(vehicles, eq(trips.vehicleId, vehicles.id))
          .where(
            and(
              eq(vehicles.tenantId, tenantId),
              sql`${trips.status} IN ('pending', 'in_progress')`,
            ),
          );

        const [openDefects] = await db
          .select({ count: count() })
          .from(vehicles)
          .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.status, 'maintenance')));

        return NextResponse.json({
          success: true,
          data: {
            activeRequests: activeRequests?.count || 0,
            activeTrips: activeTrips?.count || 0,
            openDefects: openDefects?.count || 0,
          },
        });
      }
    }
  } catch (error) {
    console.error('Reports API failed:', error);
    return NextResponse.json(
      { error: 'Failed to generate report: ' + String(error) },
      { status: 500 },
    );
  }
}
