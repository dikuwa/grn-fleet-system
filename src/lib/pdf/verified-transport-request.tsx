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
import { tripAuthorities, vehicleAllocations } from '@/db/schema/trips';
import { tenants, tenantBranding } from '@/db/schema/tenants';
import { workflowActions, workflowInstances } from '@/db/schema/workflows';
import { abbreviatedDocumentHash } from '@/lib/document-verification';
import { resolveTenantDocumentBranding } from '@/lib/tenant-branding';
import { TransportRequestDocument, type TransportRequestData } from './transport-request';

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

export async function generateVerifiedTransportRequestPdf(
  documentId: string,
): Promise<{ buffer: Uint8Array; filename: string } | null> {
  const db = getDb();
  const [document] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, documentId))
    .limit(1);
  if (!document || document.documentType !== 'transport_request' || !document.snapshotData) {
    return null;
  }

  const snapshot = document.snapshotData as Record<string, unknown>;
  const [[tenant], [branding]] = await Promise.all([
    db.select().from(tenants).where(eq(tenants.id, document.tenantId)).limit(1),
    db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, document.tenantId)).limit(1),
  ]);
  const resolvedBranding = await resolveTenantDocumentBranding(document.tenantId);

  let outcome: TransportRequestData['outcome'] = undefined;
  if (document.entityType === 'transport_request' && document.entityId) {
    const [allocation] = await db
      .select({
        id: vehicleAllocations.id,
        startAt: vehicleAllocations.startAt,
        state: vehicleAllocations.state,
        licenceNumber: vehicles.licenceNumber,
        authorityNumber: tripAuthorities.authorityNumber,
        internalDriverName: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.lastName})`,
      })
      .from(vehicleAllocations)
      .leftJoin(vehicles, eq(vehicles.id, vehicleAllocations.vehicleId))
      .leftJoin(employees, eq(employees.id, vehicleAllocations.driverEmployeeId))
      .leftJoin(
        tripAuthorities,
        and(
          eq(tripAuthorities.allocationId, vehicleAllocations.id),
          eq(tripAuthorities.tenantId, document.tenantId),
        ),
      )
      .where(
        and(
          eq(vehicleAllocations.requestId, document.entityId),
          eq(vehicles.tenantId, document.tenantId),
        ),
      )
      .orderBy(desc(vehicleAllocations.createdAt))
      .limit(1);

    if (allocation) {
      let allocatedDriver = allocation.internalDriverName || undefined;
      if (!allocatedDriver) {
        const [external] = await db
          .select({ firstName: externalParties.firstName, lastName: externalParties.lastName })
          .from(externalDriverAssignments)
          .innerJoin(externalParties, eq(externalParties.id, externalDriverAssignments.externalPartyId))
          .where(
            and(
              eq(externalDriverAssignments.tenantId, document.tenantId),
              eq(externalDriverAssignments.allocationId, allocation.id),
              eq(externalParties.tenantId, document.tenantId),
            ),
          )
          .orderBy(desc(externalDriverAssignments.assignedAt))
          .limit(1);
        allocatedDriver = external ? `${external.firstName} ${external.lastName}`.trim() : undefined;
      }

      outcome = {
        finalStatus: document.status === 'issued' ? 'Approved' : document.status,
        linkedAuthorityReference: allocation.authorityNumber || 'Not issued',
        allocatedVehicle: allocation.licenceNumber || 'Not recorded',
        allocatedDriver: allocatedDriver || 'Not recorded',
        allocationDate: allocation.startAt?.toISOString(),
        approvalDate: undefined,
      };

      const [approval] = await db
        .select({ createdAt: workflowActions.createdAt })
        .from(workflowActions)
        .innerJoin(workflowInstances, eq(workflowInstances.id, workflowActions.instanceId))
        .where(
          and(
            eq(workflowInstances.requestId, document.entityId),
            eq(workflowActions.actionType, 'authorise'),
            eq(workflowActions.result, 'authorised'),
          ),
        )
        .orderBy(desc(workflowActions.createdAt))
        .limit(1);
      if (approval) outcome.approvalDate = approval.createdAt.toISOString();
    }
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const verificationUrl = `${baseUrl}/v/${document.verificationSlug}`;
  const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, { width: 220, margin: 1 });
  const data: TransportRequestData = {
    reference: String(snapshot.reference || document.id.slice(0, 8).toUpperCase()),
    revision: snapshot.revision as number | undefined,
    scope: String(snapshot.scope || 'regional'),
    status: document.status || (snapshot.status as string) || 'draft',
    department: snapshot.department as string | undefined,
    purpose: snapshot.purpose as string | undefined,
    submittedAt: snapshot.submittedAt as string | undefined,
    totalAuthorisedKilometres: snapshot.totalAuthorisedKilometres as number | undefined,
    specialAuthorityRequired: snapshot.specialAuthorityRequired as boolean | undefined,
    tenantName: tenant?.name,
    tenantDocumentFooter: branding?.documentFooter || undefined,
    branding: resolvedBranding,
    documentVersion: document.documentVersion,
    issuedAt: document.createdAt.toISOString(),
    verificationCode: document.verificationCode,
    verificationUrl,
    qrCodeDataUrl,
    documentHash: abbreviatedDocumentHash(document.hash) || undefined,
    requester: (snapshot.requester as TransportRequestData['requester']) || { name: 'Unknown' },
    activities: snapshot.activities as TransportRequestData['activities'],
    passengers: snapshot.passengers as TransportRequestData['passengers'],
    travellerCount: snapshot.travellerCount as number | undefined,
    drivers: snapshot.drivers as TransportRequestData['drivers'],
    routes: snapshot.routes as TransportRequestData['routes'],
    attachments: snapshot.attachments as TransportRequestData['attachments'],
    approvalWorkflow: snapshot.approvalWorkflow as TransportRequestData['approvalWorkflow'],
    goodsAndEquipment: snapshot.goodsAndEquipment as TransportRequestData['goodsAndEquipment'],
    outcome,
  };

  const element = React.createElement(
    TransportRequestDocument as React.ComponentType<{ data: TransportRequestData }>,
    { data },
  ) as React.ReactElement;
  const buffer = await renderPdfToBuffer(element);
  return { buffer, filename: `transport_request_${document.id.slice(0, 8)}.pdf` };
}
