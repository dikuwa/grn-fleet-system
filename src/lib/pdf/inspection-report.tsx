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
  DocumentFieldGrid,
  DocumentHeader,
  DocumentPage,
  DocumentRow,
  DocumentSection,
  DocumentSignature,
  DocumentTable,
  DocumentVerificationBlock,
  DocumentVerificationFooter,
  DocumentExecutiveCertification,
  documentStyles,
} from './document-system';

export interface InspectionItemResult {
  label: string;
  category: string;
  result: 'pass' | 'fail' | 'not_applicable';
  comment?: string;
}

export interface InspectionReportData {
  inspectionId: string;
  type: 'departure' | 'return';
  vehicle: { licenceNumber: string; registrationNumber: string };
  odometerReading?: number | null;
  fuelLevel?: string | null;
  overallPass?: boolean | null;
  status: string;
  notes?: string | null;
  inspectedAt: string;
  inspectorName?: string;
  driverName?: string;
  inspectorSignedAt?: string;
  driverSignedAt?: string;
  inspectorSignatureUrl?: string;
  driverSignatureUrl?: string;
  tenantName?: string;
  tenantDocumentFooter?: string;
  branding?: ResolvedTenantBranding | null;
  items?: InspectionItemResult[];
  verificationCode?: string;
  verificationUrl?: string;
  documentHash?: string;
  qrCodeDataUrl?: string;
}

export const InspectionReportDocument: React.FC<{ data: InspectionReportData }> = ({ data }) => {
  const branding =
    data.branding ||
    (data.tenantName
      ? {
          tenantId: '',
          organisationName: data.tenantName,
          code: '',
          locale: 'en-NA',
          timezone: 'Africa/Windhoek',
          primaryColor: '#1F2A44',
          accentColor: '#0F766E',
          documentFooter: data.tenantDocumentFooter,
        }
      : null);
  return (
    <Document title={`${humanizeKey(data.type)} Inspection Report`}>
      <DocumentPage status={data.status === 'draft' ? 'draft' : undefined}>
        <DocumentHeader
          branding={branding}
          title={`${humanizeKey(data.type)} Inspection Report`}
          reference={`INSP-${data.inspectionId.slice(0, 8).toUpperCase()}`}
          version={1}
          status={formatDocumentStatus(data.status)}
          issueDate={formatHumanDate(data.inspectedAt, branding?.locale)}
          qrCode={data.qrCodeDataUrl}
        />

        {/* Row 1: Inspection summary | Vehicle info */}
        <DocumentRow>
          <DocumentSection title="Inspection summary">
            <DocumentFieldGrid
              fields={[
                { label: 'Inspection type', value: humanizeKey(data.type) },
                { label: 'Status', value: formatDocumentStatus(data.status) },
                { label: 'Inspector', value: data.inspectorName || 'Not recorded' },
                { label: 'Driver', value: data.driverName || 'Not recorded' },
                {
                  label: 'Inspected at',
                  value: formatHumanDate(data.inspectedAt, branding?.locale),
                },
              ]}
            />
          </DocumentSection>
          <DocumentSection title="Vehicle information">
            <DocumentFieldGrid
              fields={[
                { label: 'Vehicle registration', value: data.vehicle.licenceNumber },
                { label: 'Asset register number', value: data.vehicle.registrationNumber },
                { label: 'Odometer', value: formatHumanValue(data.odometerReading, 'odometer') },
                { label: 'Fuel level', value: data.fuelLevel || 'Not recorded' },
                {
                  label: 'Overall result',
                  value:
                    data.overallPass === null || data.overallPass === undefined
                      ? 'Pending'
                      : data.overallPass
                        ? 'Passed'
                        : 'Failed',
                },
              ]}
            />
          </DocumentSection>
        </DocumentRow>

        {/* Checklist table */}
        <DocumentSection title={`Checklist (${data.items?.length || 0})`}>
          <DocumentTable
            columns={[
              { key: 'category', label: 'Category' },
              { key: 'item', label: 'Inspection item' },
              { key: 'result', label: 'Result' },
              { key: 'comment', label: 'Comment' },
            ]}
            rows={(data.items || []).map((item) => ({
              category: humanizeKey(item.category),
              item: item.label,
              result:
                item.result === 'not_applicable' ? 'Not applicable' : humanizeKey(item.result),
              comment: item.comment || 'No comment',
            }))}
            emptyLabel="No checklist results were recorded"
          />
        </DocumentSection>

        {/* Defects and signatures — conditional two-column layout */}
        {data.notes ? (
          <DocumentRow>
            <DocumentSection title="Defects and remarks" wrap={false}>
              <DocumentFieldGrid fields={[{ label: 'Inspector notes', value: data.notes }]} />
            </DocumentSection>
            <DocumentSection title="Acknowledgements" wrap={false}>
              <View style={documentStyles.signatureRow}>
                <DocumentSignature
                  name={data.inspectorName || 'Inspector not recorded'}
                  role="Inspector"
                  signedAt={data.inspectorSignedAt}
                  signatureUrl={data.inspectorSignatureUrl}
                />
                <DocumentSignature
                  name={data.driverName || 'Driver not recorded'}
                  role="Driver acknowledgement"
                  signedAt={data.driverSignedAt}
                  signatureUrl={data.driverSignatureUrl}
                />
              </View>
            </DocumentSection>
          </DocumentRow>
        ) : (
          <DocumentSection title="Acknowledgements" wrap={false}>
            <View style={documentStyles.signatureRow}>
              <DocumentSignature
                name={data.inspectorName || 'Inspector not recorded'}
                role="Inspector"
                signedAt={data.inspectorSignedAt}
                signatureUrl={data.inspectorSignatureUrl}
              />
              <DocumentSignature
                name={data.driverName || 'Driver not recorded'}
                role="Driver acknowledgement"
                signedAt={data.driverSignedAt}
                signatureUrl={data.driverSignatureUrl}
              />
            </View>
          </DocumentSection>
        )}

        <DocumentExecutiveCertification
          branding={branding}
          generatedAt={data.inspectedAt}
          statement="I certify that this inspection report is a true system record."
        />
        {/* Verification block */}
        <DocumentVerificationBlock
          branding={branding}
          verificationCode={data.verificationCode}
          verificationUrl={data.verificationUrl}
          documentHash={data.documentHash}
          qrCode={data.qrCodeDataUrl}
        />
        <DocumentVerificationFooter
          branding={branding}
          verificationCode={data.verificationCode}
          verificationUrl={data.verificationUrl}
        />
      </DocumentPage>
    </Document>
  );
};
