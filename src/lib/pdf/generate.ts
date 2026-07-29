/**
 * PDF Generation Service
 *
 * Renders React-PDF document components to binary PDF buffers.
 * Provides helper functions for generating Trip Authority and Inspection Report PDFs
 * from snapshot data stored in the document store.
 */

import React from 'react';
import { renderToStream } from '@react-pdf/renderer';
import { TripAuthorityDocument, type TripAuthorityData } from './trip-authority';
import { TransportRequestDocument, type TransportRequestData } from './transport-request';
import { FuelSummaryDocument, type FuelSummaryData } from './fuel-summary';
import { TripCompletionDocument, type TripCompletionData } from './trip-completion';
import { MaintenanceReportDocument, type MaintenanceReportData } from './maintenance-report';
import { InspectionReportDocument, type InspectionReportData } from './inspection-report';
import { SnapshotDocument, type SnapshotDocumentData } from './snapshot-document';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { vehicles } from '@/db/schema/fleet';
import {
  tripAuthorities,
  tripAuthorityPassengers,
  tripAuthorisedDrivers,
  vehicleAllocations,
  vehicleInspections,
  inspectionItemResults,
  inspectionTemplateItems,
} from '@/db/schema/trips';
import { transportRequests, requestRoutes, requestDrivers, requestPassengers, requestActivities, requestAttachments } from '@/db/schema/requests';
import { tenants, tenantBranding } from '@/db/schema/tenants';
import { employees } from '@/db/schema/people';
import { workflowActions, workflowInstances } from '@/db/schema/workflows';
import { eq, and, desc, sql } from 'drizzle-orm';
import { resolveTenantBranding } from '@/lib/tenant-branding';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a PDF buffer for a Transport Request document using snapshot data
 * from the generated document record, with optional enriched relations.
 */
