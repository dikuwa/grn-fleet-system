/**
 * Document Generator
 *
 * Produces snapshot documents (transport_requests, trip_authority,
 * vehicle_allocation, etc.) from DB data at key lifecycle events.
 *
 * Each generated document is stored in `generatedDocuments` with its
 * entityType/entityId linking it to the source record. Documents move
 * through statuses: draft → issued → superseded.
 */

import { getDb } from '@/db';
import { createHash, randomUUID } from 'node:crypto';
import { generatedDocuments } from '@/db/schema/documents';
import {
  trips,
  fuelTransactions,
  reimbursements,
  vehicleInspections,
  tripClosures,
  tripIncidents,
  tripAuthorities,
} from '@/db/schema/trips';
import { validateDocumentSnapshot, hasSchema } from '@/lib/document-validation';
import {
  transportRequests,
  requestActivities,
  requestDrivers,
  requestPassengers,
  requestRoutes,
  requestAttachments,
  requestGoodsEquipment,
} from '@/db/schema/requests';
import { auditEvents } from '@/db/schema/audit';
import { vehicleAllocations } from '@/db/schema/trips';
import { vehicles, maintenanceEvents } from '@/db/schema/fleet';
import { departments, employees, offices } from '@/db/schema/people';
import { workflowActions, workflowInstances } from '@/db/schema/workflows';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { resolveTenantDocumentBranding } from '@/lib/tenant-branding';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DocumentType =
  | 'transport_request'
  | 'trip_authority'
  | 'vehicle_allocation'
  | 'fuel_summary'
  | 'inspection_report'
  | 'trip_completion'
  | 'trip_incident_report'
  | 'accident_report'
  | 'maintenance_report'
  | 'vehicle_history'
  | 'audit_report';

interface DocumentPayload {
  documentType: DocumentType;
  entityType: string;
  entityId: string;
  tenantId: string;
  generatedByUserId: string;
  snapshotData?: Record<string, unknown>;
  templateVersion?: string;
}

// ---------------------------------------------------------------------------
// Snapshot builders
// ---------------------------------------------------------------------------

async function buildTransportRequestSnapshot(requestId: string) {
  const db = getDb();
  const [req] = await db
    .select()
    .from(transportRequests)
    .where(eq(transportRequests.id, requestId))
    .limit(1);
  if (!req) return null;

  const [requester, routes, passengers, drivers, attachments, goods, workflow] = await Promise.all([
    db.select({
      firstName: employees.firstName,
      lastName: employees.lastName,
      employeeNumber: employees.employeeNumber,
      departmentName: departments.name,
      officeName: offices.name,
      phone: employees.phone,
      email: employees.email,
    })
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(offices, eq(offices.id, employees.officeId))
      .where(eq(employees.id, req.requesterEmployeeId))
      .limit(1),
    db.select().from(requestRoutes).where(eq(requestRoutes.requestId, requestId)).orderBy(requestRoutes.sequence),
    db.select({
      passenger: requestPassengers,
      firstName: employees.firstName,
      lastName: employees.lastName,
      employeeNumber: employees.employeeNumber,
    }).from(requestPassengers)
      .leftJoin(employees, eq(employees.id, requestPassengers.employeeId))
      .where(eq(requestPassengers.requestId, requestId)),
    db.select({
      driver: requestDrivers,
      firstName: employees.firstName,
      lastName: employees.lastName,
      employeeNumber: employees.employeeNumber,
    }).from(requestDrivers)
      .leftJoin(employees, eq(employees.id, requestDrivers.employeeId))
      .where(eq(requestDrivers.requestId, requestId)),
    db.select().from(requestAttachments).where(eq(requestAttachments.requestId, requestId)),
    db.select().from(requestGoodsEquipment).where(eq(requestGoodsEquipment.requestId, requestId)).orderBy(requestGoodsEquipment.createdAt),
    db.select({
      instance: workflowInstances,
      action: workflowActions,
    }).from(workflowInstances)
      .leftJoin(workflowActions, eq(workflowActions.instanceId, workflowInstances.id))
      .where(eq(workflowInstances.requestId, requestId))
      .orderBy(workflowActions.createdAt),
  ]);

  return {
    request: req,
    requester: requester[0] || null,
    routes,
    passengers: passengers.map((p) => ({
      ...p.passenger,
      firstName: p.firstName,
      lastName: p.lastName,
      employeeNumber: p.employeeNumber,
    })),
    drivers: drivers.map((d) => ({
      ...d.driver,
      firstName: d.firstName,
      lastName: d.lastName,
      employeeNumber: d.employeeNumber,
    })),
    attachments,
    goodsEquipment: goods,
    workflow,
  };
}

