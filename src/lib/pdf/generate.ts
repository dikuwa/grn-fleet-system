/**
 * PDF Generation Service
 *
 * Renders React-PDF document components to binary PDF buffers.
 * Provides helper functions for generating Trip Authority and Inspection Report PDFs
 * from snapshot data stored in the document store.
 */

import React from 'react';
import QRCode from 'qrcode';
import { renderToStream } from '@react-pdf/renderer';
import { TripAuthorityDocument, type TripAuthorityData } from './trip-authority';
import { TransportRequestDocument, type TransportRequestData } from './transport-request';
import { FuelSummaryDocument, type FuelSummaryData } from './fuel-summary';
import { TripCompletionDocument, type TripCompletionData } from './trip-completion';
import { MaintenanceReportDocument, type MaintenanceReportData } from './maintenance-report';
import { InspectionReportDocument, type InspectionReportData } from './inspection-report';
import { MvaReportDocument, type MvaReportData } from './mva-report';
import { IncidentRecordDocument, type IncidentRecordData } from './operational-records';
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
import { transportRequests, requestGoodsEquipment, requestRoutes } from '@/db/schema/requests';
import { tenants, tenantBranding } from '@/db/schema/tenants';
import { employees } from '@/db/schema/people';
import { workflowActions, workflowInstances } from '@/db/schema/workflows';
import { eq, and, desc, sql } from 'drizzle-orm';
import { resolveTenantDocumentBranding, type ResolvedTenantBranding } from '@/lib/tenant-branding';
import { buildFleetPdfFilename, referenceFromDocumentSnapshot } from './document-filename';

