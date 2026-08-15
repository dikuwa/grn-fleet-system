import React from 'react';
import { Document, Text, View, StyleSheet } from '@react-pdf/renderer';
import type { ResolvedTenantBranding } from '@/lib/tenant-branding';
import { formatDocumentStatus, formatHumanDate, humanizeKey } from '@/lib/human-readable';
import {
  DocumentFieldGrid,
  DocumentHeader,
  DocumentPage,
  DocumentRow,
  DocumentSection,
  DocumentVerificationBlock,
  DocumentVerificationFooter,
  DocumentExecutiveCertification,
} from './document-system';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MvaReportData {
  reference: string;
  severity?: string | null;
  status: string;
  occurredAt?: string | null;
  location: string | null;
  description: string;
  immediateAction: string | null;
  continuationState: string | null;
  vehicleSafe: boolean | null;
  passengerSafe: boolean | null;
  injuries?: boolean | null;
  numberInjured?: number | null;
  vehicleDamage?: boolean | null;
  thirdPartyInvolvement?: boolean | null;
  policeReference: string | null;
  emergencyServicesContacted?: boolean | null;
  detailsRequired?: boolean | null;

  // Trip context
  tripReferences: {
    transportRequest: string;
    tripAuthority: string;
  };
  vehicle: {
    registration: string;
    registerNumber: string;
    make: string;
    model: string;
  };

  // MVA-specific
  accidentReportNumber: string | null;
  investigationStatus: string;
  investigationNotes: string | null;
  investigationClosedAt: string | null;
  witnessStatements: Array<Record<string, unknown>> | null;
  thirdPartyDetails: Record<string, unknown> | null;

  // Insurance
  insuranceClaimReference: string | null;
  insuranceNotified?: boolean | null;
  insuranceNotifiedAt: string | null;
  policeReportFiled?: boolean | null;
  thirdPartyInsuranceDetails: Record<string, unknown> | null;

  // Technical clearance
  technicalClearanceStatus: string;
  technicalClearanceAt: string | null;
  technicalClearanceByUserId: string | null;

  // Meta
  tenantName?: string;
  tenantDocumentFooter?: string;
  branding?: ResolvedTenantBranding | null;
  documentVersion?: number;
  generatedAt?: string;
  verificationCode?: string;
  verificationUrl?: string;
  documentHash?: string;
  qrCodeDataUrl?: string;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  badge: {
    backgroundColor: '#F3F4F6',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 9,
    color: '#374151',
    textTransform: 'capitalize',
  },
  badgeCritical: { backgroundColor: '#FEE2E2', color: '#991B1B' },
  badgeInfo: { backgroundColor: '#DBEAFE', color: '#1E40AF' },
  badgeSuccess: { backgroundColor: '#D1FAE5', color: '#065F46' },
  witnessCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 4,
    padding: 8,
    marginBottom: 6,
  },
  witnessName: { fontSize: 10, fontWeight: 'bold', marginBottom: 2 },
  witnessDetail: { fontSize: 9, color: '#6B7280' },
  footer: { fontSize: 8, color: '#9CA3AF', marginTop: 12, textAlign: 'center' },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const humanStatus = (s: string) => humanizeKey(s).replace(/_/g, ' ');
