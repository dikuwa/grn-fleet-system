/**
 * PDF Generation Service
 *
 * Renders React-PDF document components to binary PDF buffers.
 * Provides helper functions for generating Trip Authority and Inspection Report PDFs
 * from snapshot data stored in the document store.
 */

import React from 'react';
import { renderToStream } from '@react-pdf/renderer';
import { TripAuthorityDocument, type TripAuthorityData } from './trip-authority.js';
import { InspectionReportDocument, type InspectionReportData } from './inspection-report.js';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { vehicles } from '@/db/schema/fleet';
import { vehicleAllocations, vehicleInspections } from '@/db/schema/trips';
import { transportRequests, requestRoutes } from '@/db/schema/requests';
import { tenants, tenantBranding } from '@/db/schema/tenants';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  // Get branding info for document footer
  const [branding] = await db
    .select()
    .from(tenantBranding)
    .where(eq(tenantBranding.tenantId, tenantId))
    .limit(1);

  // Build route summary
  let routeSummary: string | undefined;
  let totalKm: number | undefined;
  if (req) {
    const routes = await db
      .select()
      .from(requestRoutes)
      .where(eq(requestRoutes.requestId, req.id));

    if (routes.length > 0) {
      routeSummary = routes
        .map((r) => `${r.originName} → ${r.destinationName}`)
        .join('; ');
      totalKm = routes.reduce((sum, r) => sum + (r.totalKilometres ?? r.mappedDistanceKm ?? 0), 0);
    }
  }

  const data: TripAuthorityData = {
    reference: alloc.id.slice(0, 8).toUpperCase(),
    tenantName: tenant?.name,
    tenantDocumentFooter: branding?.documentFooter || undefined,
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

  const element = React.createElement(TripAuthorityDocument as React.ComponentType<any>, { data }) as React.ReactElement;
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

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const [branding] = await db
    .select()
    .from(tenantBranding)
    .where(eq(tenantBranding.tenantId, tenantId))
    .limit(1);

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
    inspectorName: undefined,
    driverName: undefined,
    items: [],
  };

  const element = React.createElement(InspectionReportDocument as React.ComponentType<any>, { data }) as React.ReactElement;
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
    default:
      return null;
  }

  if (!buffer) return null;

  const filename = `${doc.documentType}_${doc.id.slice(0, 8)}.pdf`;

  return { buffer, filename };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function renderPdfToBuffer(element: React.ReactElement): Promise<Uint8Array> {
  const stream = await renderToStream(element as any);
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
