import React from 'react';
import { Document, View } from '@react-pdf/renderer';
import type { ResolvedTenantBranding } from '@/lib/tenant-branding';
import {
  formatDocumentStatus,
  formatHumanDate,
  formatHumanValue,
  humanizeKey,
} from '@/lib/human-readable';
import {
  DocumentExecutiveCertification,
  DocumentFieldGrid,
  DocumentHeader,
  DocumentPage,
  DocumentRow,
  DocumentSection,
  DocumentSignature,
  DocumentTable,
  DocumentVerificationBlock,
  DocumentVerificationFooter,
  documentStyles,
} from './document-system';

interface VerifiedDocumentIdentity {
  branding?: ResolvedTenantBranding | null;
  generatedAt: string;
  verificationCode?: string;
  verificationUrl?: string;
  documentHash?: string;
  qrCodeDataUrl?: string;
}

export interface FuelReceiptData extends VerifiedDocumentIdentity {
  receiptNumber: string;
  status: string;
  vehicle: string;
  odometer?: number | null;
  fuelType?: string | null;
  litres: number;
  amount: number;
  station?: string | null;
  location?: string | null;
  pricePerLitre?: number | null;
  paymentMethod?: string | null;
  attendant?: string | null;
  attachments?: Array<{ name: string; uploadedBy?: string; uploadedAt?: string }>;
  verifiedBy?: string;
  verifiedAt?: string;
  verificationResult?: string;
  verificationNotes?: string | null;
  verifierSignatureUrl?: string;
}

export const FuelReceiptDocument: React.FC<{ data: FuelReceiptData }> = ({ data }) => (
  <Document title="Fuel Receipt and Verification Record">
    <DocumentPage>
      <DocumentHeader
        branding={data.branding}
        title="Fuel Receipt / Verification Record"
        reference={data.receiptNumber}
        status={formatDocumentStatus(data.status)}
        issueDate={formatHumanDate(data.generatedAt, data.branding?.locale)}
      />
      <DocumentSection title="A. Transaction Details">
        <DocumentFieldGrid
          columns={3}
          fields={[
            { label: 'Vehicle', value: data.vehicle },
            { label: 'Odometer', value: formatHumanValue(data.odometer, 'odometer') },
            { label: 'Fuel type', value: humanizeKey(data.fuelType || '') },
            { label: 'Litres', value: formatHumanValue(data.litres, 'litres') },
            { label: 'Amount', value: formatHumanValue(data.amount, 'amount') },
            { label: 'Station', value: data.station },
            { label: 'Location', value: data.location },
            { label: 'Price / litre', value: formatHumanValue(data.pricePerLitre, 'amount') },
            { label: 'Payment method', value: humanizeKey(data.paymentMethod || '') },
            { label: 'Attendant', value: data.attendant },
          ]}
        />
      </DocumentSection>
      {data.attachments?.length ? (
        <DocumentSection title="B. Attachments">
          <DocumentTable
            columns={[
              { key: 'name', label: 'Attachment', width: '45%' },
              { key: 'uploadedBy', label: 'Uploaded by', width: '30%' },
              { key: 'uploadedAt', label: 'Uploaded at', width: '25%' },
            ]}
            rows={data.attachments.map((item) => ({
              ...item,
              uploadedAt: formatHumanDate(item.uploadedAt, data.branding?.locale),
            }))}
          />
        </DocumentSection>
      ) : null}
      <DocumentSection title="C. Verification" wrap={false}>
        <DocumentRow>
          <DocumentFieldGrid
            fields={[
              { label: 'Result', value: formatDocumentStatus(data.verificationResult ?? '') },
              {
                label: 'Verified at',
                value: formatHumanDate(data.verifiedAt, data.branding?.locale),
              },
              { label: 'Notes', value: data.verificationNotes },
            ]}
          />
          <View style={documentStyles.signatureRow}>
            <DocumentSignature
              name={data.verifiedBy || 'Verifier not recorded'}
              role="Fuel verification officer"
              signedAt={data.verifiedAt}
              signatureUrl={data.verifierSignatureUrl}
            />
          </View>
        </DocumentRow>
      </DocumentSection>
      <DocumentVerificationBlock {...data} qrCode={data.qrCodeDataUrl} />
      <DocumentVerificationFooter
        branding={data.branding}
        verificationCode={data.verificationCode}
        verificationUrl={data.verificationUrl}
        documentHash={data.documentHash}
        generatedAt={data.generatedAt}
      />
    </DocumentPage>
  </Document>
);

export interface DriverLogsheetData extends VerifiedDocumentIdentity {
  driver: string;
  period: string;
  entries: Array<{
    date: string;
    startKm: number;
    endKm: number;
    distance: number;
    purposeOrRoute: string;
    tripAuthority?: string;
    remarks?: string;
  }>;
}