function applySnapshotIdentity(
  current: ResolvedTenantBranding | null,
  snapshot: Record<string, unknown>,
): ResolvedTenantBranding | null {
  const identity = snapshot.documentIdentity as Partial<ResolvedTenantBranding> | undefined;
  if (!identity) return current;
  return {
    ...(current || {
      tenantId: '',
      organisationName: 'Government Fleet',
      code: '',
      locale: 'en-NA',
      timezone: 'Africa/Windhoek',
      primaryColor: '#245B9E',
      accentColor: '#0F766E',
    }),
    ...Object.fromEntries(
      Object.entries(identity).filter(
        ([, value]) => value !== null && value !== undefined && value !== '',
      ),
    ),
  } as ResolvedTenantBranding;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a PDF buffer for a Transport Request document using snapshot data
 * from the generated document record, with optional enriched relations.
 */
export async function generateTransportRequestPdf(documentId: string): Promise<Uint8Array | null> {
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
  const resolvedBranding = applySnapshotIdentity(
    await resolveTenantDocumentBranding(doc.tenantId),
    snapshot,
  );

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
        .where(
          and(eq(vehicleAllocations.requestId, doc.entityId), eq(vehicles.tenantId, doc.tenantId)),
        )
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
          .where(
            and(
              eq(workflowInstances.requestId, doc.entityId),
              eq(workflowActions.actionType, 'authorise'),
            ),
          )
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
    goodsAndEquipment: snapshot.goodsAndEquipment as TransportRequestData['goodsAndEquipment'],
    documentHash: doc.hash || undefined,
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
  documentMeta?: { hash?: string | null; verificationCode?: string },
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
  const resolvedBranding = await resolveTenantDocumentBranding(tenantId);

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
    .where(
      and(eq(tripAuthorities.allocationId, allocationId), eq(tripAuthorities.tenantId, tenantId)),
    )
    .orderBy(desc(tripAuthorities.createdAt))
    .limit(1);

  let driver: TripAuthorityData['driver'] | undefined;
  let passengers: TripAuthorityData['passengers'] | undefined;
  let additionalDrivers: TripAuthorityData['additionalDrivers'] | undefined;
  let authoriser: TripAuthorityData['authoriser'] | undefined;
  let transportOfficer: TripAuthorityData['transportOfficer'] | undefined;
  let specialConditions: string | undefined;
  const goodsRows = req
    ? await db
        .select({
          description: requestGoodsEquipment.description,
          quantity: requestGoodsEquipment.quantity,
          purpose: requestGoodsEquipment.purpose,
        })
        .from(requestGoodsEquipment)
        .where(eq(requestGoodsEquipment.requestId, req.id))
        .orderBy(requestGoodsEquipment.sortOrder)
    : [];
  const goodsAndEquipment: TripAuthorityData['goodsAndEquipment'] = goodsRows.map((item) => ({
    description: item.description,
    quantity: item.quantity || undefined,
    purpose: item.purpose || undefined,
  }));
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
        nationalIdNumber: employees.nationalIdNumber,
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
        idNumber: primary.nationalIdNumber || undefined,
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
        idNumber: d.nationalIdNumber || undefined,
        licenceClass: d.licenceClass || undefined,
        licenceExpiry: d.licenceExpiry?.toLocaleDateString('en-NA'),
      }));

    // Fetch departure inspection
    const [depInsp] = await db
      .select()
      .from(vehicleInspections)
      .where(
        and(
          eq(vehicleInspections.vehicleId, alloc.vehicleId),
          eq(vehicleInspections.type, 'departure'),
        ),
      )
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
        .innerJoin(
          inspectionTemplateItems,
          eq(inspectionTemplateItems.id, inspectionItemResults.templateItemId),
        )
        .where(eq(inspectionItemResults.inspectionId, depInsp.id));

      preDepartureInspection = {
        status: depInsp.status,
        odometer: depInsp.odometerReading || undefined,
        items:
          inspResults.length > 0
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

  const verificationToken = (authority?.data as { verificationToken?: string } | null)
    ?.verificationToken;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const verificationUrl = verificationToken
    ? `${baseUrl}/verify/authority/${encodeURIComponent(verificationToken)}`
    : undefined;
  const qrCodeDataUrl = verificationUrl
    ? await QRCode.toDataURL(verificationUrl, { width: 220, margin: 1 })
    : undefined;

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
    authorisation:
      authoriser || transportOfficer
        ? {
            authoriserName: authoriser?.name || 'Authorising officer',
            authoriserRole: authoriser?.designation || 'Authorising Officer',
            authorisedAt: authoriser?.authorisedAt,
            transportOfficerName: transportOfficer?.name || 'Transport Officer',
            transportOfficerRole: transportOfficer?.designation || 'Transport Officer',
            issueDate:
              authority?.issuedAt?.toLocaleString('en-NA') ||
              new Date().toISOString().split('T')[0],
            approvalMethod: 'Digitally authorised',
          }
        : undefined,
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
    verificationCode: documentMeta?.verificationCode || authority?.authorityNumber || undefined,
    verificationUrl,
    documentHash: documentMeta?.hash || undefined,
    qrCodeDataUrl,
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
  documentMeta?: { hash?: string | null; verificationCode?: string },
): Promise<Uint8Array | null> {
  const db = getDb();

  const [insp] = await db
    .select()
    .from(vehicleInspections)
    .where(and(eq(vehicleInspections.id, inspectionId), eq(vehicleInspections.tenantId, tenantId)))
    .limit(1);
  if (!insp) return null;

  const [vehicle] = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.id, insp.vehicleId), eq(vehicles.tenantId, tenantId)))
    .limit(1);

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);

  const [branding] = await db
    .select()
    .from(tenantBranding)
    .where(eq(tenantBranding.tenantId, tenantId))
    .limit(1);
  const resolvedBranding = await resolveTenantDocumentBranding(tenantId);

  const [items, inspector, driver] = await Promise.all([
    db
      .select({
        label: inspectionTemplateItems.label,
        category: inspectionTemplateItems.category,
        result: inspectionItemResults.result,
        comment: inspectionItemResults.comment,
      })
      .from(inspectionItemResults)
      .innerJoin(
        inspectionTemplateItems,
        eq(inspectionTemplateItems.id, inspectionItemResults.templateItemId),
      )
      .where(eq(inspectionItemResults.inspectionId, inspectionId))
      .orderBy(inspectionTemplateItems.sortOrder),
    insp.inspectorEmployeeId
      ? db
          .select({ firstName: employees.firstName, lastName: employees.lastName })
          .from(employees)
          .where(and(eq(employees.id, insp.inspectorEmployeeId), eq(employees.tenantId, tenantId)))
          .limit(1)
          .then((rows) => rows[0])
      : Promise.resolve(undefined),
    insp.driverEmployeeId
      ? db
          .select({ firstName: employees.firstName, lastName: employees.lastName })
          .from(employees)
          .where(and(eq(employees.id, insp.driverEmployeeId), eq(employees.tenantId, tenantId)))
          .limit(1)
          .then((rows) => rows[0])
      : Promise.resolve(undefined),
  ]);

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
    inspectorName: inspector ? `${inspector.firstName} ${inspector.lastName}` : undefined,
    driverName: driver ? `${driver.firstName} ${driver.lastName}` : undefined,
    inspectorSignedAt: insp.signatureInspector ? insp.updatedAt.toISOString() : undefined,
    driverSignedAt: insp.signatureDriver ? insp.updatedAt.toISOString() : undefined,
    verificationCode: documentMeta?.verificationCode,
    documentHash: documentMeta?.hash || undefined,
    items: items.map((item) => ({
      label: item.label,
      category: item.category,
      result: item.result as 'pass' | 'fail' | 'not_applicable',
      comment: item.comment || undefined,
    })),
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
        buffer = await generateTripAuthorityPdf(doc.entityId, doc.tenantId, {
          hash: doc.hash,
          verificationCode: doc.id.slice(0, 8).toUpperCase(),
        });
      }
      break;
    }
    case 'inspection_report': {
      if (doc.entityType === 'inspection') {
        buffer = await generateInspectionReportPdf(doc.entityId, doc.tenantId, {
          hash: doc.hash,
          verificationCode: doc.id.slice(0, 8).toUpperCase(),
        });
      }
      break;
    }
    case 'transport_request': {
      buffer = await generateTransportRequestPdf(documentId);
      break;
    }
    case 'fuel_summary': {
      buffer = await generateDocumentPdfFromSnapshot(documentId);
      break;
    }
    case 'trip_completion': {
      buffer = await generateDocumentPdfFromSnapshot(documentId);
      break;
    }
    case 'maintenance_report': {
      buffer = await generateDocumentPdfFromSnapshot(documentId);
      break;
    }
    case 'accident_report': {
      buffer = await generateDocumentPdfFromSnapshot(documentId);
      break;
    }
    case 'trip_incident_report': {
      buffer = await generateDocumentPdfFromSnapshot(documentId);
      break;
    }
    default: {
      // Use the generic snapshot PDF for all other document types
      if (doc.snapshotData) {
        const [t] = await db.select().from(tenants).where(eq(tenants.id, doc.tenantId)).limit(1);
        const snapshot = doc.snapshotData as Record<string, unknown>;
        const snapshotData: SnapshotDocumentData = {
          documentType: doc.documentType,
          documentVersion: doc.documentVersion,
          tenantName: t?.name,
          branding: applySnapshotIdentity(
            await resolveTenantDocumentBranding(doc.tenantId),
            snapshot,
          ),
          tenantDocumentFooter: undefined,
          snapshotData: snapshot,
          generatedAt: doc.createdAt.toISOString(),
          status: doc.status,
          documentHash: doc.hash || undefined,
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

  const snapshot = doc.snapshotData as Record<string, unknown> | null;
  const filename = buildFleetPdfFilename({
    documentType: doc.documentType,
    date: doc.createdAt,
    reference: referenceFromDocumentSnapshot(snapshot, doc.entityId.slice(0, 8)),
  });

  return { buffer, filename };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Generate a typed PDF from a stored snapshot for fuel_summary, trip_completion,
 * or maintenance_report document types.
 */
async function generateDocumentPdfFromSnapshot(documentId: string): Promise<Uint8Array | null> {
  const db = getDb();

  const [doc] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, documentId))
    .limit(1);
  if (!doc || !doc.snapshotData) return null;

  const snapshot = doc.snapshotData as Record<string, unknown>;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, doc.tenantId)).limit(1);
  const resolvedBranding = applySnapshotIdentity(
    await resolveTenantDocumentBranding(doc.tenantId),
    snapshot,
  );
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
        documentHash: doc.hash || undefined,
        transactions: snapshot.transactions as FuelSummaryData['transactions'],
      };
      element = React.createElement(
        FuelSummaryDocument as React.ComponentType<{ data: FuelSummaryData }>,
        { data },
      ) as React.ReactElement;
      break;
    }
    case 'trip_completion': {
      const vehicleSnapshot = snapshot.vehicle as
        { licenceNumber?: string; registrationNumber?: string } | undefined;
      const closureSnapshot = snapshot.closure as
        | {
            authorisedKm?: number | null;
            actualKm?: number | null;
            variance?: number | null;
            decision?: string;
            notes?: string | null;
          }
        | null
        | undefined;
      const fuelSnap = snapshot.fuelSummary as
        | {
            totalLitres?: number;
            totalCost?: number;
            transactionCount?: number;
            pendingReimbursements?: number;
          }
        | null
        | undefined;
      const eventSummary = snapshot.eventSummary as TripCompletionData['eventSummary'];

      const data: TripCompletionData = {
        tripId: doc.entityId || doc.id,
        status: (snapshot.status as string) || doc.status || 'issued',
        vehicle: {
          licenceNumber: vehicleSnapshot?.licenceNumber || 'N/A',
          registrationNumber: vehicleSnapshot?.registrationNumber,
        },
        routeKm: (snapshot.routeKm as number | null | undefined) ?? undefined,
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
        eventSummary,
        tenantName: tenant?.name,
        branding: resolvedBranding,
        documentVersion: doc.documentVersion,
        generatedAt,
        statusText: doc.status,
        verificationCode: doc.id.slice(0, 8).toUpperCase(),
        documentHash: doc.hash || undefined,
      };
      element = React.createElement(
        TripCompletionDocument as React.ComponentType<{ data: TripCompletionData }>,
        { data },
      ) as React.ReactElement;
      break;
    }
    case 'maintenance_report': {
      const eventsSnapshot = snapshot.events as
        | Array<{
            date?: string;
            type?: string;
            description?: string;
            cost?: number | null;
            vendor?: string | null;
            odometer?: number | null;
          }>
        | undefined;

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
        documentHash: doc.hash || undefined,
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
    case 'accident_report': {
      const data: MvaReportData = {
        reference: String(snapshot.reference ?? doc.entityId ?? ''),
        severity: String(snapshot.severity ?? 'minor'),
        status: String(snapshot.status ?? 'reported'),
        occurredAt: String(snapshot.occurredAt ?? generatedAt),
        location: (snapshot.location as string | null) ?? null,
        description: String(snapshot.description ?? ''),
        immediateAction: (snapshot.immediateAction as string | null) ?? null,
        continuationState: (snapshot.continuationState as string | null) ?? null,
        vehicleSafe: (snapshot.vehicleSafe as boolean | null) ?? null,
        passengerSafe: (snapshot.passengerSafe as boolean | null) ?? null,
        injuries: Boolean(snapshot.injuries),
        numberInjured: Number(snapshot.numberInjured ?? 0),
        vehicleDamage: Boolean(snapshot.vehicleDamage),
        thirdPartyInvolvement: Boolean(snapshot.thirdPartyInvolvement),
        policeReference: (snapshot.policeReference as string | null) ?? null,
        emergencyServicesContacted: Boolean(snapshot.emergencyServicesContacted),
        detailsRequired: Boolean(snapshot.detailsRequired),
        tripReferences: {
          transportRequest: String(
            (snapshot.tripReferences as { transportRequest?: string } | undefined)
              ?.transportRequest ?? '—',
          ),
          tripAuthority: String(
            (snapshot.tripReferences as { tripAuthority?: string } | undefined)?.tripAuthority ??
              '—',
          ),
        },
        vehicle: {
          registration: String(
            (snapshot.vehicle as { registration?: string } | undefined)?.registration ?? '',
          ),
          registerNumber: String(
            (snapshot.vehicle as { registerNumber?: string } | undefined)?.registerNumber ?? '',
          ),
          make: String((snapshot.vehicle as { make?: string } | undefined)?.make ?? ''),
          model: String((snapshot.vehicle as { model?: string } | undefined)?.model ?? ''),
        },
        accidentReportNumber: (snapshot.accidentReportNumber as string | null) ?? null,
        investigationStatus: String(snapshot.investigationStatus ?? 'pending'),
        investigationNotes: (snapshot.investigationNotes as string | null) ?? null,
        investigationClosedAt: (snapshot.investigationClosedAt as string | null) ?? null,
        witnessStatements:
          (snapshot.witnessStatements as Array<Record<string, unknown>> | null) ?? [],
        thirdPartyDetails: (snapshot.thirdPartyDetails as Record<string, unknown> | null) ?? null,
        insuranceClaimReference: (snapshot.insuranceClaimReference as string | null) ?? null,
        insuranceNotified: Boolean(snapshot.insuranceNotified),
        insuranceNotifiedAt: (snapshot.insuranceNotifiedAt as string | null) ?? null,
        policeReportFiled: Boolean(snapshot.policeReportFiled),
        thirdPartyInsuranceDetails:
          (snapshot.thirdPartyInsuranceDetails as Record<string, unknown> | null) ?? null,
        technicalClearanceStatus: String(snapshot.technicalClearanceStatus ?? 'pending'),
        technicalClearanceAt: (snapshot.technicalClearanceAt as string | null) ?? null,
        technicalClearanceByUserId: (snapshot.technicalClearanceByUserId as string | null) ?? null,
        tenantName: tenant?.name,
        branding: resolvedBranding,
        documentVersion: doc.documentVersion,
        generatedAt,
        verificationCode: doc.id.slice(0, 8).toUpperCase(),
        documentHash: doc.hash || undefined,
      };
      element = React.createElement(
        MvaReportDocument as React.ComponentType<{ data: MvaReportData }>,
        { data },
      ) as React.ReactElement;
      break;
    }
    case 'trip_incident_report': {
      const vehicle = snapshot.vehicle as
        | { registration?: string; registerNumber?: string; make?: string; model?: string }
        | undefined;
      const tripReferences = snapshot.tripReferences as
        { tripAuthority?: string; transportRequest?: string } | undefined;
      const vehicleSafe = snapshot.vehicleSafe as boolean | null | undefined;
      const passengerSafe = snapshot.passengerSafe as boolean | null | undefined;
      const data: IncidentRecordData = {
        reference: String(snapshot.reference ?? doc.entityId ?? doc.id),
        type: String(snapshot.eventType ?? 'incident'),
        severity: String(snapshot.severity ?? 'not_recorded'),
        status: String(snapshot.status ?? doc.status ?? 'reported'),
        vehicle: [vehicle?.registration, vehicle?.make, vehicle?.model].filter(Boolean).join(' · '),
        tripAuthority: tripReferences?.tripAuthority,
        occurredAt: String(snapshot.occurredAt ?? generatedAt),
        location: (snapshot.location as string | null | undefined) ?? null,
        description: String(snapshot.description ?? ''),
        damageOrDefects: Boolean(snapshot.vehicleDamage)
          ? 'Vehicle damage or defects were reported. Refer to the incident description and evidence.'
          : null,
        evidence: (snapshot.attachments as string[] | undefined) ?? [],
        responseOrAction: (snapshot.immediateAction as string | null | undefined) ?? null,
        safeDetermination:
          vehicleSafe === undefined && passengerSafe === undefined
            ? null
            : `Vehicle ${vehicleSafe ? 'safe' : 'unsafe'}; passengers ${passengerSafe ? 'safe' : 'not confirmed safe'}`,
        branding: resolvedBranding,
        generatedAt,
        verificationCode: doc.id.slice(0, 8).toUpperCase(),
        documentHash: doc.hash || undefined,
      };
      element = React.createElement(
        IncidentRecordDocument as React.ComponentType<{ data: IncidentRecordData }>,
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