export async function generateTransportRequestPdf(
  documentId: string,
): Promise<Uint8Array | null> {
  const db = getDb();

  const [doc] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, documentId))
    .limit(1);
  if (!doc || !doc.snapshotData) return null;

  const snapshot = doc.snapshotData as Record<string, unknown>;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, doc.tenantId)).limit(1);
  const [branding] = await db
    .select()
    .from(tenantBranding)
    .where(eq(tenantBranding.tenantId, doc.tenantId))
    .limit(1);
  const resolvedBranding = await resolveTenantBranding(doc.tenantId);

  // Try to enrich with outcome data (linked trip authority, allocated vehicle, etc.)
  let outcome: TransportRequestData['outcome'] = undefined;
  if (doc.entityType === 'transport_request' && doc.entityId) {
    try {
      const [allocation] = await db
        .select({
          id: vehicleAllocations.id,
          startAt: vehicleAllocations.startAt,
          state: vehicleAllocations.state,
          licenceNumber: vehicles.licenceNumber,
          driverName: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.lastName})`,
        })
        .from(vehicleAllocations)
        .leftJoin(vehicles, eq(vehicles.id, vehicleAllocations.vehicleId))
        .leftJoin(employees, eq(employees.id, vehicleAllocations.driverEmployeeId))
        .where(and(eq(vehicleAllocations.requestId, doc.entityId), eq(vehicles.tenantId, doc.tenantId)))
        .orderBy(desc(vehicleAllocations.createdAt))
        .limit(1);

      if (allocation) {
        outcome = {
          finalStatus: doc.status === 'issued' ? 'Approved' : doc.status,
          linkedAuthorityReference: `TA-${allocation.id.slice(0, 8).toUpperCase()}`,
          allocatedVehicle: allocation.licenceNumber || 'Not recorded',
          allocatedDriver: allocation.driverName || 'Not recorded',
          allocationDate: allocation.startAt?.toISOString(),
          approvalDate: undefined, // Set below if found
        };

        // Find the approval action timestamp
        const [approval] = await db
          .select({ createdAt: workflowActions.createdAt })
          .from(workflowActions)
          .innerJoin(workflowInstances, eq(workflowInstances.id, workflowActions.instanceId))
          .where(and(
            eq(workflowInstances.requestId, doc.entityId),
            eq(workflowActions.actionType, 'authorise'),
          ))
          .orderBy(desc(workflowActions.createdAt))
          .limit(1);

        if (approval) {
          outcome.approvalDate = approval.createdAt.toISOString();
        }
      }
    } catch {
      // Non-fatal — outcome enrichment is best-effort
    }
  }

  const data: TransportRequestData = {
    reference: String(snapshot.reference || doc.id.slice(0, 8).toUpperCase()),
    revision: snapshot.revision as number | undefined,
    scope: String(snapshot.scope || 'regional'),
    status: doc.status || (snapshot.status as string) || 'draft',
    department: snapshot.department as string | undefined,
    purpose: snapshot.purpose as string | undefined,
    submittedAt: snapshot.submittedAt as string | undefined,
    totalAuthorisedKilometres: snapshot.totalAuthorisedKilometres as number | undefined,
    specialAuthorityRequired: snapshot.specialAuthorityRequired as boolean | undefined,
    tenantName: tenant?.name,
    tenantDocumentFooter: branding?.documentFooter || undefined,
    branding: resolvedBranding,
    documentVersion: doc.documentVersion,
    issuedAt: doc.createdAt.toISOString(),
    verificationCode: doc.id.slice(0, 8).toUpperCase(),
    requester: (snapshot.requester as TransportRequestData['requester']) || {
      name: 'Unknown',
    },
    activities: snapshot.activities as TransportRequestData['activities'],
    passengers: snapshot.passengers as TransportRequestData['passengers'],
    travellerCount: snapshot.travellerCount as number | undefined,
    drivers: snapshot.drivers as TransportRequestData['drivers'],
    routes: snapshot.routes as TransportRequestData['routes'],
    attachments: snapshot.attachments as TransportRequestData['attachments'],
    approvalWorkflow: snapshot.approvalWorkflow as TransportRequestData['approvalWorkflow'],
    outcome,
  };

  const element = React.createElement(
    TransportRequestDocument as React.ComponentType<{ data: TransportRequestData }>,
    { data },
  ) as React.ReactElement;
  return renderPdfToBuffer(element);
}

/**
 * Generate a PDF buffer for a Trip Authority document from an allocation ID.
 */
export async function generateTripAuthorityPdf(
  allocationId: string,
  tenantId: string,
): Promise<Uint8Array | null> {
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
    .select()
    .from(vehicles)
    .where(eq(vehicles.id, alloc.vehicleId))
    .limit(1);

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);

  const [branding] = await db
    .select()
    .from(tenantBranding)
    .where(eq(tenantBranding.tenantId, tenantId))
    .limit(1);
  const resolvedBranding = await resolveTenantBranding(tenantId);

  // Build route summary and journey legs
  let routeSummary: string | undefined;
  let totalKm: number | undefined;
  let journeyLegs: TripAuthorityData['journeyLegs'] = [];
  if (req) {
    const routes = await db.select().from(requestRoutes).where(eq(requestRoutes.requestId, req.id));
    if (routes.length > 0) {
      routeSummary = routes.map((r) => `${r.originName} → ${r.destinationName}`).join('; ');
      totalKm = routes.reduce((sum, r) => sum + (r.totalKilometres ?? r.mappedDistanceKm ?? 0), 0);
      journeyLegs = routes.map((r) => ({
        origin: r.originName || 'Not specified',
        destination: r.destinationName || 'Not specified',
        departureDate: alloc.startAt.toISOString().split('T')[0],
        returnDate: alloc.endAt.toISOString().split('T')[0],
        estimatedKm: r.totalKilometres ?? r.mappedDistanceKm ?? undefined,
      }));
    }
  }

  // Try to find the trip authority record to enrich with real driver, passengers, approvals
  const [authority] = await db
    .select()
    .from(tripAuthorities)
    .where(and(eq(tripAuthorities.allocationId, allocationId), eq(tripAuthorities.tenantId, tenantId)))
    .orderBy(desc(tripAuthorities.createdAt))
    .limit(1);

  let driver: TripAuthorityData['driver'] | undefined;
  let passengers: TripAuthorityData['passengers'] | undefined;
  let additionalDrivers: TripAuthorityData['additionalDrivers'] | undefined;
  let authoriser: TripAuthorityData['authoriser'] | undefined;
  let transportOfficer: TripAuthorityData['transportOfficer'] | undefined;
  let specialConditions: string | undefined;
  let goodsAndEquipment: TripAuthorityData['goodsAndEquipment'] | undefined;
  let preDepartureInspection: TripAuthorityData['preDepartureInspection'] | undefined;
  let fuelInformation: TripAuthorityData['fuelInformation'] | undefined;

  if (authority) {
    specialConditions = authority.specialConditions || undefined;

    // Fetch passengers from trip authority
    const passengerRows = await db
      .select()
      .from(tripAuthorityPassengers)
      .where(eq(tripAuthorityPassengers.authorityId, authority.id));
    if (passengerRows.length > 0) {
      passengers = passengerRows.map((p) => ({
        name: p.fullName,
        employeeNumber: p.employeeNumber || undefined,
        passengerType: p.passengerType,
        destination: p.destination || undefined,
        indemnityConfirmed: p.indemnityConfirmed,
      }));
    }

    // Fetch authorised drivers
    const driverRows = await db
      .select({
        driverType: tripAuthorisedDrivers.driverType,
        employeeNumber: tripAuthorisedDrivers.employeeNumber,
        firstName: employees.firstName,
        lastName: employees.lastName,
        jobTitle: employees.jobTitle,
        phone: employees.phone,
        licenceClass: tripAuthorisedDrivers.licenceClass,
        licenceExpiry: tripAuthorisedDrivers.licenceExpiry,
      })
      .from(tripAuthorisedDrivers)
      .innerJoin(employees, eq(employees.id, tripAuthorisedDrivers.employeeId))
      .where(eq(tripAuthorisedDrivers.authorityId, authority.id));

    const primary = driverRows.find((d) => d.driverType === 'primary');
    if (primary) {
      driver = {
        name: `${primary.firstName} ${primary.lastName}`,
        employeeNumber: primary.employeeNumber || undefined,
        designation: primary.jobTitle || undefined,
        contactNumber: primary.phone || undefined,
        acceptedAt: authority.acceptedAt?.toLocaleString('en-NA'),
      };
    }

    additionalDrivers = driverRows
      .filter((d) => d.driverType !== 'primary')
      .map((d) => ({
        name: `${d.firstName} ${d.lastName}`,
        employeeNumber: d.employeeNumber || undefined,
        licenceClass: d.licenceClass || undefined,
        licenceExpiry: d.licenceExpiry?.toLocaleDateString('en-NA'),
      }));

    // Fetch departure inspection
    const [depInsp] = await db
      .select()
      .from(vehicleInspections)
      .where(and(
        eq(vehicleInspections.vehicleId, alloc.vehicleId),
        eq(vehicleInspections.type, 'departure'),
      ))
      .orderBy(desc(vehicleInspections.createdAt))
      .limit(1);

    if (depInsp) {
      const inspResults = await db
        .select({
          result: inspectionItemResults.result,
          comment: inspectionItemResults.comment,
          label: inspectionTemplateItems.label,
        })
        .from(inspectionItemResults)
        .innerJoin(inspectionTemplateItems, eq(inspectionTemplateItems.id, inspectionItemResults.templateItemId))
        .where(eq(inspectionItemResults.inspectionId, depInsp.id));

      preDepartureInspection = {
        status: depInsp.status,
        odometer: depInsp.odometerReading || undefined,
        items: inspResults.length > 0
          ? inspResults.map((item) => ({
              label: item.label,
              result: item.result,
              comment: item.comment || undefined,
            }))
          : undefined,
        notes: depInsp.notes || undefined,
        completedAt: depInsp.createdAt.toLocaleString('en-NA'),
      };
    }

    // Resolve authoriser from snapshot
    const snap = authority.authoriserSnapshot as { employeeId?: string } | null;
    if (snap?.employeeId) {
      const [authEmp] = await db
        .select({
          firstName: employees.firstName,
          lastName: employees.lastName,
          jobTitle: employees.jobTitle,
        })
        .from(employees)
        .where(eq(employees.id, snap.employeeId))
        .limit(1);
      if (authEmp) {
        authoriser = {
          name: `${authEmp.firstName} ${authEmp.lastName}`,
          designation: authEmp.jobTitle || 'Authorising Officer',
          authorisedAt: authority.authorisedAt?.toLocaleString('en-NA'),
        };
      }
    }

    // Resolve transport officer from allocation
    const [toEmp] = await db
      .select({
        firstName: employees.firstName,
        lastName: employees.lastName,
        jobTitle: employees.jobTitle,
      })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.userId, alloc.allocatedByUserId)))
      .limit(1);
    if (toEmp) {
      transportOfficer = {
        name: `${toEmp.firstName} ${toEmp.lastName}`,
        designation: toEmp.jobTitle || 'Transport Officer',
        issuedAt: authority.issuedAt?.toLocaleString('en-NA'),
      };
    }

    // Build fuel information
    if (vehicle?.fuelCardNumber || vehicle?.fuelType) {
      fuelInformation = {
        fuelCardNumber: vehicle?.fuelCardNumber || undefined,
        fuelType: vehicle?.fuelType || undefined,
      };
    }
  }

  const data: TripAuthorityData = {
    reference: alloc.id.slice(0, 8).toUpperCase(),
    tenantName: tenant?.name,
    tenantDocumentFooter: branding?.documentFooter || undefined,
    branding: resolvedBranding,
    requestReference: req?.reference || 'N/A',
    scope: req?.scope || 'regional',
    startAt: alloc.startAt.toISOString().split('T')[0],
    endAt: alloc.endAt.toISOString().split('T')[0],
    vehicle: {
      licenceNumber: vehicle?.licenceNumber || 'N/A',
      vehicleRegisterNumber: vehicle?.vehicleRegisterNumber || 'N/A',
      make: vehicle?.make || '',
      model: vehicle?.model || '',
      colour: vehicle?.colour || undefined,
      fuelType: vehicle?.fuelType || undefined,
      currentOdometer: vehicle?.currentOdometer || undefined,
    },
    requesterName: req?.requesterEmployeeId
      ? await db
          .select({
            name: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.middleName}, ${employees.lastName})`,
          })
          .from(employees)
          .where(eq(employees.id, req.requesterEmployeeId))
          .limit(1)
          .then((rows) => rows[0]?.name || undefined)
      : undefined,
    department: req?.department || undefined,
    purpose: req?.purpose || undefined,
    routeSummary,
    totalKm,
    journeyLegs: journeyLegs.length > 0 ? journeyLegs : undefined,
    authorisation: (authoriser || transportOfficer) ? {
      authoriserName: authoriser?.name || 'Authorising officer',
      authoriserRole: authoriser?.designation || 'Authorising Officer',
      authorisedAt: authoriser?.authorisedAt,
      transportOfficerName: transportOfficer?.name || 'Transport Officer',
      transportOfficerRole: transportOfficer?.designation || 'Transport Officer',
      issueDate: authority?.issuedAt?.toLocaleString('en-NA') || new Date().toISOString().split('T')[0],
      approvalMethod: 'Digitally authorised',
    } : undefined,
    specialConditions,
    driver,
    passengers,
    additionalDrivers,
    authoriser,
    transportOfficer,
    goodsAndEquipment,
    preDepartureInspection,
    fuelInformation,
    authorityStatus: authority?.status || 'issued',
    documentVersion: authority?.documentVersion || 1,
    issuedAt: authority?.issuedAt?.toISOString(),
  };

  const element = React.createElement(
    TripAuthorityDocument as React.ComponentType<{ data: TripAuthorityData }>,
    { data },
  ) as React.ReactElement;
  return renderPdfToBuffer(element);
}

