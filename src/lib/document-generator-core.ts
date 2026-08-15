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
import { runAtomicMutations } from '@/lib/db-atomic';

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

  const activities = await db
    .select()
    .from(requestActivities)
    .where(eq(requestActivities.requestId, requestId));

  const [requester] = await db
    .select({
      name: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.middleName}, ${employees.lastName})`,
      employeeNumber: employees.employeeNumber,
      designation: employees.jobTitle,
      phone: employees.phone,
      email: employees.email,
      department: departments.name,
      office: offices.name,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(offices, eq(offices.id, employees.officeId))
    .where(eq(employees.id, req.requesterEmployeeId))
    .limit(1);
  const [drivers, passengers, routes, attachments, goodsAndEquipment, approvals] =
    await Promise.all([
      db
        .select({
          driverType: requestDrivers.driverType,
          sortOrder: requestDrivers.sortOrder,
          name: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.lastName})`,
          employeeNumber: employees.employeeNumber,
          department: departments.name,
        })
        .from(requestDrivers)
        .innerJoin(employees, eq(employees.id, requestDrivers.employeeId))
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .where(eq(requestDrivers.requestId, requestId)),
      db
        .select({
          employeeId: requestPassengers.employeeId,
          externalName: requestPassengers.externalName,
          externalOrganisation: requestPassengers.externalOrganisation,
          travellerRole: requestPassengers.travellerRole,
          reasonForTravel: requestPassengers.reasonForTravel,
          employeeName: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.lastName})`,
          employeeNumber: employees.employeeNumber,
          department: departments.name,
        })
        .from(requestPassengers)
        .leftJoin(employees, eq(employees.id, requestPassengers.employeeId))
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .where(eq(requestPassengers.requestId, requestId)),
      db.select().from(requestRoutes).where(eq(requestRoutes.requestId, requestId)),
      db
        .select({ fileName: requestAttachments.fileName, mimeType: requestAttachments.mimeType })
        .from(requestAttachments)
        .where(eq(requestAttachments.requestId, requestId)),
      db
        .select({
          description: requestGoodsEquipment.description,
          quantity: requestGoodsEquipment.quantity,
          purpose: requestGoodsEquipment.purpose,
        })
        .from(requestGoodsEquipment)
        .where(eq(requestGoodsEquipment.requestId, requestId))
        .orderBy(requestGoodsEquipment.sortOrder),
      db
        .select({
          stage: workflowActions.stepOrder,
          action: workflowActions.actionType,
          decision: workflowActions.result,
          officer: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.lastName})`,
          comment: workflowActions.comment,
          dateTime: workflowActions.createdAt,
          signed: sql<boolean>`${workflowActions.signatureRef} is not null`,
        })
        .from(workflowActions)
        .innerJoin(workflowInstances, eq(workflowInstances.id, workflowActions.instanceId))
        .leftJoin(employees, eq(employees.id, workflowActions.actorEmployeeId))
        .where(eq(workflowInstances.requestId, requestId)),
    ]);

  return {
    id: req.id,
    reference: req.reference,
    revision: req.revision,
    scope: req.scope,
    status: req.status,
    department: req.department,
    purpose: req.purpose,
    requester: {
      name: requester?.name || 'Unknown',
      employeeNumber: requester?.employeeNumber,
      designation: requester?.designation,
      department: requester?.department || req.department,
      office: requester?.office,
      phone: requester?.phone,
      email: requester?.email,
    },
    totalAuthorisedKilometres: req.totalAuthorisedKilometres,
    specialAuthorityRequired: req.specialAuthorityRequired,
    submittedAt: req.submittedAt?.toISOString(),
    activities: activities.map((a) => ({
      title: a.title,
      description: a.description,
      venue: a.venue,
      startDate: a.startDate.toISOString(),
      endDate: a.endDate.toISOString(),
      estimatedKilometres: a.estimatedKilometres,
    })),
    passengers: passengers.map((passenger) => ({
      name: passenger.employeeId ? passenger.employeeName : passenger.externalName,
      employeeNumber: passenger.employeeNumber,
      departmentOrOrganisation: passenger.employeeId
        ? passenger.department
        : passenger.externalOrganisation,
      role: passenger.travellerRole,
      travellerType: passenger.employeeId ? 'Employee' : 'External traveller',
      reasonForTravel: passenger.reasonForTravel,
    })),
    travellerCount: passengers.length + 1,
    drivers,
    routes: routes.map((route) => ({
      origin: route.originName,
      destination: route.destinationName,
      estimatedKilometres: route.totalKilometres || route.mappedDistanceKm,
      estimatedDurationMinutes: route.mappedDurationMinutes,
    })),
    attachments,
    goodsAndEquipment,
    approvalWorkflow: approvals.map((approval) => ({
      stage: approval.stage,
      action: approval.action,
      officer: approval.officer || 'Officer not recorded',
      decision: approval.decision,
      dateTime: approval.dateTime.toISOString(),
      comment: approval.comment,
      signature: approval.signed ? 'Digitally signed' : 'No signature applied',
    })),
  };
}

