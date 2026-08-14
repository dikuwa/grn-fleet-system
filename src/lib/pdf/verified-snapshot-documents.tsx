import React from 'react';
import QRCode from 'qrcode';
import { renderToStream } from '@react-pdf/renderer';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { tenants } from '@/db/schema/tenants';
import { abbreviatedDocumentHash } from '@/lib/document-verification';
import { resolveTenantDocumentBranding } from '@/lib/tenant-branding';
import { FuelSummaryDocument, type FuelSummaryData } from './fuel-summary';
import { TripCompletionDocument, type TripCompletionData } from './trip-completion';
import { MaintenanceReportDocument, type MaintenanceReportData } from './maintenance-report';
import { MvaReportDocument, type MvaReportData } from './mva-report';
import { IncidentRecordDocument, type IncidentRecordData } from './operational-records';
import { SnapshotDocument, type SnapshotDocumentData } from './snapshot-document';

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

/** Render stored-snapshot document families with the permanent document verification identity. */
export async function generateVerifiedSnapshotDocumentPdf(
  documentId: string,
): Promise<{ buffer: Uint8Array; filename: string } | null> {
  const db = getDb();
  const [document] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, documentId))
    .limit(1);
  if (!document || !document.snapshotData) return null;

  const snapshot = document.snapshotData as Record<string, unknown>;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, document.tenantId)).limit(1);
  const branding = await resolveTenantDocumentBranding(document.tenantId);
  const generatedAt = document.createdAt.toISOString();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const verificationUrl = `${baseUrl}/v/${document.verificationSlug}`;
  const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, { width: 220, margin: 1 });
  const common = {
    tenantName: tenant?.name,
    branding,
    documentVersion: document.documentVersion,
    generatedAt,
    verificationCode: document.verificationCode,
    verificationUrl,
    documentHash: abbreviatedDocumentHash(document.hash) || undefined,
    qrCodeDataUrl,
  };

  let element: React.ReactElement;

  switch (document.documentType) {
    case 'fuel_summary': {
      const data: FuelSummaryData = {
        tripId: document.entityId || document.id,
        totalLitres: Number(snapshot.totalLitres ?? 0),
        totalCost: Number(snapshot.totalCost ?? 0),
        transactionCount: Number(snapshot.transactionCount ?? 0),
        pendingReimbursements: Number(snapshot.pendingReimbursements ?? 0),
        actualKilometres: (snapshot.actualKilometres as number | null) ?? undefined,
        kilometreVariance: (snapshot.kilometreVariance as number | null) ?? undefined,
        status: document.status,
        transactions: snapshot.transactions as FuelSummaryData['transactions'],
        vehicleLicence: snapshot.vehicleLicence as string | undefined,
        vehicleRegisterNumber: snapshot.vehicleRegisterNumber as string | undefined,
        tripReference: snapshot.tripReference as string | undefined,
        tripPurpose: snapshot.tripPurpose as string | undefined,
        ...common,
      };
      element = React.createElement(
        FuelSummaryDocument as React.ComponentType<{ data: FuelSummaryData }>,
        { data },
      ) as React.ReactElement;
      break;
    }
    case 'trip_completion': {
      const vehicle = snapshot.vehicle as
        | { licenceNumber?: string; registrationNumber?: string }
        | undefined;
      const closure = snapshot.closure as TripCompletionData['closure'];
      const fuel = snapshot.fuelSummary as TripCompletionData['fuelSummary'];
      const data: TripCompletionData = {
        tripId: document.entityId || document.id,
        status: String(snapshot.status || document.status || 'issued'),
        vehicle: {
          licenceNumber: vehicle?.licenceNumber || 'Not recorded',
          registrationNumber: vehicle?.registrationNumber || 'Not recorded',
        },
        routeKm: (snapshot.routeKm as number | null | undefined) ?? undefined,
        issuedAt: snapshot.issuedAt as string | undefined,
        startedAt: snapshot.startedAt as string | undefined,
        returnedAt: snapshot.returnedAt as string | undefined,
        closedAt: snapshot.closedAt as string | undefined,
        closure: closure || null,
        fuelSummary: fuel || null,
        eventSummary: snapshot.eventSummary as TripCompletionData['eventSummary'],
        statusText: document.status,
        ...common,
      };
      element = React.createElement(
        TripCompletionDocument as React.ComponentType<{ data: TripCompletionData }>,
        { data },
      ) as React.ReactElement;
      break;
    }
    case 'maintenance_report': {
      const events = snapshot.events as MaintenanceReportData['events'];
      const data: MaintenanceReportData = {
        vehicleId: document.entityId || document.id,
        vehicle: snapshot.vehicle as string | undefined,
        totalEvents: Number(snapshot.totalEvents ?? 0),
        totalCost: Number(snapshot.totalCost ?? 0),
        nextServiceDate: snapshot.nextServiceDate as string | null | undefined,
        nextServiceOdometer: snapshot.nextServiceOdometer as number | null | undefined,
        status: document.status,
        events: events || [],
        ...common,
      };
      element = React.createElement(
        MaintenanceReportDocument as React.ComponentType<{ data: MaintenanceReportData }>,
        { data },
      ) as React.ReactElement;
      break;
    }
    case 'accident_report': {
      const vehicle = snapshot.vehicle as
        | { registration?: string; registerNumber?: string; make?: string; model?: string }
        | undefined;
      const tripReferences = snapshot.tripReferences as
        | { transportRequest?: string; tripAuthority?: string }
        | undefined;
      const data: MvaReportData = {
        reference: String(snapshot.reference ?? document.entityId ?? ''),
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
          transportRequest: String(tripReferences?.transportRequest ?? '—'),
          tripAuthority: String(tripReferences?.tripAuthority ?? '—'),
        },
        vehicle: {
          registration: String(vehicle?.registration ?? ''),
          registerNumber: String(vehicle?.registerNumber ?? ''),
          make: String(vehicle?.make ?? ''),
          model: String(vehicle?.model ?? ''),
        },
        accidentReportNumber: (snapshot.accidentReportNumber as string | null) ?? null,
        investigationStatus: String(snapshot.investigationStatus ?? 'pending'),
        investigationNotes: (snapshot.investigationNotes as string | null) ?? null,
        investigationClosedAt: (snapshot.investigationClosedAt as string | null) ?? null,
        witnessStatements: (snapshot.witnessStatements as Array<Record<string, unknown>> | null) ?? [],
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
        ...common,
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
        | { tripAuthority?: string; transportRequest?: string }
        | undefined;
      const vehicleSafe = snapshot.vehicleSafe as boolean | null | undefined;
      const passengerSafe = snapshot.passengerSafe as boolean | null | undefined;
      const data: IncidentRecordData = {
        reference: String(snapshot.reference ?? document.entityId ?? document.id),
        type: String(snapshot.eventType ?? 'incident'),
        severity: String(snapshot.severity ?? 'not_recorded'),
        status: String(snapshot.status ?? document.status ?? 'reported'),
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
        ...common,
      };
      element = React.createElement(
        IncidentRecordDocument as React.ComponentType<{ data: IncidentRecordData }>,
        { data },
      ) as React.ReactElement;
      break;
    }
    default: {
      const data: SnapshotDocumentData = {
        documentType: document.documentType,
        documentVersion: document.documentVersion,
        tenantName: tenant?.name,
        branding,
        snapshotData: snapshot,
        generatedAt,
        status: document.status,
        ...common,
      };
      element = React.createElement(
        SnapshotDocument as React.ComponentType<{ data: SnapshotDocumentData }>,
        { data },
      ) as React.ReactElement;
    }
  }

  const buffer = await renderPdfToBuffer(element);
  return { buffer, filename: `${document.documentType}_${document.id.slice(0, 8)}.pdf` };
}