/**
 * Generate a PDF buffer for an Inspection Report from an inspection ID.
 */
export async function generateInspectionReportPdf(
  inspectionId: string,
  tenantId: string,
): Promise<Uint8Array | null> {
  const db = getDb();

  const [insp] = await db
    .select()
    .from(vehicleInspections)
    .where(eq(vehicleInspections.id, inspectionId))
    .limit(1);
  if (!insp) return null;

  const [vehicle] = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.id, insp.vehicleId))
    .limit(1);

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);

  const [branding] = await db
    .select()
    .from(tenantBranding)
    .where(eq(tenantBranding.tenantId, tenantId))
    .limit(1);
  const resolvedBranding = await resolveTenantBranding(tenantId);

  const data: InspectionReportData = {
    inspectionId: insp.id,
    type: insp.type as 'departure' | 'return',
    vehicle: {
      licenceNumber: vehicle?.licenceNumber || 'N/A',
      registrationNumber: vehicle?.vehicleRegisterNumber || 'N/A',
    },
    odometerReading: insp.odometerReading,
    fuelLevel: insp.fuelLevel,
    overallPass: insp.overallPass,
    status: insp.status,
    notes: insp.notes,
    inspectedAt: insp.createdAt.toISOString().split('T')[0],
    tenantName: tenant?.name,
    tenantDocumentFooter: branding?.documentFooter || undefined,
    branding: resolvedBranding,
    inspectorName: undefined,
    driverName: undefined,
    items: [],
  };

  const element = React.createElement(
    InspectionReportDocument as React.ComponentType<{ data: InspectionReportData }>,
    { data },
  ) as React.ReactElement;
  return renderPdfToBuffer(element);
}

