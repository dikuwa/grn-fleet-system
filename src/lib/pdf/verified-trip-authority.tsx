import React from 'react';
import QRCode from 'qrcode';
import { renderToStream } from '@react-pdf/renderer';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalParties } from '@/db/schema/external-parties';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { requestGoodsEquipment, requestRoutes, transportRequests } from '@/db/schema/requests';
import {
  inspectionItemResults,
  inspectionTemplateItems,
  tripAuthorities,
  tripAuthorityPassengers,
  tripAuthorisedDrivers,
  vehicleAllocations,
  vehicleInspections,
} from '@/db/schema/trips';
import { tenantBranding, tenants } from '@/db/schema/tenants';
import { resolveTenantDocumentBranding } from '@/lib/tenant-branding';
import { abbreviatedDocumentHash } from '@/lib/document-verification';
import { TripAuthorityDocument, type TripAuthorityData } from './trip-authority';

type TripAuthorityRenderSnapshot = Omit<
  TripAuthorityData,
  'verificationCode' | 'verificationUrl' | 'documentHash' | 'qrCodeDataUrl'
>;

function snapshotText(snapshot: Record<string, unknown> | null | undefined, key: string) {
  const value = snapshot?.[key];
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function isStoredTripAuthorityRenderSnapshot(value: unknown): value is TripAuthorityRenderSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.reference === 'string' &&
    typeof data.requestReference === 'string' &&
    typeof data.startAt === 'string' &&
    typeof data.endAt === 'string' &&
    !!data.vehicle &&
    typeof data.vehicle === 'object'
  );
}

