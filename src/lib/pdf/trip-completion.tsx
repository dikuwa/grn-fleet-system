import React from 'react';
import { Document, View } from '@react-pdf/renderer';
import type { ResolvedTenantBranding } from '@/lib/tenant-branding';
import {
  formatDocumentStatus,
  formatHumanDate,
  formatMoney,
  formatHumanValue,
  humanizeKey,
} from '@/lib/human-readable';
import {
  DocumentFieldGrid,
  DocumentHeader,
  DocumentPage,
  DocumentSection,
  DocumentTable,
  DocumentVerificationFooter,
} from './document-system';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TripCompletionData {
  tripId: string;
  status: string;
  vehicle: {
    licenceNumber: string;
    registrationNumber?: string;
  };
  issuedAt?: string;
  startedAt?: string;
  returnedAt?: string;
  closedAt?: string;
  closure?: {
    authorisedKm?: number | null;
    actualKm?: number | null;
    variance?: number | null;
    decision?: string;
    notes?: string | null;
  } | null;
  fuelSummary?: {
    totalLitres: number;
    totalCost: number;
    transactionCount: number;
    pendingReimbursements: number;
  } | null;

  tenantName?: string;
  tenantDocumentFooter?: string;
  branding?: ResolvedTenantBranding | null;
  documentVersion?: number;
  generatedAt?: string;
  statusText?: string;
  verificationCode?: string;
  verificationUrl?: string;
  qrCodeDataUrl?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TripCompletionDocument: React.FC<{ data: TripCompletionData }> = ({ data }) => {
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

  const status = data.statusText || data.status || 'issued';

  return (
    <Document
      title={`Trip Completion — ${data.vehicle.licenceNumber || data.tripId.slice(0, 8)}`}
    >
      <DocumentPage status={status === 'draft' ? 'draft' : undefined}>
        <DocumentHeader
          branding={branding}
          title="Trip Completion Report"
          reference={`TC-${data.tripId.slice(0, 8).toUpperCase()}`}
          version={data.documentVersion || 1}
          status={formatDocumentStatus(status)}
          issueDate={formatHumanDate(
            data.generatedAt || new Date().toISOString(),
            branding?.locale,
          )}
          qrCode={data.qrCodeDataUrl}
        />

        {/* Trip summary */}
        <DocumentSection title="Trip summary">
          <DocumentFieldGrid
            fields={[
              {
                label: 'Vehicle registration',
                value: data.vehicle.licenceNumber,
              },
              {
                label: 'Asset register number',
                value: data.vehicle.registrationNumber || 'Not recorded',
              },
              {
                label: 'Status',
                value: formatDocumentStatus(data.status),
              },
              {
                label: 'Issued',
                value: data.issuedAt
                  ? formatHumanDate(data.issuedAt, branding?.locale)
                  : 'Not recorded',
              },
              {
                label: 'Started',
                value: data.startedAt
                  ? formatHumanDate(data.startedAt, branding?.locale)
                  : 'Not recorded',
              },
              {
                label: 'Returned',
                value: data.returnedAt
                  ? formatHumanDate(data.returnedAt, branding?.locale)
                  : 'Not recorded',
              },
              {
                label: 'Closed',
                value: data.closedAt
                  ? formatHumanDate(data.closedAt, branding?.locale)
                  : 'Not recorded',
              },
            ]}
          />
        </DocumentSection>

        {/* Closure details */}
        {data.closure && (
          <DocumentSection title="Closure details" wrap={false}>
            <DocumentFieldGrid
              fields={[
                {
                  label: 'Authorised kilometres',
                  value: formatHumanValue(data.closure.authorisedKm, 'kilometres'),
                },
                {
                  label: 'Actual kilometres',
                  value: formatHumanValue(data.closure.actualKm, 'kilometres'),
                },
                {
                  label: 'Variance',
                  value:
                    data.closure.variance != null
                      ? `${data.closure.variance >= 0 ? '+' : ''}${data.closure.variance.toLocaleString('en-NA')} km`
                      : 'Not recorded',
                },
                {
                  label: 'Decision',
                  value: data.closure.decision
                    ? humanizeKey(data.closure.decision)
                    : 'Not recorded',
                },
                {
                  label: 'Review notes',
                  value: data.closure.notes || 'No notes recorded',
                },
              ]}
            />
          </DocumentSection>
        )}

        {/* Fuel summary */}
        {data.fuelSummary && (
          <DocumentSection title="Fuel usage" wrap={false}>
            <DocumentFieldGrid
              fields={[
                {
                  label: 'Total litres',
                  value: `${data.fuelSummary.totalLitres.toLocaleString('en-NA', {
                    minimumFractionDigits: 1,
                  })} L`,
                },
                {
                  label: 'Total cost',
                  value: formatMoney(data.fuelSummary.totalCost, branding?.locale),
                },
                {
                  label: 'Transactions',
                  value: String(data.fuelSummary.transactionCount),
                },
                {
                  label: 'Pending reimbursements',
                  value: String(data.fuelSummary.pendingReimbursements),
                },
              ]}
            />
          </DocumentSection>
        )}

        <DocumentVerificationFooter
          branding={branding}
          verificationCode={data.verificationCode}
          verificationUrl={data.verificationUrl}
        />
      </DocumentPage>
    </Document>
  );
};