/**
 * Generate a PDF for a document that already has snapshot data stored.
 */
export async function generateDocumentPdf(
  documentId: string,
): Promise<{ buffer: Uint8Array; filename: string } | null> {
  const db = getDb();

  const [doc] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, documentId))
    .limit(1);
  if (!doc) return null;

  let buffer: Uint8Array | null = null;

  switch (doc.documentType) {
    case 'trip_authority': {
      if (doc.entityType === 'vehicle_allocation') {
        buffer = await generateTripAuthorityPdf(doc.entityId, doc.tenantId);
      }
      break;
    }
    case 'inspection_report': {
      if (doc.entityType === 'inspection') {
        buffer = await generateInspectionReportPdf(doc.entityId, doc.tenantId);
      }
      break;
    }
    case 'transport_request': {
      buffer = await generateTransportRequestPdf(documentId);
      break;
    }
    case 'fuel_summary': {
      buffer = await generateDocumentPdfFromSnapshot(documentId, 'Fuel Summary');
      break;
    }
    case 'trip_completion': {
      buffer = await generateDocumentPdfFromSnapshot(documentId, 'Trip Completion Report');
      break;
    }
    case 'maintenance_report': {
      buffer = await generateDocumentPdfFromSnapshot(documentId, 'Maintenance Report');
      break;
    }
    default: {
      // Use the generic snapshot PDF for all other document types
      if (doc.snapshotData) {
        const [t] = await db.select().from(tenants).where(eq(tenants.id, doc.tenantId)).limit(1);
        const snapshotData: SnapshotDocumentData = {
          documentType: doc.documentType,
          documentVersion: doc.documentVersion,
          tenantName: t?.name,
          branding: await resolveTenantBranding(doc.tenantId),
          tenantDocumentFooter: undefined,
          snapshotData: doc.snapshotData as Record<string, unknown>,
          generatedAt: doc.createdAt.toISOString(),
          status: doc.status,
        };
        const element = React.createElement(
          SnapshotDocument as React.ComponentType<{ data: SnapshotDocumentData }>,
          { data: snapshotData },
        ) as React.ReactElement;
        buffer = await renderPdfToBuffer(element);
      }
      break;
    }
  }

  if (!buffer) return null;

  const filename = `${doc.documentType}_${doc.id.slice(0, 8)}.pdf`;

  return { buffer, filename };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Generate a typed PDF from a stored snapshot for fuel_summary, trip_completion,
 * or maintenance_report document types.
 */