async function buildTripAuthoritySnapshot(allocationId: string) {
  const db = getDb();

  const [authority] = await db
    .select()
    .from(tripAuthorities)
    .where(eq(tripAuthorities.allocationId, allocationId))
    .limit(1);
  if (!authority) return null;

  const [trip] = await db.select().from(trips).where(eq(trips.id, authority.tripId)).limit(1);
  if (!trip) return null;

  const [request] = await db
    .select()
    .from(transportRequests)
    .where(eq(transportRequests.id, trip.requestId))
    .limit(1);

  const [allocation] = await db
    .select()
    .from(vehicleAllocations)
    .where(eq(vehicleAllocations.id, allocationId))
    .limit(1);

  const [vehicle] = allocation
    ? await db.select().from(vehicles).where(eq(vehicles.id, allocation.vehicleId)).limit(1)
    : [null];

  const [requester, routes, passengers, drivers] = request
    ? await Promise.all([
        db.select({
          firstName: employees.firstName,
          lastName: employees.lastName,
          employeeNumber: employees.employeeNumber,
          departmentName: departments.name,
          officeName: offices.name,
          phone: employees.phone,
          email: employees.email,
        }).from(employees)
          .leftJoin(departments, eq(departments.id, employees.departmentId))
          .leftJoin(offices, eq(offices.id, employees.officeId))
          .where(eq(employees.id, request.requesterEmployeeId))
          .limit(1),
        db.select().from(requestRoutes).where(eq(requestRoutes.requestId, request.id)).orderBy(requestRoutes.sequence),
        db.select({
          passenger: requestPassengers,
          firstName: employees.firstName,
          lastName: employees.lastName,
          employeeNumber: employees.employeeNumber,
        }).from(requestPassengers)
          .leftJoin(employees, eq(employees.id, requestPassengers.employeeId))
          .where(eq(requestPassengers.requestId, request.id)),
        db.select({
          driver: requestDrivers,
          firstName: employees.firstName,
          lastName: employees.lastName,
          employeeNumber: employees.employeeNumber,
        }).from(requestDrivers)
          .leftJoin(employees, eq(employees.id, requestDrivers.employeeId))
          .where(eq(requestDrivers.requestId, request.id)),
      ])
    : [[], [], [], []];

  return {
    authority,
    trip,
    request,
    allocation,
    vehicle,
    requester: requester[0] || null,
    routes,
    passengers: passengers.map((p) => ({
      ...p.passenger,
      firstName: p.firstName,
      lastName: p.lastName,
      employeeNumber: p.employeeNumber,
    })),
    drivers: drivers.map((d) => ({
      ...d.driver,
      firstName: d.firstName,
      lastName: d.lastName,
      employeeNumber: d.employeeNumber,
    })),
  };
}

async function buildVehicleAllocationSnapshot(allocationId: string) {
  const db = getDb();
  const [allocation] = await db
    .select()
    .from(vehicleAllocations)
    .where(eq(vehicleAllocations.id, allocationId))
    .limit(1);
  if (!allocation) return null;

  const [vehicle, request] = await Promise.all([
    db.select().from(vehicles).where(eq(vehicles.id, allocation.vehicleId)).limit(1),
    db.select().from(transportRequests).where(eq(transportRequests.id, allocation.requestId)).limit(1),
  ]);

  return {
    allocation,
    vehicle: vehicle[0] || null,
    request: request[0] || null,
  };
}

async function buildInspectionReportSnapshot(inspectionId: string) {
  const db = getDb();
  const [inspection] = await db
    .select()
    .from(vehicleInspections)
    .where(eq(vehicleInspections.id, inspectionId))
    .limit(1);
  if (!inspection) return null;

  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, inspection.vehicleId)).limit(1);

  return {
    inspection,
    vehicle: vehicle || null,
  };
}

