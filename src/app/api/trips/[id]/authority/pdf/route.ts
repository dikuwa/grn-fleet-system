import React from 'react';
import QRCode from 'qrcode';
import { renderToStream } from '@react-pdf/renderer';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  tripAuthorities,
  tripAuthorityPassengers,
  tripAuthorisedDrivers,
  tripIncidents,
  tripProgressEntries,
  vehicleAllocations,
} from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { vehicleDefects, vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
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
        tenantName: tenants.name,
        footer: tenantBranding.documentFooter,
        registration: vehicles.licenceNumber,
        registerNumber: vehicles.vehicleRegisterNumber,
        make: vehicles.make,
        model: vehicles.model,
        colour: vehicles.colour,
        fuelType: vehicles.fuelType,
        currentOdometer: vehicles.currentOdometer,
        department: transportRequests.department,
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

    const [passengers, drivers, progress, incidents, defects] = await Promise.all([
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
        })
        .from(tripAuthorisedDrivers)
        .innerJoin(employees, eq(employees.id, tripAuthorisedDrivers.employeeId))
        .where(eq(tripAuthorisedDrivers.authorityId, authority.authority.id)),
      db
        .select()
        .from(tripProgressEntries)
        .where(
          and(
            eq(tripProgressEntries.tripId, id),
            eq(tripProgressEntries.tenantId, session.tenantId),
          ),
        ),
      db
        .select()
        .from(tripIncidents)
        .where(and(eq(tripIncidents.tripId, id), eq(tripIncidents.tenantId, session.tenantId))),
      db.select().from(vehicleDefects).where(eq(vehicleDefects.tripId, id)),
    ]);
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
      routeSummary: authority.authority.approvedRoute || undefined,
      totalKm: distance,
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
      authoriser: {
        name: authority.authority.authorisedByUserId
          ? 'Authorising officer'
          : 'Authorising officer not recorded',
        authorisedAt: authority.authority.authorisedAt?.toLocaleString('en-NA'),
      },
      additionalDrivers: drivers
        .filter((driver) => driver.driverType !== 'primary')
        .map((driver) => ({
          name: `${driver.firstName} ${driver.lastName}`,
          employeeNumber: driver.employeeNumber || undefined,
          licenceClass: driver.licenceClass || undefined,
          licenceExpiry: driver.licenceExpiry?.toLocaleDateString('en-NA'),
        })),
      routeEntries: progress.map((entry) => ({
        occurredAt: entry.occurredAt.toLocaleString('en-NA'),
        type: entry.entryType,
        location: entry.location || undefined,
        odometer: entry.odometerReading || undefined,
        note: entry.note || undefined,
      })),
      defects: defects.map((defect) => ({
        severity: defect.severity,
        description: defect.description,
        status: defect.resolvedAt ? 'resolved' : 'open',
      })),
      incidents: incidents.map((incident) => ({
        type: incident.incidentType,
        occurredAt: incident.occurredAt.toLocaleString('en-NA'),
        description: incident.description,
        safeToContinue: incident.safeToContinue,
      })),
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