async function generateDocumentPdfFromSnapshot(
  documentId: string,
  _documentLabel: string,
): Promise<Uint8Array | null> {
  const db = getDb();

  const [doc] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, documentId))
    .limit(1);
  if (!doc || !doc.snapshotData) return null;

  const snapshot = doc.snapshotData as Record<string, unknown>;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, doc.tenantId)).limit(1);
  const resolvedBranding = await resolveTenantBranding(doc.tenantId);
  const generatedAt = doc.createdAt.toISOString();

  let element: React.ReactElement | null = null;

  switch (doc.documentType) {
    case 'fuel_summary': {
      const data: FuelSummaryData = {
        tripId: doc.entityId || doc.id,
        totalLitres: Number(snapshot.totalLitres ?? 0),
        totalCost: Number(snapshot.totalCost ?? 0),
        transactionCount: Number(snapshot.transactionCount ?? 0),
        pendingReimbursements: Number(snapshot.pendingReimbursements ?? 0),
        actualKilometres: (snapshot.actualKilometres as number | null) ?? undefined,
        kilometreVariance: (snapshot.kilometreVariance as number | null) ?? undefined,
        tenantName: tenant?.name,
        branding: resolvedBranding,
        documentVersion: doc.documentVersion,
        generatedAt,
        status: doc.status,
        verificationCode: doc.id.slice(0, 8).toUpperCase(),
        transactions: snapshot.transactions as FuelSummaryData['transactions'],
      };
      element = React.createElement(
        FuelSummaryDocument as React.ComponentType<{ data: FuelSummaryData }>,
        { data },
      ) as React.ReactElement;
      break;
    }
    case 'trip_completion': {
      const vehicleSnapshot = snapshot.vehicle as { licenceNumber?: string; registrationNumber?: string } | undefined;
      const closureSnapshot = snapshot.closure as {
        authorisedKm?: number | null;
        actualKm?: number | null;
        variance?: number | null;
        decision?: string;
        notes?: string | null;
      } | null | undefined;
      const fuelSnap = snapshot.fuelSummary as {
        totalLitres?: number;
        totalCost?: number;
        transactionCount?: number;
        pendingReimbursements?: number;
      } | null | undefined;

      const data: TripCompletionData = {
        tripId: doc.entityId || doc.id,
        status: (snapshot.status as string) || doc.status || 'issued',
        vehicle: {
          licenceNumber: vehicleSnapshot?.licenceNumber || 'N/A',
          registrationNumber: vehicleSnapshot?.registrationNumber,
        },
        issuedAt: snapshot.issuedAt as string | undefined,
        startedAt: snapshot.startedAt as string | undefined,
        returnedAt: snapshot.returnedAt as string | undefined,
        closedAt: snapshot.closedAt as string | undefined,
        closure: closureSnapshot
          ? {
              authorisedKm: closureSnapshot.authorisedKm ?? null,
              actualKm: closureSnapshot.actualKm ?? null,
              variance: closureSnapshot.variance ?? null,
              decision: closureSnapshot.decision,
              notes: closureSnapshot.notes,
            }
          : null,
        fuelSummary: fuelSnap
          ? {
              totalLitres: fuelSnap.totalLitres ?? 0,
              totalCost: fuelSnap.totalCost ?? 0,
              transactionCount: fuelSnap.transactionCount ?? 0,
              pendingReimbursements: fuelSnap.pendingReimbursements ?? 0,
            }
          : null,
        tenantName: tenant?.name,
        branding: resolvedBranding,
        documentVersion: doc.documentVersion,
        generatedAt,
        statusText: doc.status,
        verificationCode: doc.id.slice(0, 8).toUpperCase(),
      };
      element = React.createElement(
        TripCompletionDocument as React.ComponentType<{ data: TripCompletionData }>,
        { data },
      ) as React.ReactElement;
      break;
    }
    case 'maintenance_report': {
      const eventsSnapshot = snapshot.events as Array<{
        date?: string;
        type?: string;
        description?: string;
        cost?: number | null;
        vendor?: string | null;
        odometer?: number | null;
      }> | undefined;

      const data: MaintenanceReportData = {
        vehicleId: doc.entityId || doc.id,
        vehicle: snapshot.vehicle as string | undefined,
        totalEvents: Number(snapshot.totalEvents ?? 0),
        totalCost: Number(snapshot.totalCost ?? 0),
        nextServiceDate: snapshot.nextServiceDate as string | null | undefined,
        nextServiceOdometer: snapshot.nextServiceOdometer as number | null | undefined,
        tenantName: tenant?.name,
        branding: resolvedBranding,
        documentVersion: doc.documentVersion,
        generatedAt,
        status: doc.status,
        verificationCode: doc.id.slice(0, 8).toUpperCase(),
        events: (eventsSnapshot || []).map((e) => ({
          date: e.date,
          type: e.type,
          description: e.description,
          cost: e.cost ?? null,
          vendor: e.vendor,
          odometer: e.odometer ?? null,
        })),
      };
      element = React.createElement(
        MaintenanceReportDocument as React.ComponentType<{ data: MaintenanceReportData }>,
        { data },
      ) as React.ReactElement;
      break;
    }
    default:
      return null;
  }

  if (!element) return null;
  return renderPdfToBuffer(element);
}

async function renderPdfToBuffer(element: React.ReactElement): Promise<Uint8Array> {
  const stream = await renderToStream(
    element as unknown as React.ReactElement<Record<string, unknown>>,
  );
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(new Uint8Array(chunk as unknown as ArrayBuffer));
  }
  // Combine chunks into a single Uint8Array
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
