import React from 'react';
import { Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ResolvedTenantBranding } from '@/lib/tenant-branding';

Font.register({
  family: 'Onest',
  fonts: [
    {
      src: 'https://fonts.gstatic.com/s/onest/v9/gNMZW3F-SZuj7zOT0IfSjTS16cPh9R-Zsg.ttf',
      fontWeight: 400,
    },
    {
      src: 'https://fonts.gstatic.com/s/onest/v9/gNMZW3F-SZuj7zOT0IfSjTS16cPhEhiZsg.ttf',
      fontWeight: 700,
    },
  ],
});

export const documentStyles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingHorizontal: 34,
    paddingBottom: 42,
    fontFamily: 'Onest',
    fontSize: 8.2,
    lineHeight: 1.35,
    color: '#111827',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1.2,
    borderBottomColor: '#1F2A44',
    paddingBottom: 8,
    marginBottom: 9,
  },
  identity: { width: '55%', flexDirection: 'row', gap: 8 },
  logo: { width: 42, height: 42, objectFit: 'contain' },
  organisation: { fontSize: 10, fontWeight: 700, color: '#1F2A44' },
  muted: { color: '#4B5563', fontSize: 7 },
  titleBlock: { width: '42%', alignItems: 'flex-end' },
  title: { fontSize: 14, fontWeight: 700, color: '#1F2A44', textAlign: 'right' },
  reference: { fontSize: 8.5, fontWeight: 700, marginTop: 2 },
  meta: { color: '#4B5563', fontSize: 7, marginTop: 1 },
  section: { marginBottom: 8 },
  sectionTitle: {
    color: '#1F2A44',
    fontSize: 8.5,
    fontWeight: 700,
    textTransform: 'uppercase',
    borderBottomWidth: 0.8,
    borderBottomColor: '#D9DEE7',
    paddingBottom: 2.5,
    marginBottom: 3,
  },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  field: {
    width: '50%',
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8EBF0',
    paddingVertical: 2.5,
    paddingRight: 6,
  },
  fieldLabel: { width: '42%', color: '#4B5563', fontSize: 7.2 },
  fieldValue: { width: '58%', color: '#111827', fontSize: 7.5 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F1F3F6',
    borderBottomWidth: 0.8,
    borderBottomColor: '#D9DEE7',
    paddingVertical: 3,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8EBF0',
    paddingVertical: 3,
  },
  tableCell: { flex: 1, paddingHorizontal: 3, fontSize: 7 },
  tableHeading: { flex: 1, paddingHorizontal: 3, fontSize: 6.8, fontWeight: 700 },
  empty: { paddingVertical: 5, color: '#4B5563' },
  status: {
    borderWidth: 0.7,
    borderColor: '#D9DEE7',
    paddingVertical: 2,
    paddingHorizontal: 5,
    fontSize: 7,
    fontWeight: 700,
    textTransform: 'uppercase',
  },
  watermark: {
    position: 'absolute',
    top: '45%',
    left: '16%',
    transform: 'rotate(-32deg)',
    fontSize: 58,
    color: '#E5E7EB',
    opacity: 0.55,
    fontWeight: 700,
  },
  footer: {
    position: 'absolute',
    bottom: 17,
    left: 34,
    right: 34,
    borderTopWidth: 0.7,
    borderTopColor: '#D9DEE7',
    paddingTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    color: '#4B5563',
    fontSize: 6.5,
  },
  signatureRow: { flexDirection: 'row', gap: 14, marginTop: 3 },
  signature: {
    flex: 1,
    minHeight: 42,
    borderTopWidth: 0.7,
    borderTopColor: '#D9DEE7',
    paddingTop: 3,
  },
  signatureImage: { height: 22, maxWidth: 100, objectFit: 'contain', objectPosition: 'left' },
  signatureName: { fontSize: 7.5, fontWeight: 700 },
  qr: { width: 54, height: 54 },
});

export function DocumentPage({ children, status }: { children: React.ReactNode; status?: string }) {
  return (
    <Page size="A4" style={documentStyles.page} wrap>
      {status === 'draft' && <Text style={documentStyles.watermark}>DRAFT</Text>}
      {children}
    </Page>
  );
}