async function buildTripAuthoritySnapshot(allocationId: string) {
  const db = getDb();
  const [alloc] = await db
    .select()
    .from(vehicleAllocations)
    .where(eq(vehicleAllocations.id, allocationId))
    .limit(1);
  if (!alloc) return null;

  const [req] = await db
    .select()
    .from(transportRequests)
    .where(eq(transportRequests.id, alloc.requestId))
    .limit(1);

  const [vehicle] = await db
    .select({
      licenceNumber: vehicles.licenceNumber,
      make: vehicles.make,
      model: vehicles.model,
      vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
    })
    .from(vehicles)
    .where(eq(vehicles.id, alloc.vehicleId))
    .limit(1);

  return {
    allocationId: alloc.id,
    requestReference: req?.reference || 'N/A',
    scope: req?.scope || 'regional',
    vehicle: {
      licenceNumber: vehicle?.licenceNumber || 'N/A',
      vehicleRegisterNumber: vehicle?.vehicleRegisterNumber || 'N/A',
      make: vehicle?.make || '',
      model: vehicle?.model || '',
    },
    startAt: alloc.startAt.toISOString(),
    endAt: alloc.endAt.toISOString(),
    state: alloc.state,
    allocatedByUserId: alloc.allocatedByUserId,
  };
}

