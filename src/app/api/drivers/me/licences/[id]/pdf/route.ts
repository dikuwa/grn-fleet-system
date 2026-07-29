/**
 * GET /api/drivers/me/licences/[id]/pdf
 *
 * Generates a downloadable PDF of the driver's driving licence with
 * tenant branding, licence details, and QR verification code.
 */

import { NextRequest, NextResponse } from 'next/server';
import React from 'react';
import { renderToStream } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { getDb } from '@/db';
import { driverLicences, driverProfiles, employees } from '@/db/schema/people';
import { tenants } from '@/db/schema/tenants';
import { requireRequestAuth, hasPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq } from 'drizzle-orm';
import { resolveTenantBranding } from '@/lib/tenant-branding';
import { DriverLicenceDocument, type DriverLicenceData } from '@/lib/pdf/driver-licence';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const { id: licenceId } = await params;

    const db = getDb();

    // Fetch the licence record with owner info
    const [licence] = await db
      .select({
        licenceId: driverLicences.id,
        licenceNumber: driverLicences.licenceNumber,
        licenceClass: driverLicences.licenceClass,
        issueDate: driverLicences.issueDate,
        expiryDate: driverLicences.expiryDate,
        holderName: driverLicences.holderName,
        driverRestrictionCode: driverLicences.driverRestrictionCode,
        issueNumber: driverLicences.issueNumber,
        allowedVehicleCategories: driverLicences.allowedVehicleCategories,
        nationalIdNumber: driverLicences.nationalIdNumber,
        verificationStatus: driverLicences.verificationStatus,
        documentVersion: driverLicences.version,
        profileId: driverProfiles.id,
        employeeId: driverProfiles.employeeId,
        employeeUserId: employees.userId,
        employeeName: employees.firstName,
        employeeLastName: employees.lastName,
        tenantId: employees.tenantId,
      })
      .from(driverLicences)
      .innerJoin(driverProfiles, eq(driverProfiles.id, driverLicences.driverProfileId))
      .innerJoin(employees, eq(employees.id, driverProfiles.employeeId))
      .where(eq(driverLicences.id, licenceId))
      .limit(1);

    if (!licence) {
      return NextResponse.json({ error: 'Licence not found' }, { status: 404 });
    }

    // Security: user must own the licence or have DRIVER_MANAGE permission
    const isOwn = licence.employeeUserId === session.user.id;
    const canManage = await hasPermission(session, Permissions.DRIVER_MANAGE);
    if (!isOwn && !canManage) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Resolve tenant branding
    const resolvedBranding = await resolveTenantBranding(licence.tenantId);
    const [tenant] = await db
      .select({ name: tenants.name, id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, licence.tenantId))
      .limit(1);

    // Generate verification code and QR
    const verificationCode = licence.licenceId.slice(0, 8).toUpperCase();
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const verificationUrl = `${baseUrl}/v/${verificationCode}`;
    const qrCode = await QRCode.toDataURL(verificationUrl, {
      width: 200,
      margin: 1,
      color: { dark: '#1F2A44', light: '#FFFFFF' },
    });

    // Build the name from the licence holder or employee record
    const holderName =
      licence.holderName ||
      `${licence.employeeName} ${licence.employeeLastName}`.trim();

    const data: DriverLicenceData = {
      licenceId: licence.licenceId,
      holderName,
      licenceClass: licence.licenceClass,
      licenceNumber: licence.licenceNumber,
      issueDate: new Date(licence.issueDate).toLocaleDateString('en-NA', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
      expiryDate: new Date(licence.expiryDate).toLocaleDateString('en-NA', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
      driverRestrictionCode: licence.driverRestrictionCode || undefined,
      issueNumber: licence.issueNumber || undefined,
      allowedVehicleCategories: licence.allowedVehicleCategories || undefined,
      nationalIdNumber: licence.nationalIdNumber || undefined,
      tenantName: tenant?.name,
      branding: resolvedBranding,
      verificationCode,
      verificationUrl,
      qrCode,
      documentVersion: licence.documentVersion,
      generatedAt: new Date().toISOString(),
      status: licence.verificationStatus,
    };

    // Render PDF
    const element = React.createElement(DriverLicenceDocument, { data });
    const stream = await renderToStream(
      element as unknown as React.ReactElement<Record<string, unknown>>,
    );

    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(new Uint8Array(chunk as unknown as ArrayBuffer));
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const buffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }

    const filename = `Driving-Licence-${licence.licenceNumber.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (error) {
    console.error('[licences/pdf] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to generate licence PDF: ' + String(error) },
      { status: 500 },
    );
  }
}