const yesNoUnknown = (value: boolean | null | undefined) =>
  value === true ? 'Yes' : value === false ? 'No' : 'Not recorded';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MvaReportDocument: React.FC<{ data: MvaReportData }> = ({ data }) => {
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

  const witnessCount = Array.isArray(data.witnessStatements) ? data.witnessStatements.length : 0;

  return (
    <Document title={`Motor Vehicle Accident Report — ${data.reference}`}>
      <DocumentPage>
        <DocumentHeader
          branding={branding}
          title="Motor Vehicle Accident Report"
          reference={data.accidentReportNumber || data.reference}
          version={data.documentVersion || 1}
          status={formatDocumentStatus(data.status)}
          issueDate={data.generatedAt ? formatHumanDate(data.generatedAt, branding?.locale) : undefined}
          qrCode={data.qrCodeDataUrl}
        />

        {/* ---- Section 1: Incident Overview ---- */}
        <DocumentSection title="Incident Overview">
          <DocumentRow>
            <DocumentFieldGrid
              fields={[
                { label: 'MVAR number', value: data.accidentReportNumber || 'Pending' },
                { label: 'Severity', value: data.severity ? humanizeKey(data.severity) : 'Not recorded' },
                { label: 'Incident reference', value: data.reference },
                { label: 'Transport request', value: data.tripReferences.transportRequest },
                { label: 'Trip authority', value: data.tripReferences.tripAuthority || '—' },
              ]}
            />
          </DocumentRow>
          <DocumentRow>
            <DocumentFieldGrid
              fields={[
                {
                  label: 'Date & time of accident',
                  value: data.occurredAt
                    ? formatHumanDate(data.occurredAt, branding?.locale)
                    : 'Not recorded',
                },
                { label: 'Location', value: data.location || 'Not recorded' },
                {
                  label: 'Continuation state',
                  value: data.continuationState ? humanStatus(data.continuationState) : 'Not recorded',
                },
                {
                  label: 'Vehicle safe',
                  value:
                    data.vehicleSafe === true
                      ? 'Yes'
                      : data.vehicleSafe === false
                        ? 'No'
                        : 'Not assessed',
                },
                {
                  label: 'Passenger(s) safe',
                  value:
                    data.passengerSafe === true
                      ? 'Yes'
                      : data.passengerSafe === false
                        ? 'No'
                        : 'Not assessed',
                },
              ]}
            />
          </DocumentRow>
        </DocumentSection>

        {/* ---- Section 2: Vehicle ---- */}
        <DocumentSection title="Vehicle Details">
          <DocumentFieldGrid
            fields={[
              { label: 'Registration', value: data.vehicle.registration || 'Not recorded' },
              { label: 'Register number', value: data.vehicle.registerNumber || 'Not recorded' },
              { label: 'Make', value: data.vehicle.make || 'Not recorded' },
              { label: 'Model', value: data.vehicle.model || 'Not recorded' },
              {
                label: 'Injuries',
                value:
                  data.injuries === true
                    ? data.numberInjured == null
                      ? 'Reported; count not recorded'
                      : `${data.numberInjured} reported`
                    : data.injuries === false
                      ? 'None reported'
                      : 'Not recorded',
              },
              { label: 'Vehicle damage', value: yesNoUnknown(data.vehicleDamage) },
              { label: 'Third party involved', value: yesNoUnknown(data.thirdPartyInvolvement) },
            ]}
          />
        </DocumentSection>

        {/* ---- Section 3: Emergency Response ---- */}
        <DocumentSection title="Emergency Response">
          <DocumentFieldGrid
            fields={[
              {
                label: 'Emergency services contacted',
                value: yesNoUnknown(data.emergencyServicesContacted),
              },
              { label: 'Police reference', value: data.policeReference || 'Not recorded' },
              { label: 'Police report filed', value: yesNoUnknown(data.policeReportFiled) },
              { label: 'Immediate action taken', value: data.immediateAction || 'Not recorded' },
            ]}
          />
        </DocumentSection>

        {/* ---- Section 4: Description ---- */}
        <DocumentSection title="Description of Incident">
          <View style={{ marginTop: 4 }}>
            <Text style={{ fontSize: 10, color: '#374151', lineHeight: 1.6 }}>
              {data.description || 'No description recorded'}
            </Text>
          </View>
        </DocumentSection>

        {/* ---- Section 5: Investigation ---- */}
        <DocumentSection title="Investigation Status">
          <DocumentRow>
            <DocumentFieldGrid
              fields={[
                { label: 'Status', value: humanStatus(data.investigationStatus) },
                {
                  label: 'Closed at',
                  value: data.investigationClosedAt
                    ? formatHumanDate(data.investigationClosedAt, branding?.locale)
                    : '—',
                },
                {
                  label: 'Witnesses',
                  value: witnessCount > 0 ? `${witnessCount} statement(s)` : 'None recorded',
                },
              ]}
            />
          </DocumentRow>
          {data.investigationNotes ? (
            <View style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#374151', marginBottom: 4 }}>
                Investigation notes:
              </Text>
              <Text style={{ fontSize: 9, color: '#6B7280', lineHeight: 1.5 }}>
                {data.investigationNotes}
              </Text>
            </View>
          ) : null}
        </DocumentSection>

        {/* ---- Section 6: Witnesses ---- */}
        {Array.isArray(data.witnessStatements) && data.witnessStatements.length > 0 ? (
          <DocumentSection title="Witness Statements">
            {data.witnessStatements.map((w, idx) => (
              <View key={String(idx)} style={styles.witnessCard}>
                <Text style={styles.witnessName}>
                  Witness {idx + 1}: {String((w as Record<string, unknown>).name ?? 'Not named')}
                </Text>
                {(w as Record<string, unknown>).phone ? (
                  <Text style={styles.witnessDetail}>
                    Phone: {String((w as Record<string, unknown>).phone)}
                  </Text>
                ) : null}
                {(w as Record<string, unknown>).statement ? (
                  <Text style={styles.witnessDetail}>
                    {String((w as Record<string, unknown>).statement)}
                  </Text>
                ) : null}
              </View>
            ))}
          </DocumentSection>
        ) : null}

        {/* ---- Section 7: Insurance ---- */}
        <DocumentSection title="Insurance Details">
          <DocumentFieldGrid
            fields={[
              {
                label: 'Insurer notified',
                value: yesNoUnknown(data.insuranceNotified),
              },
              {
                label: 'Notified at',
                value: data.insuranceNotifiedAt
                  ? formatHumanDate(data.insuranceNotifiedAt, branding?.locale)
                  : '—',
              },
              { label: 'Claim reference', value: data.insuranceClaimReference || 'Pending' },
              {
                label: 'Third party insurer',
                value: data.thirdPartyInsuranceDetails
                  ? JSON.stringify(data.thirdPartyInsuranceDetails)
                  : 'Not recorded',
              },
            ]}
          />
        </DocumentSection>

        {/* ---- Section 8: Technical Clearance ---- */}
        <DocumentSection title="Technical Clearance">
          <DocumentFieldGrid
            fields={[
              { label: 'Status', value: humanStatus(data.technicalClearanceStatus) },
              {
                label: 'Cleared at',
                value: data.technicalClearanceAt
                  ? formatHumanDate(data.technicalClearanceAt, branding?.locale)
                  : '—',
              },
              {
                label: 'Cleared by user',
                value: data.technicalClearanceByUserId?.slice(0, 8) || '—',
              },
            ]}
          />
        </DocumentSection>

        {/* ---- Footer ---- */}
        {data.detailsRequired === true ? (
          <View style={{ marginTop: 8, padding: 6, backgroundColor: '#FEF3C7', borderRadius: 4 }}>
            <Text style={{ fontSize: 9, color: '#92400E', fontWeight: 'bold' }}>
              ⚠ Additional details are required before this report can be finalised.
            </Text>
          </View>
        ) : null}

        <DocumentExecutiveCertification
          branding={branding}
          generatedAt={data.generatedAt}
          statement="I certify that this incident report is the official system record available at the time of issue."
        />
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
          documentHash={data.documentHash}
          generatedAt={data.generatedAt}
        />
      </DocumentPage>
    </Document>
  );
};