async function buildFuelSummarySnapshot(tripId: string) {
  const db = getDb();

  const transactions = await db
    .select()
    .from(fuelTransactions)
    .where(eq(fuelTransactions.tripId, tripId));

  const totalLitres = transactions.reduce((sum, t) => sum + Number(t.litres), 0);
  const totalCost = transactions.reduce((sum, t) => sum + Number(t.amount), 0);

  let pendingReimbursements = 0;
  if (transactions.length > 0) {
    const txIds = transactions.map((t) => t.id);
    const rb = await db
      .select()
      .from(reimbursements)
      .where(inArray(reimbursements.transactionId, txIds));
    pendingReimbursements = rb.filter((r) => r.state === 'pending' || r.state === 'approved').length;
  }

  const [closure] = await db
    .select()
    .from(tripClosures)
    .where(eq(tripClosures.tripId, tripId))
    .limit(1);

  return {
    tripId,
    totalLitres: Number(totalLitres.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2)),
    transactionCount: transactions.length,
    pendingReimbursements,
    actualKilometres: closure?.actualKilometres || null,
    kilometreVariance: closure?.kilometreVariance || null,
  };
}

async function buildVehicleHistorySnapshot(vehicleId: string) {
  const db = getDb();

  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  if (!vehicle) return null;

  const maintenance = await db
    .select()
    .from(maintenanceEvents)
    .where(eq(maintenanceEvents.vehicleId, vehicleId))
    .orderBy(desc(maintenanceEvents.serviceDate));

  const fuel = await db
    .select()
    .from(fuelTransactions)
    .where(eq(fuelTransactions.vehicleId, vehicleId))
    .orderBy(desc(fuelTransactions.createdAt));

  const inspections = await db
    .select()
    .from(vehicleInspections)
    .where(eq(vehicleInspections.vehicleId, vehicleId))
    .orderBy(desc(vehicleInspections.createdAt));

  const tripData = await db
    .select({
      id: trips.id,
      status: trips.status,
      issuedAt: trips.issuedAt,
      startedAt: trips.startedAt,
      returnedAt: trips.returnedAt,
      closedAt: trips.closedAt,
    })
    .from(trips)
    .where(eq(trips.vehicleId, vehicleId))
    .orderBy(desc(trips.createdAt));

  const totalMaintenanceCost = maintenance.reduce(
    (sum, e) => sum + (e.cost ? Number(e.cost) : 0),
    0,
  );
  const totalFuelLitres = fuel.reduce((sum, f) => sum + Number(f.litres), 0);
  const totalFuelCost = fuel.reduce((sum, f) => sum + Number(f.amount), 0);
  const totalTripCount = tripData.length;

  return {
    vehicleId: vehicle.id,
    licenceNumber: vehicle.licenceNumber,
    vehicleRegisterNumber: vehicle.vehicleRegisterNumber,
    make: vehicle.make,
    model: vehicle.model,
    vin: vehicle.vin,
    manufactureYear: vehicle.manufactureYear,
    colour: vehicle.colour,
    fuelType: vehicle.fuelType,
    status: vehicle.status,
    currentOdometer: vehicle.currentOdometer,
    totalTripCount,
    totalMaintenanceCost: Number(totalMaintenanceCost.toFixed(2)),
    totalMaintenanceEvents: maintenance.length,
    totalFuelLitres: Number(totalFuelLitres.toFixed(1)),
    totalFuelCost: Number(totalFuelCost.toFixed(2)),
    totalInspections: inspections.length,
    generatedAt: new Date().toISOString(),
    maintenance: maintenance.map((e) => ({
      date: e.serviceDate,
      type: e.serviceType,
      description: e.description,
      cost: e.cost ? Number(e.cost) : null,
      vendor: e.vendorName,
    })),
    fuel: fuel.map((f) => ({
      date: f.createdAt.toISOString(),
      litres: Number(f.litres),
      amount: Number(f.amount),
      fuelType: f.fuelType,
      station: f.stationName,
    })),
    inspections: inspections.map((i) => ({
      id: i.id,
      type: i.type,
      status: i.status,
      overallPass: i.overallPass,
      odometer: i.odometerReading,
      date: i.createdAt.toISOString(),
    })),
    trips: tripData.map((t) => ({
      id: t.id,
      status: t.status,
      issuedAt: t.issuedAt?.toISOString(),
      startedAt: t.startedAt?.toISOString(),
      returnedAt: t.returnedAt?.toISOString(),
      closedAt: t.closedAt?.toISOString(),
    })),
  };
}

