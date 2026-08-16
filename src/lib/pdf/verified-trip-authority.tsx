import React from 'react';
import QRCode from 'qrcode';
import { renderToStream } from '@react-pdf/renderer';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalParties } from '@/db/schema/external-parties';
import { vehicles } from '@/db/schema/fleet';
import { departments, driverLicences, driverProfiles, employees } from '@/db/schema/people';
import { requestGoodsEquipment, requestRoutes, transportRequests } from '@/db/schema/requests';
import {
  inspectionItemResults,
  inspectionTemplateItems,
  tripAuthorities,
  tripAuthorityPassengers,
  tripAuthorisedDrivers,
  tripIssues,
  trips,
  vehicleAllocations,
  vehicleInspections,
} from '@/db/schema/trips';
import { tenantBranding, tenants } from '@/db/schema/tenants';
import { resolveTenantDocumentBranding } from '@/lib/tenant-branding';
import { abbreviatedDocumentHash } from '@/lib/document-verification';
import { TripAuthorityDocument, type TripAuthorityData } from './trip-authority';

function snapshotText(snapshot: Record<string, unknown> | null | undefined, key: string) {
  const value = snapshot?.[key];
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text || undefined;
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
 * Render a Trip Authority from the generated-document identity.
 * The generated document owns the permanent verification code/slug while the
 * operational tables remain the source of trip, vehicle, driver and approval data.
 */
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

  const allocationId = document.entityId;
  const tenantId = document.tenantId;
  const [alloc] = await db
    .select()
    .from(vehicleAllocations)
    .where(eq(vehicleAllocations.id, allocationId))
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
  const routes = await db.select().from(requestRoutes).where(eq(requestRoutes.requestId, req.id));
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
    .where(eq(requestGoodsEquipment.requestId, req.id))
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
  let departureInspectionStatus: string | undefined;
  let departureInspectionDate: string | undefined;
  let fuelInformation: TripAuthorityData['fuelInformation'] | undefined;

  if (authority) {
    const passengerRows = await db
      .select()
      .from(tripAuthorityPassengers)
      .where(eq(tripAuthorityPassengers.authorityId, authority.id));
    passengers = passengerRows.map((passenger) => ({
      name: passenger.fullName,
      employeeNumber: passenger.employeeNumber || undefined,
      department: passenger.officeOrDepartment || undefined,
      contactNumber: passenger.contactNumber || undefined,
      passengerType: passenger.passengerType,
      destination: passenger.destination || undefined,
      indemnityConfirmed: passenger.indemnityConfirmed,
    }));

    const internalDriverRows = await db
      .select({
        driverType: tripAuthorisedDrivers.driverType,
        employeeNumber: tripAuthorisedDrivers.employeeNumber,
        licenceNumberMasked: tripAuthorisedDrivers.licenceNumberMasked,
        firstName: employees.firstName,
        lastName: employees.lastName,
        jobTitle: employees.jobTitle,
        phone: employees.phone,
        nationalIdNumber: employees.nationalIdNumber,
        departmentName: departments.name,
        licenceClass: tripAuthorisedDrivers.licenceClass,
        licenceExpiry: tripAuthorisedDrivers.licenceExpiry,
        verifiedLicenceNumber: driverLicences.licenceNumber,
        verifiedLicenceClass: driverLicences.licenceClass,
        verifiedLicenceExpiry: driverLicences.expiryDate,
      })
      .from(tripAuthorisedDrivers)
      .innerJoin(employees, eq(employees.id, tripAuthorisedDrivers.employeeId))
      .leftJoin(
        departments,
        and(eq(departments.id, employees.departmentId), eq(departments.tenantId, tenantId)),
      )
      .leftJoin(driverProfiles, eq(driverProfiles.employeeId, tripAuthorisedDrivers.employeeId))
      .leftJoin(
        driverLicences,
        and(
          eq(driverLicences.driverProfileId, driverProfiles.id),
          eq(driverLicences.isActive, true),
          eq(driverLicences.isVerified, true),
        ),
      )
      .where(eq(tripAuthorisedDrivers.authorityId, authority.id));

    const primary = internalDriverRows.find((row) => row.driverType === 'primary');
    if (primary) {
      driver = {
        name: `${primary.firstName} ${primary.lastName}`.trim(),
        employeeNumber: primary.employeeNumber || undefined,
        idNumber: primary.nationalIdNumber || undefined,
        designation: primary.jobTitle || undefined,
        department: primary.departmentName || undefined,
        contactNumber: primary.phone || undefined,
        licenceNumber: primary.verifiedLicenceNumber || primary.licenceNumberMasked || undefined,
        licenceClass: primary.verifiedLicenceClass || primary.licenceClass || undefined,
        licenceExpiry:
          primary.verifiedLicenceExpiry || primary.licenceExpiry?.toLocaleDateString('en-NA'),
        acceptedAt: authority.acceptedAt?.toLocaleString('en-NA'),
      };
    }
    additionalDrivers = internalDriverRows
      .filter((row) => row.driverType !== 'primary')
      .map((row) => ({
        name: `${row.firstName} ${row.lastName}`.trim(),
        employeeNumber: row.employeeNumber || undefined,
        idNumber: row.nationalIdNumber || undefined,
        department: row.departmentName || undefined,
        contactNumber: row.phone || undefined,
        licenceNumber: row.verifiedLicenceNumber || row.licenceNumberMasked || undefined,
        licenceClass: row.verifiedLicenceClass || row.licenceClass || undefined,
        licenceExpiry: row.verifiedLicenceExpiry || row.licenceExpiry?.toLocaleDateString('en-NA'),
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
        .innerJoin(externalParties, eq(externalParties.id, externalDriverAssignments.externalPartyId))
        .where(
          and(
            eq(externalDriverAssignments.tenantId, tenantId),
            eq(externalDriverAssignments.allocationId, allocationId),
            eq(externalParties.tenantId, tenantId),
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

    const [allocationTrip] = authority.tripId
      ? [{ id: authority.tripId }]
      : await db
          .select({ id: trips.id })
          .from(trips)
          .where(and(eq(trips.tenantId, tenantId), eq(trips.allocationId, allocationId)))
          .orderBy(desc(trips.createdAt))
          .limit(1);
    const inspectionTripId = allocationTrip?.id;
    const [departureInspection] = inspectionTripId
      ? await db
          .select()
          .from(vehicleInspections)
          .where(
            and(
              eq(vehicleInspections.tenantId, tenantId),
              eq(vehicleInspections.vehicleId, alloc.vehicleId),
              eq(vehicleInspections.tripId, inspectionTripId),
              eq(vehicleInspections.type, 'departure'),
            ),
          )
          .orderBy(desc(vehicleInspections.createdAt))
          .limit(1)
      : [];
    if (departureInspection) {
      departureInspectionStatus = departureInspection.status;
      departureInspectionDate = departureInspection.createdAt.toISOString();
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
        completedAt: departureInspection.createdAt.toISOString(),
      };
    }

    const authoriserSnapshot = authority.authoriserSnapshot as {
      employeeId?: string;
      capacity?: string;
      isActing?: boolean;
    } | null;
    let authoriserEmployee:
      | { firstName: string; lastName: string; jobTitle: string | null }
      | undefined;
    if (authoriserSnapshot?.employeeId) {
      [authoriserEmployee] = await db
        .select({ firstName: employees.firstName, lastName: employees.lastName, jobTitle: employees.jobTitle })
        .from(employees)
        .where(and(eq(employees.id, authoriserSnapshot.employeeId), eq(employees.tenantId, tenantId)))
        .limit(1);
    } else if (authority.authorisedByUserId) {
      [authoriserEmployee] = await db
        .select({ firstName: employees.firstName, lastName: employees.lastName, jobTitle: employees.jobTitle })
        .from(employees)
        .where(and(eq(employees.userId, authority.authorisedByUserId), eq(employees.tenantId, tenantId)))
        .limit(1);
    }
    if (authoriserEmployee) {
      authoriser = {
        name: `${authoriserEmployee.firstName} ${authoriserEmployee.lastName}`.trim(),
        designation: authoriserSnapshot?.capacity || authoriserEmployee.jobTitle || 'Authorising Officer',
        authorisedAt: authority.authorisedAt?.toLocaleString('en-NA'),
      };
    }

    const [physicalIssue] = inspectionTripId
      ? await db
          .select({
            issuedByUserId: tripIssues.issuedByUserId,
            issuedAt: tripIssues.issuedAt,
          })
          .from(tripIssues)
          .where(and(eq(tripIssues.tripId, inspectionTripId), eq(tripIssues.allocationId, allocationId)))
          .orderBy(desc(tripIssues.issuedAt))
          .limit(1)
      : [];
    const transportOfficerUserId = physicalIssue?.issuedByUserId || alloc.allocatedByUserId;
    const [transportEmployee] = transportOfficerUserId
      ? await db
          .select({ firstName: employees.firstName, lastName: employees.lastName, jobTitle: employees.jobTitle })
          .from(employees)
          .where(and(eq(employees.tenantId, tenantId), eq(employees.userId, transportOfficerUserId)))
          .limit(1)
      : [];
    if (transportEmployee) {
      transportOfficer = {
        name: `${transportEmployee.firstName} ${transportEmployee.lastName}`.trim(),
        designation: transportEmployee.jobTitle || 'Transport Officer',
        issuedAt: (physicalIssue?.issuedAt || alloc.createdAt).toLocaleString('en-NA'),
      };
    }

    if (vehicle?.fuelCardNumber || vehicle?.fuelType) {
      fuelInformation = {
        fuelCardNumber: vehicle.fuelCardNumber || undefined,
        fuelType: vehicle.fuelType || undefined,
      };
    }
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const verificationUrl = `${baseUrl}/v/${document.verificationSlug}`;
  const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, { width: 220, margin: 1 });
  const visibleHash = abbreviatedDocumentHash(document.hash) || undefined;

  const data: TripAuthorityData = {
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
      modelYear: vehicle?.manufactureYear || undefined,
      colour: vehicle?.colour || undefined,
      fuelType: vehicle?.fuelType || undefined,
      currentOdometer: vehicle?.currentOdometer || undefined,
      inspectionStatus: departureInspectionStatus,
      inspectionDate: departureInspectionDate,
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
    verificationCode: document.verificationCode,
    verificationUrl,
    documentHash: visibleHash,
    qrCodeDataUrl,
  };

  const element = React.createElement(
    TripAuthorityDocument as React.ComponentType<{ data: TripAuthorityData }>,
    { data },
  ) as React.ReactElement;
  const buffer = await renderPdfToBuffer(element);
  return { buffer, filename: `trip_authority_${document.id.slice(0, 8)}.pdf` };
}