async function renderPdfToBuffer(element: React.ReactElement): Promise<Uint8Array> {
  const stream = await renderToStream(
    element as unknown as React.ReactElement<Record<string, unknown>>,
  );
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(new Uint8Array(chunk as unknown as ArrayBuffer));
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Build the complete visual payload for a Trip Authority.
 *
 * New generated-document versions persist this payload as snapshotData.renderData
 * so the official PDF is immutable after generation. This builder remains the
 * compatibility path for historical thin snapshots.
 */
export async function buildTripAuthorityRenderSnapshot(
  documentId: string,
): Promise<TripAuthorityRenderSnapshot | null> {
  const db = getDb();
  const [document] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, documentId))
    .limit(1);
  if (!document || document.documentType !== 'trip_authority' || document.entityType !== 'vehicle_allocation') {
    return null;
  }

  const allocationId = document.entityId;
  const tenantId = document.tenantId;
  const [alloc] = await db
    .select()
    .from(vehicleAllocations)
    .where(
      and(
        eq(vehicleAllocations.id, allocationId),
        eq(vehicleAllocations.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!alloc) return null;

  const [[req], [vehicle], [tenant], [branding], [authority]] = await Promise.all([
    db.select().from(transportRequests).where(and(eq(transportRequests.id, alloc.requestId), eq(transportRequests.tenantId, tenantId))).limit(1),
    db.select().from(vehicles).where(and(eq(vehicles.id, alloc.vehicleId), eq(vehicles.tenantId, tenantId))).limit(1),
    db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1),
    db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId)).limit(1),
    db
      .select()
      .from(tripAuthorities)
      .where(and(eq(tripAuthorities.allocationId, allocationId), eq(tripAuthorities.tenantId, tenantId)))
      .orderBy(desc(tripAuthorities.createdAt))
      .limit(1),
  ]);
  if (!req) return null;

  const resolvedBranding = await resolveTenantDocumentBranding(tenantId);
  const routes = await db
    .select()
    .from(requestRoutes)
    .where(and(eq(requestRoutes.requestId, req.id), eq(requestRoutes.tenantId, tenantId)));
  const routeSummary = routes.length
    ? routes.map((route) => `${route.originName} → ${route.destinationName}`).join('; ')
    : undefined;
  const totalKm = routes.reduce(
    (sum, route) => sum + (route.totalKilometres ?? route.mappedDistanceKm ?? 0),
    0,
  ) || undefined;
  const journeyLegs: TripAuthorityData['journeyLegs'] = routes.map((route) => ({
    origin: route.originName || 'Not specified',
    destination: route.destinationName || 'Not specified',
    departureDate: alloc.startAt.toISOString().split('T')[0],
    returnDate: alloc.endAt.toISOString().split('T')[0],
    estimatedKm: route.totalKilometres ?? route.mappedDistanceKm ?? undefined,
  }));

  const goodsRows = await db
    .select({
      description: requestGoodsEquipment.description,
      quantity: requestGoodsEquipment.quantity,
      purpose: requestGoodsEquipment.purpose,
    })
    .from(requestGoodsEquipment)
    .where(and(eq(requestGoodsEquipment.requestId, req.id), eq(requestGoodsEquipment.tenantId, tenantId)))
    .orderBy(requestGoodsEquipment.sortOrder);

  let requesterName: string | undefined;
  if (req.requesterType === 'external' && req.externalRequesterId) {
    const [externalRequester] = await db
      .select({ firstName: externalParties.firstName, lastName: externalParties.lastName })
      .from(externalParties)
      .where(and(eq(externalParties.id, req.externalRequesterId), eq(externalParties.tenantId, tenantId)))
      .limit(1);
    requesterName = externalRequester
      ? `${externalRequester.firstName} ${externalRequester.lastName}`.trim()
      : undefined;
  } else {
    const [internalRequester] = await db
      .select({
        name: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.middleName}, ${employees.lastName})`,
      })
      .from(employees)
      .where(and(eq(employees.id, req.requesterEmployeeId), eq(employees.tenantId, tenantId)))
      .limit(1);
    requesterName = internalRequester?.name || undefined;
  }

  let driver: TripAuthorityData['driver'] | undefined;
  let passengers: TripAuthorityData['passengers'] | undefined;
  let additionalDrivers: TripAuthorityData['additionalDrivers'] | undefined;
  let authoriser: TripAuthorityData['authoriser'] | undefined;
  let transportOfficer: TripAuthorityData['transportOfficer'] | undefined;
  let preDepartureInspection: TripAuthorityData['preDepartureInspection'] | undefined;
  let fuelInformation: TripAuthorityData['fuelInformation'] | undefined;

  if (authority) {
    const passengerRows = await db
      .select()
      .from(tripAuthorityPassengers)
      .where(
        and(
          eq(tripAuthorityPassengers.authorityId, authority.id),
          eq(tripAuthorityPassengers.tenantId, tenantId),
        ),
      );
    passengers = passengerRows.map((passenger) => ({
      name: passenger.fullName,
      employeeNumber: passenger.employeeNumber || undefined,
      passengerType: passenger.passengerType,
      destination: passenger.destination || undefined,
      indemnityConfirmed: passenger.indemnityConfirmed,
    }));

    const internalDriverRows = await db
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
      .innerJoin(
        employees,
        and(
          eq(employees.id, tripAuthorisedDrivers.employeeId),
          eq(employees.tenantId, tenantId),
        ),
      )
      .where(
        and(
          eq(tripAuthorisedDrivers.authorityId, authority.id),
          eq(tripAuthorisedDrivers.tenantId, tenantId),
        ),
      );

    const primary = internalDriverRows.find((row) => row.driverType === 'primary');
    if (primary) {
      driver = {
        name: `${primary.firstName} ${primary.lastName}`.trim(),
        employeeNumber: primary.employeeNumber || undefined,
        idNumber: primary.nationalIdNumber || undefined,
        designation: primary.jobTitle || undefined,
        contactNumber: primary.phone || undefined,
        licenceClass: primary.licenceClass || undefined,
        licenceExpiry: primary.licenceExpiry?.toLocaleDateString('en-NA'),
        acceptedAt: authority.acceptedAt?.toLocaleString('en-NA'),
      };
    }
    additionalDrivers = internalDriverRows
      .filter((row) => row.driverType !== 'primary')
      .map((row) => ({
        name: `${row.firstName} ${row.lastName}`.trim(),
        employeeNumber: row.employeeNumber || undefined,
        idNumber: row.nationalIdNumber || undefined,
        licenceClass: row.licenceClass || undefined,
        licenceExpiry: row.licenceExpiry?.toLocaleDateString('en-NA'),
      }));

    if (!driver) {
      const [external] = await db
        .select({
          assignment: externalDriverAssignments,
          firstName: externalParties.firstName,
          lastName: externalParties.lastName,
          organisationName: externalParties.organisationName,
          phone: externalParties.phone,
          idReference: externalParties.idReference,
        })
        .from(externalDriverAssignments)
        .innerJoin(
          externalParties,
          and(
            eq(externalParties.id, externalDriverAssignments.externalPartyId),
            eq(externalParties.tenantId, tenantId),
          ),
        )
        .where(
          and(
            eq(externalDriverAssignments.tenantId, tenantId),
            eq(externalDriverAssignments.allocationId, allocationId),
          ),
        )
        .orderBy(desc(externalDriverAssignments.assignedAt))
        .limit(1);
      if (external && external.assignment.state !== 'cancelled') {
        const licence = external.assignment.licenceSnapshot as Record<string, unknown>;
        driver = {
          name: `${external.firstName} ${external.lastName}`.trim(),
          idNumber: external.idReference || undefined,
          department: external.organisationName,
          contactNumber: external.phone || undefined,
          licenceNumber: snapshotText(licence, 'licenceNumber'),
          licenceClass: snapshotText(licence, 'licenceClass'),
          licenceExpiry: snapshotText(licence, 'expiryDate'),
          acceptedAt: external.assignment.acceptedAt?.toLocaleString('en-NA'),
        };
      }
    }

    // Scope the departure inspection to this exact trip as well as tenant and
    // vehicle. Without tripId, a later inspection for the same vehicle could be
    // rendered into an older verified authority.
    const [departureInspection] = await db
      .select()
      .from(vehicleInspections)
      .where(
        and(
          eq(vehicleInspections.tenantId, tenantId),
          eq(vehicleInspections.tripId, authority.tripId),
          eq(vehicleInspections.vehicleId, alloc.vehicleId),
          eq(vehicleInspections.type, 'departure'),
        ),
      )
      .orderBy(desc(vehicleInspections.createdAt))
      .limit(1);
    if (departureInspection) {
      const itemRows = await db
        .select({
          result: inspectionItemResults.result,
          comment: inspectionItemResults.comment,
          label: inspectionTemplateItems.label,
        })
        .from(inspectionItemResults)
        .innerJoin(inspectionTemplateItems, eq(inspectionTemplateItems.id, inspectionItemResults.templateItemId))
        .where(eq(inspectionItemResults.inspectionId, departureInspection.id));
      preDepartureInspection = {
        status: departureInspection.status,
        odometer: departureInspection.odometerReading || undefined,
        items: itemRows.map((item) => ({
          label: item.label,
          result: item.result,
          comment: item.comment || undefined,
        })),
        notes: departureInspection.notes || undefined,
        completedAt: departureInspection.createdAt.toLocaleString('en-NA'),
      };
    }

    const authoriserSnapshot = authority.authoriserSnapshot as { employeeId?: string } | null;
    if (authoriserSnapshot?.employeeId) {
      const [employee] = await db
        .select({ firstName: employees.firstName, lastName: employees.lastName, jobTitle: employees.jobTitle })
        .from(employees)
        .where(and(eq(employees.id, authoriserSnapshot.employeeId), eq(employees.tenantId, tenantId)))
        .limit(1);
      if (employee) {
        authoriser = {
          name: `${employee.firstName} ${employee.lastName}`.trim(),
          designation: employee.jobTitle || 'Authorising Officer',
          authorisedAt: authority.authorisedAt?.toLocaleString('en-NA'),
        };
      }
    }

    const [transportEmployee] = await db
      .select({ firstName: employees.firstName, lastName: employees.lastName, jobTitle: employees.jobTitle })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.userId, alloc.allocatedByUserId)))
      .limit(1);
    if (transportEmployee) {
      transportOfficer = {
        name: `${transportEmployee.firstName} ${transportEmployee.lastName}`.trim(),
        designation: transportEmployee.jobTitle || 'Transport Officer',
        issuedAt: authority.issuedAt?.toLocaleString('en-NA'),
      };
    }

    if (vehicle?.fuelCardNumber || vehicle?.fuelType) {
      fuelInformation = {
        fuelCardNumber: vehicle.fuelCardNumber || undefined,
        fuelType: vehicle.fuelType || undefined,
      };
    }
  }

  return {
    reference: authority?.authorityNumber || alloc.id.slice(0, 8).toUpperCase(),
    tenantName: tenant?.name,
    tenantDocumentFooter: branding?.documentFooter || undefined,
    branding: resolvedBranding,
    requestReference: req.reference,
    requesterName,
    department: req.requesterType === 'external' ? undefined : req.department || undefined,
    scope: req.scope || 'regional',
    startAt: alloc.startAt.toISOString().split('T')[0],
    endAt: alloc.endAt.toISOString().split('T')[0],
    purpose: req.purpose || undefined,
    routeSummary,
    totalKm,
    journeyLegs: journeyLegs.length ? journeyLegs : undefined,
    vehicle: {
      licenceNumber: vehicle?.licenceNumber || 'Not recorded',
      vehicleRegisterNumber: vehicle?.vehicleRegisterNumber || 'Not recorded',
      make: vehicle?.make || '',
      model: vehicle?.model || '',
      colour: vehicle?.colour || undefined,
      fuelType: vehicle?.fuelType || undefined,
      currentOdometer: vehicle?.currentOdometer || undefined,
    },
    driver,
    passengers,
    additionalDrivers,
    authoriser,
    transportOfficer,
    goodsAndEquipment: goodsRows.map((item) => ({
      description: item.description,
      quantity: item.quantity || undefined,
      purpose: item.purpose || undefined,
    })),
    preDepartureInspection,
    fuelInformation,
    specialConditions: authority?.specialConditions || undefined,
    beginningOdometer: authority?.beginningOdometer || undefined,
    endingOdometer: authority?.endingOdometer || undefined,
    authorityStatus: authority?.status || document.status,
    documentVersion: authority?.documentVersion || document.documentVersion,
    issuedAt: authority?.issuedAt?.toISOString() || document.createdAt.toISOString(),
  };
}

export async function generateVerifiedTripAuthorityPdf(
  documentId: string,
): Promise<{ buffer: Uint8Array; filename: string } | null> {
  const db = getDb();
  const [document] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, documentId))
    .limit(1);
  if (!document || document.documentType !== 'trip_authority' || document.entityType !== 'vehicle_allocation') {
    return null;
  }

  const snapshot = (document.snapshotData || {}) as Record<string, unknown>;
  const storedRenderData = snapshot.renderData;
  const renderSnapshot = isStoredTripAuthorityRenderSnapshot(storedRenderData)
    ? storedRenderData
    : await buildTripAuthorityRenderSnapshot(documentId);
  if (!renderSnapshot) return null;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const verificationUrl = `${baseUrl}/v/${document.verificationSlug}`;
  const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, { width: 220, margin: 1 });

  const data: TripAuthorityData = {
    ...renderSnapshot,
    verificationCode: document.verificationCode,
    verificationUrl,
    documentHash: abbreviatedDocumentHash(document.hash) || undefined,
    qrCodeDataUrl,
  };

  const element = React.createElement(
    TripAuthorityDocument as React.ComponentType<{ data: TripAuthorityData }>,
    { data },
  ) as React.ReactElement;
  const buffer = await renderPdfToBuffer(element);
  return { buffer, filename: `trip_authority_${document.id.slice(0, 8)}.pdf` };
}