async function buildMaintenanceReportSnapshot(vehicleId: string) {
  const db = getDb();
  const events = await db
    .select()
    .from(maintenanceEvents)
    .where(eq(maintenanceEvents.vehicleId, vehicleId))
    .orderBy(desc(maintenanceEvents.serviceDate));

  if (events.length === 0) return null;

  const totalCost = events.reduce((sum, e) => sum + (e.cost ? Number(e.cost) : 0), 0);
  const nextService = events.find(
    (e) => e.nextServiceDate && new Date(e.nextServiceDate) > new Date(),
  );

  const [vehicle] = await db
    .select({ licenceNumber: vehicles.licenceNumber, make: vehicles.make, model: vehicles.model })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .limit(1);

  return {
    vehicleId,
    vehicle: vehicle ? `${vehicle.make} ${vehicle.model} (${vehicle.licenceNumber})` : 'Unknown',
    totalEvents: events.length,
    totalCost: Number(totalCost.toFixed(2)),
    nextServiceDate: nextService?.nextServiceDate || null,
    nextServiceOdometer: nextService?.nextServiceOdometer || null,
    events: events.map((e) => ({
      date: e.serviceDate,
      type: e.serviceType,
      description: e.description,
      cost: e.cost ? Number(e.cost) : null,
      vendor: e.vendorName,
      odometer: e.serviceOdometer,
    })),
  };
}

async function buildAuditReportSnapshot(tenantId: string) {
  const db = getDb();
  const events = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.tenantId, tenantId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(100);

  return {
    tenantId,
    totalEvents: events.length,
    period: 'Last 100 events',
    eventTypes: [...new Set(events.map((e) => e.eventType))],
    generatedAt: new Date().toISOString(),
    events: events.map((e) => ({
      type: e.eventType,
      action: e.action,
      entityType: e.entityType,
      summary: e.summary,
      timestamp: e.createdAt.toISOString(),
      actor: e.actorUserId,
    })),
  };
}

async function buildTripCompletionSnapshot(tripId: string) {
  const db = getDb();

  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
  if (!trip) return null;

  const [closure] = await db
    .select()
    .from(tripClosures)
    .where(eq(tripClosures.tripId, tripId))
    .limit(1);

  const fuelSummary = await buildFuelSummarySnapshot(tripId);
  const incidents = await db
    .select()
    .from(tripIncidents)
    .where(and(eq(tripIncidents.tripId, tripId), eq(tripIncidents.tenantId, trip.tenantId)))
    .orderBy(tripIncidents.occurredAt);

  const [vehicle] = await db
    .select({
      licenceNumber: vehicles.licenceNumber,
      vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
    })
    .from(vehicles)
    .where(and(eq(vehicles.id, trip.vehicleId), eq(vehicles.tenantId, trip.tenantId)))
    .limit(1);

  return {
    tripId,
    status: trip.status,
    closedAt: trip.closedAt?.toISOString() || null,
    actualKilometres: closure?.actualKilometres || null,
    kilometreVariance: closure?.kilometreVariance || null,
    totalFuelLitres: fuelSummary?.totalLitres ?? 0,
    totalFuelCost: fuelSummary?.totalCost ?? 0,
    pendingReimbursements: fuelSummary?.pendingReimbursements ?? 0,
    vehicle: vehicle
      ? {
          licenceNumber: vehicle.licenceNumber,
          vehicleRegisterNumber: vehicle.vehicleRegisterNumber,
        }
      : null,
    incidents: incidents.map((incident) => ({
      id: incident.id,
      category: incident.category,
      occurredAt: incident.occurredAt.toISOString(),
      status: incident.status,
      safeToContinue: incident.safeToContinue,
      severity: incident.severity,
    })),
  };
}

