import React from 'react';
import { Document } from '@react-pdf/renderer';
import type { ResolvedTenantBranding } from '@/lib/tenant-branding';
import {
  formatDocumentStatus,
  formatHumanDate,
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

export interface FuelSummaryData {
  tripId: string;
  totalLitres?: number | null;
  totalCost?: number | null;
  transactionCount?: number | null;
  pendingReimbursements?: number | null;
  actualKilometres?: number | null;
  kilometreVariance?: number | null;

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

  // Optional enriched fields
  vehicleLicence?: string;
  vehicleRegisterNumber?: string;
  tripReference?: string;
  tripPurpose?: string;

  transactions?: Array<{
    transactionAt?: string;
    stationName?: string;
    fuelType?: string;
    litres: number;
    amount: number;
    paymentMethod?: string;
    odometerReading?: number | null;
  }>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FuelSummaryDocument: React.FC<{ data: FuelSummaryData }> = ({ data }) => {
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
  const formatOptionalNumber = (value: number | null | undefined, suffix = '') =>
    value == null ? 'Not recorded' : `${value.toLocaleString('en-NA')}${suffix}`;

  return (
    <Document title={`Fuel Summary — ${data.vehicleLicence || data.tripId.slice(0, 8)}`}>
      <DocumentPage status={status === 'draft' ? 'draft' : undefined}>
        <DocumentHeader
          branding={branding}
          title="Fuel Summary"
          reference={`FUEL-${data.tripId.slice(0, 8).toUpperCase()}`}
          version={data.documentVersion || 1}
          status={formatDocumentStatus(status)}
          issueDate={data.generatedAt ? formatHumanDate(data.generatedAt, branding?.locale) : undefined}
          qrCode={data.qrCodeDataUrl}
        />

        {/* Row 1: Trip information | Fuel summary */}
        <DocumentRow>
          <DocumentSection title="Trip information">
            <DocumentFieldGrid
              fields={[
                { label: 'Trip reference', value: data.tripReference || 'Not recorded' },
                { label: 'Vehicle registration', value: data.vehicleLicence || 'Not recorded' },
                {
                  label: 'Asset register number',
                  value: data.vehicleRegisterNumber || 'Not recorded',
                },
                { label: 'Purpose', value: data.tripPurpose || 'Not recorded' },
              ]}
            />
          </DocumentSection>
          <DocumentSection title="Fuel summary">
            <DocumentFieldGrid
              fields={[
                {
                  label: 'Total litres',
                  value:
                    data.totalLitres == null
                      ? 'Not recorded'
                      : `${data.totalLitres.toLocaleString('en-NA', {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })} L`,
                },
                {
                  label: 'Total cost',
                  value:
                    data.totalCost == null
                      ? 'Not recorded'
                      : formatMoney(data.totalCost, branding?.locale),
                },
                {
                  label: 'Transactions',
                  value: formatOptionalNumber(data.transactionCount),
                },
                {
                  label: 'Pending reimbursements',
                  value: formatOptionalNumber(data.pendingReimbursements),
                },
                {
                  label: 'Actual kilometres',
                  value: formatOptionalNumber(data.actualKilometres, ' km'),
                },
                {
                  label: 'Kilometre variance',
                  value:
                    data.kilometreVariance == null
                      ? 'Not recorded'
                      : `${data.kilometreVariance >= 0 ? '+' : ''}${data.kilometreVariance.toLocaleString('en-NA')} km`,
                },
              ]}
            />
          </DocumentSection>
        </DocumentRow>

        {/* Transactions table */}
        {data.transactions && data.transactions.length > 0 && (
          <DocumentSection title={`Fuel transactions (${data.transactions.length})`}>
            <DocumentTable
              columns={[
                { key: 'date', label: 'Date' },
                { key: 'station', label: 'Station' },
                { key: 'fuelType', label: 'Fuel type' },
                { key: 'litres', label: 'Litres' },
                { key: 'amount', label: 'Amount' },
                { key: 'method', label: 'Payment' },
              ]}
              rows={data.transactions.map((t) => ({
                date: t.transactionAt
                  ? formatHumanDate(t.transactionAt, branding?.locale)
                  : 'Not recorded',
                station: t.stationName || 'Not recorded',
                fuelType: humanizeKey(t.fuelType || 'diesel'),
                litres: `${t.litres.toLocaleString('en-NA', {
                  minimumFractionDigits: 1,
                })} L`,
                amount: formatMoney(t.amount, branding?.locale),
                method: humanizeKey(t.paymentMethod || 'fuel_card'),
              }))}
              emptyLabel="No fuel transactions recorded"
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
          documentHash={data.documentHash}
        />
      </DocumentPage>
    </Document>
  );
};
