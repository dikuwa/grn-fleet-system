import React from 'react';
import QRCode from 'qrcode';
import { renderToStream } from '@react-pdf/renderer';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalParties } from '@/db/schema/external-parties';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import {
  inspectionItemResults,
  inspectionTemplateItems,
  vehicleInspections,
} from '@/db/schema/trips';
import { tenantBranding, tenants } from '@/db/schema/tenants';
import { abbreviatedDocumentHash } from '@/lib/document-verification';
import { resolveTenantDocumentBranding } from '@/lib/tenant-branding';
import { InspectionReportDocument, type InspectionReportData } from './inspection-report';

type InspectionRenderSnapshot = Omit<
  InspectionReportData,
  'verificationCode' | 'verificationUrl' | 'documentHash' | 'qrCodeDataUrl'
>;

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

function isStoredInspectionRenderSnapshot(value: unknown): value is InspectionRenderSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.inspectionId === 'string' &&
    typeof data.type === 'string' &&
    !!data.vehicle &&
    typeof data.vehicle === 'object' &&
    Array.isArray(data.items)
  );
}

/**
 * Build the complete visual payload for an inspection report from operational
 * tables. New generated document versions persist this payload inside their
 * immutable snapshot. This function remains available as a compatibility
 * fallback for historical generated documents created before full render
 * snapshots were introduced.
 */
export async function buildInspectionReportRenderSnapshot(
  documentId: string,
): Promise<InspectionRenderSnapshot | null> {
  const db = getDb();
  const [document] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, documentId))
    .limit(1);
  if (!document || document.documentType !== 'inspection_report' || document.entityType !== 'inspection') {
    return null;
  }

  const inspectionId = document.entityId;
  const tenantId = document.tenantId;
  const [[inspection], [tenant], [branding]] = await Promise.all([
    db
      .select()
      .from(vehicleInspections)
      .where(and(eq(vehicleInspections.id, inspectionId), eq(vehicleInspections.tenantId, tenantId)))
      .limit(1),
    db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1),
    db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId)).limit(1),
  ]);
  if (!inspection) return null;

  const [[vehicle], items, inspector] = await Promise.all([
    db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, inspection.vehicleId), eq(vehicles.tenantId, tenantId)))
      .limit(1),
    db
      .select({
        label: inspectionTemplateItems.label,
        category: inspectionTemplateItems.category,
        result: inspectionItemResults.result,
        comment: inspectionItemResults.comment,
      })
      .from(inspectionItemResults)
      .innerJoin(inspectionTemplateItems, eq(inspectionTemplateItems.id, inspectionItemResults.templateItemId))
      .where(eq(inspectionItemResults.inspectionId, inspectionId))
      .orderBy(inspectionTemplateItems.sortOrder),
    inspection.inspectorEmployeeId
      ? db
          .select({ firstName: employees.firstName, lastName: employees.lastName })
          .from(employees)
          .where(and(eq(employees.id, inspection.inspectorEmployeeId), eq(employees.tenantId, tenantId)))
          .limit(1)
          .then((rows) => rows[0])
      : Promise.resolve(undefined),
  ]);

  let driverName: string | undefined;
  if (inspection.driverEmployeeId) {
    const [driver] = await db
      .select({ firstName: employees.firstName, lastName: employees.lastName })
      .from(employees)
      .where(and(eq(employees.id, inspection.driverEmployeeId), eq(employees.tenantId, tenantId)))
      .limit(1);
    driverName = driver ? `${driver.firstName} ${driver.lastName}`.trim() : undefined;
  } else if (inspection.tripId) {
    const [external] = await db
      .select({ firstName: externalParties.firstName, lastName: externalParties.lastName })
      .from(externalDriverAssignments)
      .innerJoin(externalParties, eq(externalParties.id, externalDriverAssignments.externalPartyId))
      .where(
        and(
          eq(externalDriverAssignments.tenantId, tenantId),
          eq(externalDriverAssignments.tripId, inspection.tripId),
          eq(externalDriverAssignments.state, 'accepted'),
          eq(externalParties.tenantId, tenantId),
        ),
      )
      .orderBy(desc(externalDriverAssignments.acceptedAt))
      .limit(1);
    driverName = external ? `${external.firstName} ${external.lastName}`.trim() : undefined;
  }

  const resolvedBranding = await resolveTenantDocumentBranding(tenantId);

  return {
    inspectionId: inspection.id,
    type: inspection.type as 'departure' | 'return',
    vehicle: {
      licenceNumber: vehicle?.licenceNumber || 'Not recorded',
      registrationNumber: vehicle?.vehicleRegisterNumber || 'Not recorded',
    },
    odometerReading: inspection.odometerReading,
    fuelLevel: inspection.fuelLevel,
    overallPass: inspection.overallPass,
    status: inspection.status,
    notes: inspection.notes,
    inspectedAt: inspection.createdAt.toISOString().split('T')[0],
    tenantName: tenant?.name,
    tenantDocumentFooter: branding?.documentFooter || undefined,
    branding: resolvedBranding,
    inspectorName: inspector ? `${inspector.firstName} ${inspector.lastName}`.trim() : undefined,
    driverName,
    inspectorSignedAt: inspection.signatureInspector ? inspection.updatedAt.toISOString() : undefined,
    driverSignedAt: inspection.signatureDriver ? inspection.updatedAt.toISOString() : undefined,
    items: items.map((item) => ({
      label: item.label,
      category: item.category,
      result: item.result as 'pass' | 'fail' | 'not_applicable',
      comment: item.comment || undefined,
    })),
  };
}

export async function generateVerifiedInspectionReportPdf(
  documentId: string,
): Promise<{ buffer: Uint8Array; filename: string } | null> {
  const db = getDb();
  const [document] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, documentId))
    .limit(1);
  if (!document || document.documentType !== 'inspection_report' || document.entityType !== 'inspection') {
    return null;
  }

  const snapshot = (document.snapshotData || {}) as Record<string, unknown>;
  const storedRenderData = snapshot.renderData;
  const renderSnapshot = isStoredInspectionRenderSnapshot(storedRenderData)
    ? storedRenderData
    : await buildInspectionReportRenderSnapshot(documentId);
  if (!renderSnapshot) return null;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const verificationUrl = `${baseUrl}/v/${document.verificationSlug}`;
  const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, { width: 220, margin: 1 });

  const data: InspectionReportData = {
    ...renderSnapshot,
    verificationCode: document.verificationCode,
    verificationUrl,
    documentHash: abbreviatedDocumentHash(document.hash) || undefined,
    qrCodeDataUrl,
  };

  const element = React.createElement(
    InspectionReportDocument as React.ComponentType<{ data: InspectionReportData }>,
    { data },
  ) as React.ReactElement;
  const buffer = await renderPdfToBuffer(element);
  return { buffer, filename: `inspection_report_${document.id.slice(0, 8)}.pdf` };
}