async function buildTripIncidentSnapshot(incidentId: string) {
  const db = getDb();
  const [incident] = await db
    .select()
    .from(tripIncidents)
    .where(eq(tripIncidents.id, incidentId))
    .limit(1);
  if (!incident) return null;

  const [trip] = await db
    .select({ id: trips.id, status: trips.status })
    .from(trips)
    .where(and(eq(trips.id, incident.tripId), eq(trips.tenantId, incident.tenantId)))
    .limit(1);

  const [vehicle] = await db
    .select({
      licenceNumber: vehicles.licenceNumber,
      vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
      make: vehicles.make,
      model: vehicles.model,
    })
    .from(vehicles)
    .where(and(eq(vehicles.id, incident.vehicleId), eq(vehicles.tenantId, incident.tenantId)))
    .limit(1);

  return {
    incident,
    trip: trip || null,
    vehicle: vehicle || null,
  };
}

async function buildAccidentReportSnapshot(incidentId: string) {
  const snapshot = await buildTripIncidentSnapshot(incidentId);
  if (!snapshot) return null;

  return {
    ...snapshot,
    reportKind: 'mva_accident',
  };
}

// ---------------------------------------------------------------------------
// Core generation
// ---------------------------------------------------------------------------

export async function generateDocument(payload: DocumentPayload) {
  const db = getDb();

  const { documentType, entityType, entityId, tenantId, generatedByUserId, templateVersion = '1.0' } = payload;
  let snapshotData = payload.snapshotData;

  if (!snapshotData) {
    switch (documentType) {
      case 'transport_request':
        snapshotData = (await buildTransportRequestSnapshot(entityId)) as Record<string, unknown>;
        break;
      case 'trip_authority':
        snapshotData = (await buildTripAuthoritySnapshot(entityId)) as Record<string, unknown>;
        break;
      case 'vehicle_allocation':
        snapshotData = (await buildVehicleAllocationSnapshot(entityId)) as Record<string, unknown>;
        break;
      case 'fuel_summary':
        snapshotData = (await buildFuelSummarySnapshot(entityId)) as Record<string, unknown>;
        break;
      case 'inspection_report':
        snapshotData = (await buildInspectionReportSnapshot(entityId)) as Record<string, unknown>;
        break;
      case 'trip_completion':
        snapshotData = (await buildTripCompletionSnapshot(entityId)) as Record<string, unknown>;
        break;
      case 'trip_incident_report':
        snapshotData = (await buildTripIncidentSnapshot(entityId)) as Record<string, unknown>;
        break;
      case 'accident_report':
        snapshotData = (await buildAccidentReportSnapshot(entityId)) as Record<string, unknown>;
        break;
      case 'maintenance_report':
        snapshotData = (await buildMaintenanceReportSnapshot(entityId)) as Record<string, unknown>;
        break;
      case 'vehicle_history':
        snapshotData = (await buildVehicleHistorySnapshot(entityId)) as Record<string, unknown>;
        break;
      case 'audit_report':
        snapshotData = (await buildAuditReportSnapshot(tenantId)) as Record<string, unknown>;
        break;
    }
  }

  if (!snapshotData) {
    throw new Error(`Unable to build snapshot for ${documentType}:${entityId}`);
  }

  const template = templateVersion || '1.0';
  const branding = await resolveTenantDocumentBranding(tenantId);
  const preparedAt = new Date();
  const snapshot = {
    ...snapshotData,
    branding,
    documentIdentity: {
      preparedAt: preparedAt.toISOString(),
    },
  };
  const snapshotHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

  if (hasSchema(documentType)) {
    const validation = validateDocumentSnapshot(documentType, snapshot);
    if (!validation.success) {
      console.warn(
        `[document-generator] Snapshot validation warnings for ${documentType}:`,
        validation.errors,
      );
    }
  }

  const id = randomUUID();
  return {
    id,
    tenantId,
    documentType,
    entityType,
    entityId,
    templateVersion: template,
    status: 'draft' as const,
    snapshotData: snapshot,
    snapshotHash,
    generatedByUserId,
    createdAt: preparedAt,
    updatedAt: preparedAt,
  };
}
