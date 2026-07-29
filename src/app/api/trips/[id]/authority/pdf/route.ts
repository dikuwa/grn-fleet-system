import React from 'react';
import QRCode from 'qrcode';
import { renderToStream } from '@react-pdf/renderer';
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  tripAuthorities,
  tripAuthorityPassengers,
  tripAuthorisedDrivers,
  vehicleAllocations,
  vehicleInspections,
  inspectionItemResults,
  inspectionTemplateItems,
} from '@/db/schema/trips';
import { departments, employees } from '@/db/schema/people';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests, requestRoutes } from '@/db/schema/requests';
import { tenantBranding, tenants } from '@/db/schema/tenants';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { TripAuthorityDocument, type TripAuthorityData } from '@/lib/pdf/trip-authority';
import { resolveTenantBranding } from '@/lib/tenant-branding';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permission = await requirePermission(session, Permissions.FILE_VIEW);
    if (permission instanceof NextResponse) return permission;
    const { id } = await params;
    const db = getDb();
    const [authority] = await db
      .select({
        authority: tripAuthorities,
        requestReference: transportRequests.reference,
        scope: transportRequests.scope,
        authorisedKm: transportRequests.totalAuthorisedKilometres,
        purpose: transportRequests.purpose,
        department: transportRequests.department,
        requestingOfficeSnapshot: transportRequests.requestingOfficeSnapshot,
        requesterEmployeeId: transportRequests.requesterEmployeeId,
        tenantName: tenants.name,
        footer: tenantBranding.documentFooter,
        registration: vehicles.licenceNumber,
        registerNumber: vehicles.vehicleRegisterNumber,
        make: vehicles.make,
        model: vehicles.model,
        colour: vehicles.colour,
        fuelType: vehicles.fuelType,
        currentOdometer: vehicles.currentOdometer,
        fuelCardNumber: vehicles.fuelCardNumber,
        vehicleId: vehicles.id,
        allocatedByUserId: vehicleAllocations.allocatedByUserId,
      })
      .from(tripAuthorities)
      .innerJoin(transportRequests, eq(transportRequests.id, tripAuthorities.requestId))
      .innerJoin(tenants, eq(tenants.id, tripAuthorities.tenantId))
      .leftJoin(tenantBranding, eq(tenantBranding.tenantId, tenants.id))
      .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, tripAuthorities.allocationId))
      .innerJoin(vehicles, eq(vehicles.id, vehicleAllocations.vehicleId))
      .where(and(eq(tripAuthorities.tripId, id), eq(tripAuthorities.tenantId, session.tenantId)))
      .limit(1);
    if (!authority)
      return NextResponse.json({ error: 'Trip Authority not found' }, { status: 404 });

    const [passengers, drivers, departureInspections, authoriserEmployee, transportOfficerEmployee, requesterName, routeRows] = await Promise.all([
      db
        .select()
        .from(tripAuthorityPassengers)
        .where(eq(tripAuthorityPassengers.authorityId, authority.authority.id)),
      db
        .select({
          driverType: tripAuthorisedDrivers.driverType,
          employeeNumber: tripAuthorisedDrivers.employeeNumber,
          licenceNumber: tripAuthorisedDrivers.licenceNumberMasked,
          licenceClass: tripAuthorisedDrivers.licenceClass,
          licenceExpiry: tripAuthorisedDrivers.licenceExpiry,
          firstName: employees.firstName,
          lastName: employees.lastName,
          jobTitle: employees.jobTitle,
          phone: employees.phone,
          departmentName: departments.name,
        })
        .from(tripAuthorisedDrivers)
        .innerJoin(employees, eq(employees.id, tripAuthorisedDrivers.employeeId))
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .where(eq(tripAuthorisedDrivers.authorityId, authority.authority.id)),
      // Latest departure inspection for the allocated vehicle
      db
        .select()
        .from(vehicleInspections)
        .where(and(
          eq(vehicleInspections.vehicleId, authority.vehicleId),
          eq(vehicleInspections.type, 'departure'),
        ))
        .orderBy(desc(vehicleInspections.createdAt))
        .limit(1),
      // Resolve authoriser name from authoriserSnapshot.employeeId
      (async () => {
        const snap = authority.authority.authoriserSnapshot as { employeeId?: string } | null;
        if (!snap?.employeeId) return null;
        const [emp] = await db
          .select({
            firstName: employees.firstName,
            lastName: employees.lastName,
            jobTitle: employees.jobTitle,
          })
          .from(employees)
          .where(eq(employees.id, snap.employeeId))
          .limit(1);
        return emp;
      })(),
      // Resolve transport officer from allocation's allocatedByUserId
      (async () => {
        if (!authority.allocatedByUserId) return null;
        const [emp] = await db
          .select({
            firstName: employees.firstName,
            lastName: employees.lastName,
            jobTitle: employees.jobTitle,
          })
          .from(employees)
          .where(eq(employees.userId, authority.allocatedByUserId))
          .limit(1);
        return emp || null;
      })(),
      // Resolve requester name from transport request's requesterEmployeeId
      (async () => {
        if (!authority.requesterEmployeeId) return null;
        const [emp] = await db
          .select({
            firstName: employees.firstName,
            lastName: employees.lastName,
          })
          .from(employees)
          .where(eq(employees.id, authority.requesterEmployeeId))
          .limit(1);
        return emp ? `${emp.firstName} ${emp.lastName}` : null;
      })(),
      // Fetch request routes for journey legs
      db
        .select()
        .from(requestRoutes)
        .where(eq(requestRoutes.requestId, authority.authority.requestId)),
    ]);

    // Fetch inspection items if a departure inspection exists
    let inspectionItems: Array<{ label: string; result: string; comment: string | null }> = [];
    if (departureInspections && departureInspections.length > 0) {
      const insp = departureInspections[0];
      const results = await db
        .select({
          result: inspectionItemResults.result,
          comment: inspectionItemResults.comment,
          label: inspectionTemplateItems.label,
        })
        .from(inspectionItemResults)
        .innerJoin(inspectionTemplateItems, eq(inspectionTemplateItems.id, inspectionItemResults.templateItemId))
        .where(eq(inspectionItemResults.inspectionId, insp.id));
      inspectionItems = results;
    }

    const branding = await resolveTenantBranding(session.tenantId);
    const primary = drivers.find((driver) => driver.driverType === 'primary');
    const token = (authority.authority.data as { verificationToken?: string } | null)
      ?.verificationToken;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const verificationUrl = token
      ? `${baseUrl}/verify/authority/${encodeURIComponent(token)}`
      : undefined;
    const qrCodeDataUrl = verificationUrl
      ? await QRCode.toDataURL(verificationUrl, { width: 220, margin: 1 })
      : undefined;
    const distance =
      authority.authority.beginningOdometer !== null && authority.authority.endingOdometer !== null
        ? authority.authority.endingOdometer - authority.authority.beginningOdometer
        : (authority.authorisedKm ?? undefined);

    const data: TripAuthorityData = {
      reference: authority.authority.authorityNumber || authority.requestReference,
      tenantName: authority.tenantName,
      tenantDocumentFooter: authority.footer || undefined,
      branding,
      vehicle: {
        licenceNumber: authority.registration,
        vehicleRegisterNumber: authority.registerNumber || 'N/A',
        make: authority.make,
        model: authority.model,
        colour: authority.colour || undefined,
        fuelType: authority.fuelType,
        currentOdometer: authority.currentOdometer || undefined,
      },
      requestReference: authority.requestReference,
      scope: authority.scope,
      startAt: authority.authority.validFrom?.toLocaleString('en-NA') || 'Not set',
      endAt: authority.authority.validUntil?.toLocaleString('en-NA') || 'Not set',
      purpose: authority.authority.purpose || undefined,
      department: authority.department || undefined,
      requesterName: requesterName || undefined,
      transportOffice: authority.requestingOfficeSnapshot || undefined,
      routeSummary: authority.authority.approvedRoute || undefined,
      totalKm: distance,
      journeyLegs: routeRows && routeRows.length > 0
        ? routeRows.map((r) => ({
            origin: r.originName || 'Not specified',
            destination: r.destinationName || 'Not specified',
            departureDate: authority.authority.validFrom?.toISOString().split('T')[0] || 'Not set',
            returnDate: authority.authority.validUntil?.toISOString().split('T')[0] || 'Not set',
            estimatedKm: r.totalKilometres ?? r.mappedDistanceKm ?? undefined,
          }))
        : undefined,
      authorisation: {
        authoriserName: authoriserEmployee
          ? `${authoriserEmployee.firstName} ${authoriserEmployee.lastName}`
          : authority.authority.authorisedByUserId
            ? 'Authorising officer'
            : 'Not recorded',
        authoriserRole: authoriserEmployee?.jobTitle || 'Authorising Officer',
        authorisedAt: authority.authority.authorisedAt?.toLocaleString('en-NA'),
        transportOfficerName: transportOfficerEmployee
          ? `${transportOfficerEmployee.firstName} ${transportOfficerEmployee.lastName}`
          : 'Not recorded',
        transportOfficerRole: transportOfficerEmployee?.jobTitle || 'Transport Officer',
        issueDate: authority.authority.issuedAt?.toLocaleString('en-NA') || 'Not recorded',
        approvalMethod: 'Digitally authorised',
      },
      authorityStatus: authority.authority.status.replaceAll('_', ' '),
      documentVersion: authority.authority.version,
      issuedAt: authority.authority.issuedAt?.toISOString(),
      verificationCode: authority.authority.authorityNumber || undefined,
      verificationUrl,
      qrCodeDataUrl,
      specialConditions: authority.authority.specialConditions || undefined,
      beginningOdometer: authority.authority.beginningOdometer || undefined,
      endingOdometer: authority.authority.endingOdometer || undefined,
      driver: primary
        ? {
            name: `${primary.firstName} ${primary.lastName}`,
            employeeNumber: primary.employeeNumber || undefined,
            designation: primary.jobTitle || undefined,
            licenceNumber: primary.licenceNumber || undefined,
            licenceClass: primary.licenceClass || undefined,
            licenceExpiry: primary.licenceExpiry?.toLocaleDateString('en-NA'),
            department: primary.departmentName || undefined,
            contactNumber: primary.phone || undefined,
            acceptedAt: authority.authority.acceptedAt?.toLocaleString('en-NA'),
          }
        : undefined,
      passengers: passengers.map((passenger) => ({
        name: passenger.fullName,
        employeeNumber: passenger.employeeNumber || undefined,
        passengerType: passenger.passengerType.replaceAll('_', ' '),
        destination: passenger.destination || undefined,
        indemnityConfirmed: passenger.indemnityConfirmed,
      })),
      authoriser: (authoriserEmployee || authority.authority.authorisedByUserId)
        ? {
            name: authoriserEmployee
              ? `${authoriserEmployee.firstName} ${authoriserEmployee.lastName}`
              : 'Authorising officer',
            designation: authoriserEmployee?.jobTitle || 'Authorising Officer',
            authorisedAt: authority.authority.authorisedAt?.toLocaleString('en-NA'),
          }
        : undefined,
      additionalDrivers: drivers
        .filter((driver) => driver.driverType !== 'primary')
        .map((driver) => ({
          name: `${driver.firstName} ${driver.lastName}`,
          employeeNumber: driver.employeeNumber || undefined,
          licenceClass: driver.licenceClass || undefined,
          licenceExpiry: driver.licenceExpiry?.toLocaleDateString('en-NA'),
        })),
      transportOfficer: transportOfficerEmployee
        ? {
            name: `${transportOfficerEmployee.firstName} ${transportOfficerEmployee.lastName}`,
            designation: transportOfficerEmployee.jobTitle || 'Transport Officer',
            issuedAt: authority.authority.issuedAt?.toLocaleString('en-NA'),
          }
        : undefined,
      goodsAndEquipment: authority.authority.purpose
        ? [{ description: 'Authorised cargo per trip purpose', purpose: authority.authority.purpose }]
        : undefined,
      preDepartureInspection: departureInspections && departureInspections.length > 0
        ? {
            status: departureInspections[0].status,
            odometer: departureInspections[0].odometerReading || undefined,
            items: inspectionItems.length > 0
              ? inspectionItems.map((item) => ({
                  label: item.label,
                  result: item.result,
                  comment: item.comment || undefined,
                }))
              : undefined,
            notes: departureInspections[0].notes || undefined,
            completedAt: departureInspections[0].createdAt.toLocaleString('en-NA'),
          }
        : undefined,
      fuelInformation: (() => {
        const info: { fuelCardNumber?: string; expectedFuel?: string; fuelType?: string; costCentre?: string } = {};
        if (authority.fuelCardNumber) info.fuelCardNumber = authority.fuelCardNumber;
        if (authority.fuelType) info.fuelType = authority.fuelType;
        if (authority.authorisedKm) {
          info.expectedFuel = `${Math.round(authority.authorisedKm / 8)} L (est.)`;
        }
        return Object.keys(info).length > 0 ? info : undefined;
      })(),
    };

    const element = React.createElement(TripAuthorityDocument, { data });
    const stream = await renderToStream(
      element as unknown as React.ReactElement<Record<string, unknown>>,
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(new Uint8Array(chunk as unknown as ArrayBuffer));
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const buffer = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    const filename = `${(authority.authority.authorityNumber || 'trip-authority').replace(/[^A-Za-z0-9-]/g, '-')}-v${authority.authority.version}.pdf`;
    return new NextResponse(buffer as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[trip-authority/pdf] failed:', error);
    return NextResponse.json(
      { error: 'Official Trip Authority PDF could not be generated' },
      { status: 500 },
    );
  }
}
