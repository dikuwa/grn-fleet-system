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
import { vehicleAllocations, vehicleInspections } from '@/db/schema/trips';
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

  // Get branding info for document footer
  const [branding] = await db
    .select()
    .from(tenantBranding)
    .where(eq(tenantBranding.tenantId, tenantId))
    .limit(1);
  const resolvedBranding = await resolveTenantBranding(tenantId);

  // Build route summary
  let routeSummary: string | undefined;
  let totalKm: number | undefined;
  if (req) {
    const routes = await db.select().from(requestRoutes).where(eq(requestRoutes.requestId, req.id));

    if (routes.length > 0) {
      routeSummary = routes.map((r) => `${r.originName} → ${r.destinationName}`).join('; ');
      totalKm = routes.reduce((sum, r) => sum + (r.totalKilometres ?? r.mappedDistanceKm ?? 0), 0);
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
    },
    requesterName: undefined,
    purpose: req?.purpose || undefined,
    routeSummary,
    totalKm,
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
