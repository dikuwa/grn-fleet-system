import React from 'react';
import { Document } from '@react-pdf/renderer';
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
  DocumentRow,
  DocumentSection,
  DocumentVerificationBlock,
  DocumentVerificationFooter,
  DocumentExecutiveCertification,
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
  routeKm?: number;
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
  eventSummary?: {
    total: number;
    incidents: number;
    defects: number;
    accidents: number;
    injuries: number;
    critical: number;
    events: Array<{
      number?: string | null;
      type: string;
      severity: string;
      occurredAt: string;
      continuationState: string;
      status: string;
      policeReference?: string | null;
      description: string;
    }>;
  };

  tenantName?: string;
  tenantDocumentFooter?: string;
  branding?: ResolvedTenantBranding | null;
  documentVersion?: number;
  generatedAt?: string;
  statusText?: string;
  verificationCode?: string;
  verificationUrl?: string;
  documentHash?: string;
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
    <Document title={`Trip Completion — ${data.vehicle.licenceNumber || data.tripId.slice(0, 8)}`}>
      <DocumentPage status={status === 'draft' ? 'draft' : undefined}>
        <DocumentHeader
          branding={branding}
          title="Trip Completion Report"
          reference={`TC-${data.tripId.slice(0, 8).toUpperCase()}`}
          version={data.documentVersion || 1}
          status={formatDocumentStatus(status)}
          issueDate={data.generatedAt ? formatHumanDate(data.generatedAt, branding?.locale) : undefined}
          qrCode={data.qrCodeDataUrl}
        />

        {/* Row 1: Trip summary | Dates */}
        <DocumentRow>
          <DocumentSection title="Trip summary">
            <DocumentFieldGrid
              fields={[
                { label: 'Vehicle registration', value: data.vehicle.licenceNumber },
                {
                  label: 'Asset register number',
                  value: data.vehicle.registrationNumber || 'Not recorded',
                },
                { label: 'Status', value: formatDocumentStatus(data.status) },
                {
                  label: 'Fuel total',
                  value: data.fuelSummary
                    ? `${data.fuelSummary.totalLitres.toLocaleString('en-NA', { minimumFractionDigits: 1 })} L`
                    : 'Not recorded',
                },
                {
                  label: 'Fuel cost',
                  value: data.fuelSummary
                    ? formatMoney(data.fuelSummary.totalCost, branding?.locale)
                    : 'Not recorded',
                },
              ]}
            />
          </DocumentSection>
          <DocumentSection title="Trip dates">
            <DocumentFieldGrid
              fields={[
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
        </DocumentRow>

        {/* Row 2: Closure details | Fuel usage */}
        <DocumentRow>
          {data.closure && (
            <DocumentSection title="Closure details" wrap={false}>
              <DocumentFieldGrid
                fields={[
                  { label: 'Route distance', value: formatHumanValue(data.routeKm, 'kilometres') },
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
                  { label: 'Transactions', value: String(data.fuelSummary.transactionCount) },
                  {
                    label: 'Pending reimbursements',
                    value: String(data.fuelSummary.pendingReimbursements),
                  },
                ]}
              />
            </DocumentSection>
          )}
        </DocumentRow>

        <DocumentSection title="Trip incidents, accidents and defects" wrap={false}>
          <DocumentFieldGrid
            fields={[
              { label: 'All events', value: String(data.eventSummary?.total ?? 0) },
              { label: 'Incidents', value: String(data.eventSummary?.incidents ?? 0) },
              { label: 'Defects', value: String(data.eventSummary?.defects ?? 0) },
              { label: 'Accidents', value: String(data.eventSummary?.accidents ?? 0) },
              { label: 'Injuries', value: String(data.eventSummary?.injuries ?? 0) },
              { label: 'Critical events', value: String(data.eventSummary?.critical ?? 0) },
            ]}
          />
          {(data.eventSummary?.events || []).map((event) => (
            <DocumentFieldGrid
              key={event.number || `${event.type}-${event.occurredAt}`}
              fields={[
                { label: 'Event number', value: event.number || 'Pending' },
                {
                  label: 'Type / severity',
                  value: `${humanizeKey(event.type)} · ${humanizeKey(event.severity)}`,
                },
                { label: 'Date', value: formatHumanDate(event.occurredAt, branding?.locale) },
                { label: 'Journey state', value: humanizeKey(event.continuationState) },
                { label: 'Police reference', value: event.policeReference || 'Not applicable' },
                { label: 'Outcome', value: `${humanizeKey(event.status)} — ${event.description}` },
              ]}
            />
          ))}
        </DocumentSection>

        <DocumentExecutiveCertification branding={branding} generatedAt={data.generatedAt} />
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
          documentHash={data.documentHash}
          generatedAt={data.generatedAt}
        />
      </DocumentPage>
    </Document>
  );
};
