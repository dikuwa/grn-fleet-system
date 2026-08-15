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

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
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
        totalLitres: optionalFiniteNumber(snapshot.totalLitres),
        totalCost: optionalFiniteNumber(snapshot.totalCost),
        transactionCount: optionalFiniteNumber(snapshot.transactionCount),
        pendingReimbursements: optionalFiniteNumber(snapshot.pendingReimbursements),
        actualKilometres: optionalFiniteNumber(snapshot.actualKilometres),
        kilometreVariance: optionalFiniteNumber(snapshot.kilometreVariance),
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
        totalEvents: optionalFiniteNumber(snapshot.totalEvents),
        totalCost: optionalFiniteNumber(snapshot.totalCost),
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
        severity: typeof snapshot.severity === 'string' ? snapshot.severity : undefined,
        status: String(snapshot.status ?? 'reported'),
        occurredAt: typeof snapshot.occurredAt === 'string' ? snapshot.occurredAt : undefined,
        location: (snapshot.location as string | null) ?? null,
        description: String(snapshot.description ?? ''),
        immediateAction: (snapshot.immediateAction as string | null) ?? null,
        continuationState: (snapshot.continuationState as string | null) ?? null,
        vehicleSafe: optionalBoolean(snapshot.vehicleSafe) ?? null,
        passengerSafe: optionalBoolean(snapshot.passengerSafe) ?? null,
        injuries: optionalBoolean(snapshot.injuries),
        numberInjured: optionalFiniteNumber(snapshot.numberInjured),
        vehicleDamage: optionalBoolean(snapshot.vehicleDamage),
        thirdPartyInvolvement: optionalBoolean(snapshot.thirdPartyInvolvement),
        policeReference: (snapshot.policeReference as string | null) ?? null,
        emergencyServicesContacted: optionalBoolean(snapshot.emergencyServicesContacted),
        detailsRequired: optionalBoolean(snapshot.detailsRequired),
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
        insuranceNotified: optionalBoolean(snapshot.insuranceNotified),
        insuranceNotifiedAt: (snapshot.insuranceNotifiedAt as string | null) ?? null,
        policeReportFiled: optionalBoolean(snapshot.policeReportFiled),
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
      const vehicleSafe = optionalBoolean(snapshot.vehicleSafe);
      const passengerSafe = optionalBoolean(snapshot.passengerSafe);
      const safetyLabel = (value: boolean | undefined, subject: string) =>
        value === true ? `${subject} safe` : value === false ? `${subject} unsafe` : `${subject} not assessed`;
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
        damageOrDefects: optionalBoolean(snapshot.vehicleDamage) === true
          ? 'Vehicle damage or defects were reported. Refer to the incident description and evidence.'
          : null,
        evidence: (snapshot.attachments as string[] | undefined) ?? [],
        responseOrAction: (snapshot.immediateAction as string | null | undefined) ?? null,
        safeDetermination:
          vehicleSafe === undefined && passengerSafe === undefined
            ? null
            : `${safetyLabel(vehicleSafe, 'Vehicle')}; ${safetyLabel(passengerSafe, 'passengers')}`,
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
        snapshotData: snapshot,
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
