import React from 'react';
import { Document } from '@react-pdf/renderer';
import {
  documentTypeLabel,
  formatDocumentStatus,
  formatHumanDate,
  formatHumanValue,
  humanizeKey,
} from '@/lib/human-readable';
import type { ResolvedTenantBranding } from '@/lib/tenant-branding';
import {
  DocumentFieldGrid,
  DocumentHeader,
  DocumentPage,
  DocumentRow,
  DocumentSection,
  DocumentTable,
  DocumentVerificationBlock,
  DocumentVerificationFooter,
} from './document-system';

export interface SnapshotDocumentData {
  documentType: string;
  documentVersion: number;
  tenantName?: string;
  tenantDocumentFooter?: string;
  branding?: ResolvedTenantBranding | null;
  snapshotData: Record<string, unknown>;
  generatedAt: string;
  status?: string;
  verificationCode?: string;
  verificationUrl?: string;
  qrCodeDataUrl?: string;
}

export const SnapshotDocument: React.FC<{ data: SnapshotDocumentData }> = ({ data }) => {
  const scalars = Object.entries(data.snapshotData).filter(
    ([key, value]) =>
      !/(^id$|tenantId|requestId|tripId|documentId|employeeId|vehicleId|driverId|allocationId|userId|createdByUserId|generatedByUserId)$/i.test(
        key,
      ) &&
      !Array.isArray(value) &&
      !(value && typeof value === 'object'),
  );
  const structured = Object.entries(data.snapshotData).filter(
    ([key, value]) =>
      !/(^id$|tenantId|requestId|tripId|documentId|employeeId|vehicleId|driverId|allocationId|userId|createdByUserId|generatedByUserId)$/i.test(
        key,
      ) &&
      (Array.isArray(value) || Boolean(value && typeof value === 'object')),
  );
  const reference = String(
    data.snapshotData.authorityNumber ||
      data.snapshotData.reference ||
      `${documentTypeLabel(data.documentType)} v${data.documentVersion}`,
  );
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
    <Document title={`${documentTypeLabel(data.documentType)} ${reference}`}>
      <DocumentPage status={data.status}>
        <DocumentHeader
          branding={branding}
          title={documentTypeLabel(data.documentType)}
          reference={reference}
          version={data.documentVersion}
          status={formatDocumentStatus(data.status || 'draft')}
          issueDate={formatHumanDate(data.generatedAt, branding?.locale)}
          qrCode={data.qrCodeDataUrl}
        />
        <DocumentRow>
          <DocumentSection title="Record details">
            <DocumentFieldGrid
              fields={scalars.slice(0, 8).map(([key, value]) => ({
                label: humanizeKey(key),
                value: formatHumanValue(value, key),
              }))}
            />
          </DocumentSection>
          {scalars.length > 8 && (
            <DocumentSection title="Additional details">
              <DocumentFieldGrid
                fields={scalars.slice(8, 16).map(([key, value]) => ({
                  label: humanizeKey(key),
                  value: formatHumanValue(value, key),
                }))}
              />
            </DocumentSection>
          )}
        </DocumentRow>
        {structured.map(([key, value]) => {
          const rows = Array.isArray(value)
            ? value.filter(
                (item): item is Record<string, unknown> =>
                  Boolean(item) && typeof item === 'object',
              )
            : [value as Record<string, unknown>];
          const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
            .filter((column) => !/id$/i.test(column) || /employeeNumber/i.test(column))
            .slice(0, 6)
            .map((column) => ({ key: column, label: humanizeKey(column) }));
          return (
            <DocumentSection key={key} title={humanizeKey(key)}>
              <DocumentTable
                columns={columns}
                rows={rows.map((row) =>
                  Object.fromEntries(
                    columns.map((column) => [
                      column.key,
                      formatHumanValue(row[column.key], column.key),
                    ]),
                  ),
                )}
                emptyLabel={`No ${humanizeKey(key).toLowerCase()} recorded`}
              />
            </DocumentSection>
          );
        })}
        {/* Verification block */}
        <DocumentVerificationBlock
          branding={branding}
          verificationCode={data.verificationCode}
          verificationUrl={data.verificationUrl}
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