export function DocumentHeader({
  branding,
  title,
  reference,
  version,
  status,
  issueDate,
  qrCode,
}: {
  branding?: ResolvedTenantBranding | null;
  title: string;
  reference: string;
  version: number;
  status: string;
  issueDate: string;
  qrCode?: string;
}) {
  return (
    <View style={documentStyles.header} fixed>
      <View style={documentStyles.identity}>
        {branding?.logoUrl ? <Image src={branding.logoUrl} style={documentStyles.logo} /> : null}
        <View>
          <Text style={documentStyles.organisation}>
            {branding?.organisationName || 'Government Fleet'}
          </Text>
          {branding?.division && <Text style={documentStyles.muted}>{branding.division}</Text>}
          {branding?.address && <Text style={documentStyles.muted}>{branding.address}</Text>}
          <Text style={documentStyles.muted}>
            {[branding?.phone, branding?.email, branding?.website].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
      <View style={documentStyles.titleBlock}>
        <Text style={documentStyles.title}>{title.toUpperCase()}</Text>
        <Text style={documentStyles.reference}>{reference}</Text>
        <Text style={documentStyles.meta}>
          Version {version} · {issueDate}
        </Text>
        <Text style={documentStyles.status}>{status}</Text>
        {qrCode ? <Image src={qrCode} style={documentStyles.qr} /> : null}
      </View>
    </View>
  );
}

export function DocumentSection({
  title,
  children,
  wrap = true,
}: {
  title: string;
  children: React.ReactNode;
  wrap?: boolean;
}) {
  return (
    <View style={documentStyles.section} wrap={wrap}>
      <Text style={documentStyles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function DocumentFieldGrid({ fields }: { fields: Array<{ label: string; value: string }> }) {
  return (
    <View style={documentStyles.fieldGrid}>
      {fields.map((field) => (
        <View key={field.label} style={documentStyles.field}>
          <Text style={documentStyles.fieldLabel}>{field.label}</Text>
          <Text style={documentStyles.fieldValue}>{field.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function DocumentTable({
  columns,
  rows,
  emptyLabel = 'No records',
}: {
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string>>;
  emptyLabel?: string;
}) {
  if (!rows.length) return <Text style={documentStyles.empty}>{emptyLabel}</Text>;
  return (
    <View>
      <View style={documentStyles.tableHeader} fixed>
        {columns.map((column) => (
          <Text key={column.key} style={documentStyles.tableHeading}>
            {column.label}
          </Text>
        ))}
      </View>
      {rows.map((row, index) => (
        <View key={index} style={documentStyles.tableRow} wrap={false}>
          {columns.map((column) => (
            <Text key={column.key} style={documentStyles.tableCell}>
              {row[column.key] || 'Not recorded'}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

export function DocumentSignature({
  name,
  role,
  signedAt,
  signatureUrl,
}: {
  name: string;
  role: string;
  signedAt?: string;
  signatureUrl?: string;
}) {
  return (
    <View style={documentStyles.signature}>
      {signatureUrl ? <Image src={signatureUrl} style={documentStyles.signatureImage} /> : null}
      <Text style={documentStyles.signatureName}>{name}</Text>
      <Text style={documentStyles.muted}>{role}</Text>
      <Text style={documentStyles.muted}>
        {signedAt ? `Digitally approved · ${signedAt}` : 'Signature not applied'}
      </Text>
    </View>
  );
}

export function DocumentVerificationFooter({
  branding,
  verificationCode,
  verificationUrl,
}: {
  branding?: ResolvedTenantBranding | null;
  verificationCode?: string;
  verificationUrl?: string;
}) {
  return (
    <View style={documentStyles.footer} fixed>
      <Text>{branding?.documentFooter || 'Official GovFleet digital record'}</Text>
      <Text>
        {verificationCode ? `Verify: ${verificationCode}` : 'Internal record'}
        {verificationUrl ? ` · ${verificationUrl}` : ''}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}