async function buildInspectionReportSnapshot(inspectionId: string) {
  const db = getDb();
  const [insp] = await db
    .select()
    .from(vehicleInspections)
    .where(eq(vehicleInspections.id, inspectionId))
    .limit(1);
  if (!insp) return null;

  const [vehicle] = await db
    .select({
      licenceNumber: vehicles.licenceNumber,
      vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
    })
    .from(vehicles)
    .where(eq(vehicles.id, insp.vehicleId))
    .limit(1);

  return {
    inspectionId: insp.id,
    type: insp.type,
    vehicle: {
      licenceNumber: vehicle?.licenceNumber || 'N/A',
      registrationNumber: vehicle?.vehicleRegisterNumber || 'N/A',
    },
    odometerReading: insp.odometerReading,
    fuelLevel: insp.fuelLevel,
    overallPass: insp.overallPass,
    status: insp.status,
    notes: insp.notes,
    inspectedAt: insp.createdAt.toISOString(),
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

  // Find all reimbursements linked to this trip's transactions
  let pendingReimbursements = 0;
  if (transactions.length > 0) {
    const txIds = transactions.map((t) => t.id);
    const rb = await db
      .select()
      .from(reimbursements)
      .where(inArray(reimbursements.transactionId, txIds));
    pendingReimbursements = rb.filter((r) => r.state === 'pending').length;
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

  // All maintenance events
  const maintenance = await db
    .select()
    .from(maintenanceEvents)
    .where(eq(maintenanceEvents.vehicleId, vehicleId))
    .orderBy(desc(maintenanceEvents.serviceDate));

  // All fuel transactions
  const fuel = await db
    .select()
    .from(fuelTransactions)
    .where(eq(fuelTransactions.vehicleId, vehicleId))
    .orderBy(desc(fuelTransactions.createdAt));

  // All inspections
  const inspections = await db
    .select()
    .from(vehicleInspections)
    .where(eq(vehicleInspections.vehicleId, vehicleId))
    .orderBy(desc(vehicleInspections.createdAt));

  // All trips
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
    .where(eq(vehicles.id, trip.vehicleId))
    .limit(1);

  // Planned route distance from the linked request's mapped routes
  let routeKm: number | null = null;
  if (trip.requestId) {
    const routeRows = await db
      .select()
      .from(requestRoutes)
      .where(eq(requestRoutes.requestId, trip.requestId));
    if (routeRows.length > 0) {
      routeKm = Math.round(
        routeRows.reduce((s, r) => s + (r.totalKilometres ?? r.mappedDistanceKm ?? 0), 0),
      );
    }
  }

  return {
    tripId: trip.id,
    status: trip.status,
    vehicle: {
      licenceNumber: vehicle?.licenceNumber || 'N/A',
      registrationNumber: vehicle?.vehicleRegisterNumber || 'N/A',
    },
    issuedAt: trip.issuedAt?.toISOString(),
    startedAt: trip.startedAt?.toISOString(),
    returnedAt: trip.returnedAt?.toISOString(),
    closedAt: trip.closedAt?.toISOString(),
    routeKm,
    closure: closure
      ? {
          authorisedKm: closure.authorisedKilometres,
          actualKm: closure.actualKilometres,
          variance: closure.kilometreVariance,
          decision: closure.decision,
          notes: closure.reviewNotes,
        }
      : null,
    fuelSummary,
    eventSummary: {
      total: incidents.length,
      incidents: incidents.filter(
        (event) =>
          ![
            'mechanical_defect',
            'electrical_defect',
            'vehicle_defect',
            'tyre_failure',
            'tyre_damage',
          ].includes(event.incidentType),
      ).length,
      defects: incidents.filter((event) =>
        [
          'mechanical_defect',
          'electrical_defect',
          'vehicle_defect',
          'tyre_failure',
          'tyre_damage',
        ].includes(event.incidentType),
      ).length,
      accidents: incidents.filter((event) =>
        ['accident', 'accident_collision'].includes(event.incidentType),
      ).length,
      injuries: incidents.reduce((sum, event) => sum + event.numberInjured, 0),
      critical: incidents.filter((event) => event.severity === 'critical').length,
      events: incidents.map((event) => ({
        number: event.officialNumber,
        type: event.incidentType,
        severity: event.severity,
        occurredAt: event.occurredAt.toISOString(),
        continuationState: event.continuationState,
        status: event.status,
        policeReference: event.policeReference,
        description: event.description,
      })),
    },
  };
}

async function buildTripIncidentSnapshot(incidentId: string) {
  const db = getDb();
  const [record] = await db
    .select({
      incident: tripIncidents,
      requestReference: transportRequests.reference,
      authorityNumber: tripAuthorities.authorityNumber,
      vehicleRegistration: vehicles.licenceNumber,
      vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
      vehicleMake: vehicles.make,
      vehicleModel: vehicles.model,
    })
    .from(tripIncidents)
    .innerJoin(trips, eq(trips.id, tripIncidents.tripId))
    .innerJoin(transportRequests, eq(transportRequests.id, trips.requestId))
    .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
    .leftJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
    .where(and(eq(tripIncidents.id, incidentId), eq(tripIncidents.tenantId, trips.tenantId)))
    .limit(1);
  if (!record) return null;
  const event = record.incident;
  return {
    reference: event.officialNumber,
    eventType: event.incidentType,
    severity: event.severity,
    status: event.status,
    occurredAt: event.occurredAt.toISOString(),
    location: event.location,
    origin: event.origin,
    destination: event.destination,
    odometerReading: event.odometerReading,
    description: event.description,
    immediateAction: event.actionTaken,
    continuationState: event.continuationState,
    vehicleSafe: event.vehicleSafe,
    passengerSafe: event.passengerSafe,
    injuries: event.injuries,
    numberInjured: event.numberInjured,
    vehicleDamage: event.vehicleDamage,
    thirdPartyInvolvement: event.thirdPartyInvolvement,
    thirdPartyDetails: event.thirdPartyDetails,
    policeReference: event.policeReference,
    emergencyServicesContacted: event.emergencyServicesContacted,
    detailsRequired: event.detailsRequired,
    // MVA report fields
    accidentReportNumber: event.accidentReportNumber,
    investigationStatus: event.investigationStatus,
    investigationNotes: event.investigationNotes,
    investigationClosedAt: event.investigationClosedAt?.toISOString(),
    insuranceClaimReference: event.insuranceClaimReference,
    insuranceNotified: event.insuranceNotified,
    insuranceNotifiedAt: event.insuranceNotifiedAt?.toISOString(),
    policeReportFiled: event.policeReportFiled,
    thirdPartyInsuranceDetails: event.thirdPartyInsuranceDetails,
    witnessStatements: event.witnessStatements,
    technicalClearanceStatus: event.technicalClearanceStatus,
    technicalClearanceAt: event.technicalClearanceAt?.toISOString(),
    technicalClearanceByUserId: event.technicalClearanceByUserId,
    tripReferences: {
      transportRequest: record.requestReference,
      tripAuthority: record.authorityNumber,
    },
    vehicle: {
      registration: record.vehicleRegistration,
      registerNumber: record.vehicleRegisterNumber,
      make: record.vehicleMake,
      model: record.vehicleModel,
    },
    attachments: event.attachmentKeys || [],
    offlineCreatedAt: event.offlineCreatedAt?.toISOString(),
    serverRecordedAt: event.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Snapshot dispatch (by entity type + action)
// ---------------------------------------------------------------------------

const BUILDERS: Record<string, (id: string) => Promise<Record<string, unknown> | null>> = {
  transport_request: buildTransportRequestSnapshot,
  trip: buildTripCompletionSnapshot,
  vehicle_allocation: buildTripAuthoritySnapshot,
  inspection: buildInspectionReportSnapshot,
  maintenance: buildMaintenanceReportSnapshot,
  vehicle: buildVehicleHistorySnapshot,
  tenant: buildAuditReportSnapshot,
  trip_incident: buildTripIncidentSnapshot,
};
const DOCUMENT_BUILDERS: Partial<
  Record<DocumentType, (id: string) => Promise<Record<string, unknown> | null>>
> = {
  fuel_summary: buildFuelSummarySnapshot,
};

/**
 * Generate a document snapshot for a given entity.
 *
 * The latest-version lookup is tenant-scoped and the previous-issued supersede
 * plus new-version insert are committed atomically. A concurrent duplicate
 * version therefore fails as one unit at the database uniqueness backstop and
 * cannot leave the previous official version superseded by itself.
 */
export async function generateDocument(
  payload: DocumentPayload,
): Promise<typeof generatedDocuments.$inferSelect | null> {
  const { documentType, entityType, entityId, tenantId, generatedByUserId, templateVersion } =
    payload;

  const builder = DOCUMENT_BUILDERS[documentType] || BUILDERS[entityType];
  if (!builder) {
    console.warn(`[DocGen] No builder for entity type: ${entityType}`);
    return null;
  }

  const sourceSnapshot = await builder(entityId);
  if (!sourceSnapshot) {
    console.warn(`[DocGen] No data found for ${entityType}: ${entityId}`);
    return null;
  }

  const branding = await resolveTenantDocumentBranding(tenantId);
  const db = getDb();

  const [existing] = await db
    .select()
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.tenantId, tenantId),
        eq(generatedDocuments.entityType, entityType),
        eq(generatedDocuments.entityId, entityId),
        eq(generatedDocuments.documentType, documentType),
      ),
    )
    .orderBy(desc(generatedDocuments.documentVersion))
    .limit(1);

  const newVersion = existing ? existing.documentVersion + 1 : 1;
  const snapshotData = {
    ...sourceSnapshot,
    documentIdentity: {
      organisationName: branding?.organisationName,
      logoUrl: branding?.logoUrl,
      primaryColor: branding?.primaryColor,
      accentColor: branding?.accentColor,
      executiveSignatoryName: branding?.executiveSignatoryName,
      executiveSignatoryTitle: branding?.executiveSignatoryTitle || 'Chief Executive Officer',
      executiveSignatureUrl: branding?.executiveSignatureUrl,
      snapshottedAt: new Date().toISOString(),
    },
    brandingMeta: branding
      ? {
          tenantId: branding.tenantId,
          organisationName: branding.organisationName,
          code: branding.code,
          locale: branding.locale,
          timezone: branding.timezone,
          division: branding.division,
          address: branding.address,
          phone: branding.phone,
          email: branding.email,
          website: branding.website,
          registrationNumber: branding.registrationNumber,
          motto: branding.motto,
          primaryColor: branding.primaryColor,
          accentColor: branding.accentColor,
          documentFooter: branding.documentFooter,
          executiveSignatoryName: branding.executiveSignatoryName,
          executiveSignatoryTitle: branding.executiveSignatoryTitle,
        }
      : undefined,
  };
  const snapshotHash = createHash('sha256')
    .update(
      JSON.stringify({
        documentType,
        version: newVersion,
        snapshot: snapshotData,
      }),
    )
    .digest('hex');

  if (hasSchema(documentType)) {
    const validation = validateDocumentSnapshot(documentType, snapshotData);
    if (!validation.valid) {
      console.warn(
        `[DocGen] Snapshot validation failed for ${documentType}:${entityId}`,
        validation.errors,
      );
    }
  }

  const docId = randomUUID();
  const now = new Date();
  await runAtomicMutations((tx) => {
    const mutations = [];
    if (existing?.status === 'issued') {
      mutations.push(
        tx.update(generatedDocuments)
          .set({ status: 'superseded', updatedAt: now })
          .where(
            and(
              eq(generatedDocuments.id, existing.id),
              eq(generatedDocuments.tenantId, tenantId),
              eq(generatedDocuments.status, 'issued'),
            ),
          ),
      );
    }
    mutations.push(
      tx.insert(generatedDocuments).values({
        id: docId,
        tenantId,
        documentType,
        documentVersion: newVersion,
        templateVersion,
        entityType,
        entityId,
        snapshotData,
        hash: snapshotHash,
        status: newVersion > 1 ? 'issued' : 'draft', // preserve established regeneration behaviour
        generatedByUserId,
      }),
    );
    return mutations;
  });

  const [doc] = await db
    .select()
    .from(generatedDocuments)
    .where(and(eq(generatedDocuments.id, docId), eq(generatedDocuments.tenantId, tenantId)))
    .limit(1);
  if (!doc) throw new Error('Generated document committed but could not be reloaded');
  return doc;
}

// ---------------------------------------------------------------------------
// Lifecycle triggers
// ---------------------------------------------------------------------------

/**
 * Called when a transport request is submitted (not draft).
 */
export async function onRequestSubmitted(requestId: string, tenantId: string, userId: string) {
  return generateDocument({
    documentType: 'transport_request',
    entityType: 'transport_request',
    entityId: requestId,
    tenantId,
    generatedByUserId: userId,
  });
}

/**
 * Called when a trip is closed.
 */
export async function onTripClosed(tripId: string, tenantId: string, userId: string) {
  const results = await Promise.all([
    generateDocument({
      documentType: 'trip_completion',
      entityType: 'trip',
      entityId: tripId,
      tenantId,
      generatedByUserId: userId,
    }),
    generateDocument({
      documentType: 'fuel_summary',
      entityType: 'trip',
      entityId: tripId,
      tenantId,
      generatedByUserId: userId,
    }),
  ]);

  return results.filter(Boolean);
}

/**
 * Called when a trip is issued (vehicle + driver assigned).
 */
export async function onTripIssued(allocationId: string, tenantId: string, userId: string) {
  return generateDocument({
    documentType: 'trip_authority',
    entityType: 'vehicle_allocation',
    entityId: allocationId,
    tenantId,
    generatedByUserId: userId,
  });
}

/**
 * Called when an inspection is completed.
 */
export async function onInspectionCompleted(
  inspectionId: string,
  tenantId: string,
  userId: string,
) {
  return generateDocument({
    documentType: 'inspection_report',
    entityType: 'inspection',
    entityId: inspectionId,
    tenantId,
    generatedByUserId: userId,
  });
}