export const DriverLogsheetDocument: React.FC<{ data: DriverLogsheetData }> = ({ data }) => {
  const opening = data.entries[0]?.startKm;
  const closing = data.entries[data.entries.length - 1]?.endKm;
  const totalDistance = data.entries.reduce((sum, entry) => sum + entry.distance, 0);
  return (
    <Document title="Driver Logsheet Report">
      <DocumentPage>
        <DocumentHeader
          branding={data.branding}
          title="Driver Logsheet Report"
          issueDate={formatHumanDate(data.generatedAt, data.branding?.locale)}
        />
        <DocumentSection title="Logsheet Identity">
          <DocumentFieldGrid
            columns={2}
            fields={[
              { label: 'Driver', value: data.driver },
              { label: 'Period', value: data.period },
              {
                label: 'Generated',
                value: formatHumanDate(data.generatedAt, data.branding?.locale),
              },
              { label: 'Total entries', value: data.entries.length },
            ]}
          />
        </DocumentSection>
        <DocumentSection title="A. Log Entries">
          <DocumentTable
            columns={[
              { key: 'date', label: 'Date', width: '13%' },
              { key: 'startKm', label: 'Start km', width: '10%' },
              { key: 'endKm', label: 'End km', width: '10%' },
              { key: 'distance', label: 'Distance', width: '10%' },
              { key: 'purposeOrRoute', label: 'Purpose / route', width: '27%' },
              { key: 'tripAuthority', label: 'Trip authority', width: '17%' },
              { key: 'remarks', label: 'Remarks', width: '13%' },
            ]}
            rows={data.entries.map((entry) => ({
              ...entry,
              date: formatHumanDate(entry.date, data.branding?.locale),
              startKm: formatHumanValue(entry.startKm, 'odometer'),
              endKm: formatHumanValue(entry.endKm, 'odometer'),
              distance: formatHumanValue(entry.distance, 'distance'),
            }))}
          />
        </DocumentSection>
        <DocumentSection title="B. Summary" wrap={false}>
          <DocumentFieldGrid
            columns={2}
            fields={[
              { label: 'Opening odometer', value: formatHumanValue(opening, 'odometer') },
              { label: 'Closing odometer', value: formatHumanValue(closing, 'odometer') },
              { label: 'Total distance', value: formatHumanValue(totalDistance, 'distance') },
              { label: 'Total trips', value: data.entries.length },
            ]}
          />
        </DocumentSection>
        <DocumentExecutiveCertification
          branding={data.branding}
          generatedAt={data.generatedAt}
          statement="I certify that this driver logsheet is a true system record for the stated period."
        />
        <DocumentVerificationBlock {...data} qrCode={data.qrCodeDataUrl} />
        <DocumentVerificationFooter
          branding={data.branding}
          verificationCode={data.verificationCode}
          verificationUrl={data.verificationUrl}
          documentHash={data.documentHash}
          generatedAt={data.generatedAt}
        />
      </DocumentPage>
    </Document>
  );
};

export interface IncidentRecordData extends VerifiedDocumentIdentity {
  reference: string;
  type: string;
  severity?: string;
  status: string;
  vehicle?: string;
  tripAuthority?: string;
  occurredAt: string;
  location?: string | null;
  description: string;
  damageOrDefects?: string | null;
  evidence?: string[];
  responseOrAction?: string | null;
  safeDetermination?: string | null;
  reportedBy?: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
}

export const IncidentRecordDocument: React.FC<{ data: IncidentRecordData }> = ({ data }) => (
  <Document title="Incident, Defect and Breakdown Record">
    <DocumentPage>
      <DocumentHeader
        branding={data.branding}
        title={`${humanizeKey(data.type)} Record`}
        reference={data.reference}
        status={formatDocumentStatus(data.status)}
        issueDate={formatHumanDate(data.occurredAt, data.branding?.locale)}
      />
      <DocumentRow>
        <DocumentSection title="A. Incident Summary">
          <DocumentFieldGrid
            fields={[
              { label: 'Type', value: humanizeKey(data.type) },
              { label: 'Severity', value: humanizeKey(data.severity || '') },
              { label: 'Status', value: formatDocumentStatus(data.status) },
              { label: 'Reported by', value: data.reportedBy },
            ]}
          />
        </DocumentSection>
        <DocumentSection title="B. Vehicle / Trip">
          <DocumentFieldGrid
            fields={[
              { label: 'Vehicle', value: data.vehicle },
              { label: 'Trip authority', value: data.tripAuthority },
            ]}
          />
        </DocumentSection>
      </DocumentRow>
      <DocumentSection title="C. Location / Time">
        <DocumentFieldGrid
          columns={2}
          fields={[
            {
              label: 'Occurred at',
              value: formatHumanDate(data.occurredAt, data.branding?.locale),
            },
            { label: 'Location', value: data.location },
          ]}
        />
      </DocumentSection>
      <DocumentSection title="D. Description">
        <DocumentFieldGrid fields={[{ label: 'Description', value: data.description }]} />
      </DocumentSection>
      {data.damageOrDefects ? (
        <DocumentSection title="E. Damage / Defects">
          <DocumentFieldGrid
            fields={[
              { label: 'Details', value: data.damageOrDefects },
              { label: 'Safe determination', value: data.safeDetermination },
            ]}
          />
        </DocumentSection>
      ) : null}
      {data.evidence?.length ? (
        <DocumentSection title="F. Evidence">
          <DocumentTable
            columns={[
              { key: 'index', label: 'No.', width: '10%' },
              { key: 'reference', label: 'Evidence reference', width: '90%' },
            ]}
            rows={data.evidence.map((reference, index) => ({ index: index + 1, reference }))}
          />
        </DocumentSection>
      ) : null}
      {data.responseOrAction ? (
        <DocumentSection title="G. Response / Action">
          <DocumentFieldGrid fields={[{ label: 'Action taken', value: data.responseOrAction }]} />
        </DocumentSection>
      ) : null}
      <DocumentSection title="H. Acknowledgement" wrap={false}>
        <View style={documentStyles.signatureRow}>
          <DocumentSignature
            name={data.acknowledgedBy || 'Acknowledgement pending'}
            role="Responsible officer"
            signedAt={data.acknowledgedAt}
          />
        </View>
      </DocumentSection>
      <DocumentVerificationBlock {...data} qrCode={data.qrCodeDataUrl} />
      <DocumentVerificationFooter
        branding={data.branding}
        verificationCode={data.verificationCode}
        verificationUrl={data.verificationUrl}
        documentHash={data.documentHash}
        generatedAt={data.generatedAt}
      />
    </DocumentPage>
  </Document>
);
