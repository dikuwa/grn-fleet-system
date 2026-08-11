import React from 'react';
import { Document } from '@react-pdf/renderer';
import type { ResolvedTenantBranding } from '@/lib/tenant-branding';
import {
  formatDocumentStatus,
  formatHumanDate,
  formatHumanValue,
  formatMoney,
  humanizeKey,
} from '@/lib/human-readable';
import {
  DocumentFieldGrid,
  DocumentHeader,
  DocumentPage,
  DocumentRow,
  DocumentSection,
  DocumentTable,
  DocumentVerificationBlock,
  DocumentVerificationFooter,
  DocumentExecutiveCertification,
} from './document-system';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaintenanceReportData {
  vehicleId: string;
  vehicle?: string;
  totalEvents: number;
  totalCost: number;
  nextServiceDate?: string | null;
  nextServiceOdometer?: number | null;

  tenantName?: string;
  tenantDocumentFooter?: string;
  branding?: ResolvedTenantBranding | null;
  documentVersion?: number;
  generatedAt?: string;
  status?: string;
  verificationCode?: string;
  verificationUrl?: string;
  documentHash?: string;
  qrCodeDataUrl?: string;

  // Enriched fields
  licenceNumber?: string;
  vehicleRegisterNumber?: string;
  make?: string;
  model?: string;

  events: Array<{
    date?: string;
    type?: string;
    description?: string;
    cost?: number | null;
    vendor?: string | null;
    odometer?: number | null;
  }>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MaintenanceReportDocument: React.FC<{ data: MaintenanceReportData }> = ({ data }) => {
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

  const status = data.status || 'issued';

  return (
    <Document
      title={`Maintenance Report — ${data.licenceNumber || data.vehicle || data.vehicleId.slice(0, 8)}`}
    >
      <DocumentPage status={status === 'draft' ? 'draft' : undefined}>
        <DocumentHeader
          branding={branding}
          title="Maintenance Report"
          reference={`MNT-${data.vehicleId.slice(0, 8).toUpperCase()}`}
          version={data.documentVersion || 1}
          status={formatDocumentStatus(status)}
          issueDate={formatHumanDate(
            data.generatedAt || new Date().toISOString(),
            branding?.locale,
          )}
          qrCode={data.qrCodeDataUrl}
        />

        {/* Row 1: Vehicle information | Service schedule */}
        <DocumentRow>
          <DocumentSection title="Vehicle information">
            <DocumentFieldGrid
              fields={[
                {
                  label: 'Vehicle',
                  value:
                    data.vehicle ||
                    [data.make, data.model].filter(Boolean).join(' ') ||
                    'Not recorded',
                },
                { label: 'Registration', value: data.licenceNumber || 'Not recorded' },
                {
                  label: 'Asset register number',
                  value: data.vehicleRegisterNumber || 'Not recorded',
                },
                { label: 'Status', value: formatDocumentStatus(status) },
              ]}
            />
          </DocumentSection>
          <DocumentSection title="Service schedule">
            <DocumentFieldGrid
              fields={[
                { label: 'Total maintenance events', value: String(data.totalEvents) },
                { label: 'Total cost', value: formatMoney(data.totalCost, branding?.locale) },
                {
                  label: 'Next service date',
                  value: data.nextServiceDate
                    ? formatHumanDate(data.nextServiceDate, branding?.locale)
                    : 'Not scheduled',
                },
                {
                  label: 'Next service odometer',
                  value: formatHumanValue(data.nextServiceOdometer, 'odometer'),
                },
              ]}
            />
          </DocumentSection>
        </DocumentRow>

        {/* Events table */}
        {data.events && data.events.length > 0 && (
          <DocumentSection title={`Maintenance events (${data.events.length})`}>
            <DocumentTable
              columns={[
                { key: 'date', label: 'Date' },
                { key: 'type', label: 'Service type' },
                { key: 'description', label: 'Description' },
                { key: 'odometer', label: 'Odometer' },
                { key: 'cost', label: 'Cost' },
                { key: 'vendor', label: 'Vendor' },
              ]}
              rows={data.events.map((ev) => ({
                date: ev.date ? formatHumanDate(ev.date, branding?.locale) : 'Not recorded',
                type: ev.type ? humanizeKey(ev.type) : 'Not recorded',
                description: ev.description || 'Not recorded',
                odometer:
                  ev.odometer != null
                    ? `${ev.odometer.toLocaleString('en-NA')} km`
                    : 'Not recorded',
                cost: ev.cost != null ? formatMoney(ev.cost, branding?.locale) : 'Not recorded',
                vendor: ev.vendor || 'Not recorded',
              }))}
              emptyLabel="No maintenance events recorded"
            />
          </DocumentSection>
        )}

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
        />
      </DocumentPage>
    </Document>
  );
};
