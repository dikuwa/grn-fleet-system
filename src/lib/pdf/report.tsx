import React from 'react';
import { Document, View } from '@react-pdf/renderer';
import type { ResolvedTenantBranding } from '@/lib/tenant-branding';
import { formatHumanValue } from '@/lib/human-readable';
import {
  DocumentFieldGrid,
  DocumentHeader,
  DocumentPage,
  DocumentSection,
  DocumentTable,
  DocumentVerificationBlock,
  DocumentVerificationFooter,
  tenantPdfTheme,
} from './document-system';

export interface ReportColumn {
  key: string;
  label: string;
  width?: string | number;
  align?: 'left' | 'center' | 'right';
}

export interface ReportData {
  title: string;
  period: string;
  tenantName?: string;
  tenantDocumentFooter?: string;
  branding?: ResolvedTenantBranding | null;
  generatedAt: string;
  summary?: { label: string; value: string }[];
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totalRowCount: number;
  verificationCode?: string;
  verificationUrl?: string;
  documentHash?: string;
  qrCodeDataUrl?: string;
  orientation?: 'portrait' | 'landscape';
}

export const ReportDocument: React.FC<{ data: ReportData }> = ({ data }) => {
  const branding =
    data.branding ||
    (data.tenantName
      ? {
          tenantId: '',
          organisationName: data.tenantName,
          code: '',
          locale: 'en-NA',
          timezone: 'Africa/Windhoek',
          primaryColor: '#245B9E',
          accentColor: '#0F766E',
          documentFooter: data.tenantDocumentFooter,
        }
      : null);
  const theme = tenantPdfTheme(branding);
  const fallbackWidth = `${100 / Math.max(data.columns.length, 1)}%`;
  return (
    <Document title={data.title} author={branding?.organisationName || 'Government Fleet'}>
      <DocumentPage
        orientation={data.orientation}
        continuationLabel={`${branding?.organisationName || 'Government Fleet'} · ${data.title}`}
      >
        <DocumentHeader
          branding={branding}
          title={data.title}
          reference={data.verificationCode || data.period}
          version={1}
          status="Generated"
          issueDate={data.generatedAt}
          theme={theme}
        />
        <DocumentSection title="Report identity" theme={theme} wrap={false}>
          <DocumentFieldGrid
            columns={3}
            fields={[
              { label: 'Period', value: data.period },
              { label: 'Generated', value: data.generatedAt },
              { label: 'Total records', value: data.totalRowCount },
            ]}
          />
        </DocumentSection>
        {data.summary?.length ? (
          <DocumentSection title="Summary" theme={theme} wrap={false}>
            <DocumentFieldGrid
              columns={data.summary.length >= 3 ? 3 : 2}
              fields={data.summary.map((item) => ({ label: item.label, value: item.value }))}
            />
          </DocumentSection>
        ) : null}
        <DocumentSection title="Records" theme={theme}>
          <DocumentTable
            theme={theme}
            columns={data.columns.map((column) => ({
              ...column,
              width: column.width || fallbackWidth,
            }))}
            rows={data.rows.map((row) =>
              Object.fromEntries(
                data.columns.map((column) => [
                  column.key,
                  formatHumanValue(row[column.key], column.key),
                ]),
              ),
            )}
            emptyLabel="No records found for the selected period"
          />
        </DocumentSection>
        <View wrap={false}>
          <DocumentVerificationBlock
            branding={branding}
            verificationCode={data.verificationCode}
            verificationUrl={data.verificationUrl}
            documentHash={data.documentHash}
            qrCode={data.qrCodeDataUrl}
            theme={theme}
          />
        </View>
        <DocumentVerificationFooter
          branding={branding}
          verificationCode={data.verificationCode}
          verificationUrl={data.verificationUrl}
          documentHash={data.documentHash}
          generatedAt={data.generatedAt}
          theme={theme}
        />
      </DocumentPage>
    </Document>
  );
};
