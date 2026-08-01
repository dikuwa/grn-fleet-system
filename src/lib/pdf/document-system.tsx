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
    paddingTop: 24,
    paddingHorizontal: 30,
    paddingBottom: 54,
    fontFamily: 'Onest',
    fontSize: 8,
    lineHeight: 1.3,
    color: '#111827',
  },
  // ── Three-zone header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1.2,
    borderBottomColor: '#1F2A44',
    paddingBottom: 6,
    marginBottom: 7,
  },
  headerLogoZone: { width: '24%', justifyContent: 'center' },
  logo: { width: 'auto', height: 38, objectFit: 'contain', maxWidth: 52 },
  headerOrgZone: { width: '44%', justifyContent: 'center' },
  organisation: { fontSize: 9, fontWeight: 700, color: '#1F2A44' },
  orgDetail: { color: '#4B5563', fontSize: 6.5, marginTop: 1 },
  headerTitleZone: { width: '32%', alignItems: 'flex-end', justifyContent: 'center' },
  title: { fontSize: 13, fontWeight: 700, color: '#1F2A44', textAlign: 'right' },
  reference: { fontSize: 8, fontWeight: 700, marginTop: 1.5, textAlign: 'right' },
  meta: { color: '#4B5563', fontSize: 6.5, marginTop: 1, textAlign: 'right' },
  muted: { color: '#4B5563', fontSize: 6.5 },
  statusBadge: {
    alignSelf: 'flex-end',
    borderWidth: 0.6,
    borderColor: '#D9DEE7',
    paddingVertical: 1.5,
    paddingHorizontal: 4,
    fontSize: 6.5,
    fontWeight: 700,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  // ── Sections ──
  section: { marginBottom: 6 },
  sectionTitle: {
    color: '#1F2A44',
    fontSize: 8,
    fontWeight: 700,
    textTransform: 'uppercase',
    borderBottomWidth: 0.7,
    borderBottomColor: '#D9DEE7',
    paddingBottom: 2,
    marginBottom: 2.5,
  },
  // ── Two-column row ──
  sectionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  column: {
    flex: 1,
  },
  // ── Field grid ──
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  field: {
    width: '50%',
    flexDirection: 'row',
    borderBottomWidth: 0.4,
    borderBottomColor: '#E8EBF0',
    paddingVertical: 2,
    paddingRight: 5,
  },
  fieldLabel: { width: '40%', color: '#4B5563', fontSize: 6.8 },
  fieldValue: { width: '60%', color: '#111827', fontSize: 7 },
  // ── Tables ──
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F1F3F6',
    borderBottomWidth: 0.7,
    borderBottomColor: '#D9DEE7',
    paddingVertical: 2.5,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.4,
    borderBottomColor: '#E8EBF0',
    paddingVertical: 2.5,
  },
  tableCell: { flex: 1, paddingHorizontal: 2.5, fontSize: 6.5 },
  tableHeading: { flex: 1, paddingHorizontal: 2.5, fontSize: 6.3, fontWeight: 700 },
  empty: { paddingVertical: 4, color: '#4B5563', fontSize: 7 },
  // ── Verification block ──
  verificationBlock: {
    marginTop: 6,
    borderWidth: 0.7,
    borderColor: '#D9DEE7',
    padding: 6,
    flexDirection: 'row',
    gap: 8,
  },
  verifyQrCol: { width: 52, justifyContent: 'center' },
  qrSmall: { width: 48, height: 48 },
  verifyDetailsCol: { flex: 1, justifyContent: 'center' },
  verifyTitle: { fontSize: 7, fontWeight: 700, color: '#1F2A44', marginBottom: 2 },
  verifyLabel: { fontSize: 5.8, color: '#4B5563' },
  verifyValue: { fontSize: 6.5, color: '#111827', marginBottom: 2 },
  // ── Watermark ──
  watermark: {
    position: 'absolute',
    top: '40%',
    left: '15%',
    transform: 'rotate(-30deg)',
    fontSize: 52,
    color: '#E5E7EB',
    opacity: 0.5,
    fontWeight: 700,
    letterSpacing: 8,
  },
  // ── Page footer ──
  footer: {
    position: 'absolute',
    bottom: 14,
    left: 30,
    right: 30,
    borderTopWidth: 0.6,
    borderTopColor: '#D9DEE7',
    paddingTop: 3,
    flexDirection: 'row',
    justifyContent: 'space-between',
    color: '#4B5563',
    fontSize: 6,
  },
  // ── Approvals ──
  signatureRow: { flexDirection: 'row', gap: 10, marginTop: 3 },
  signature: {
    flex: 1,
    minHeight: 38,
    borderTopWidth: 0.6,
    borderTopColor: '#D9DEE7',
    paddingTop: 2.5,
  },
  signatureImage: { height: 20, maxWidth: 90, objectFit: 'contain', objectPosition: 'left' },
  signatureName: { fontSize: 7, fontWeight: 700 },
  // ── Misc ──
  spacer: { height: 4 },
})

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
      {/* Left: Logo */}
      <View style={documentStyles.headerLogoZone}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image has no alt prop */}
        {branding?.logoUrl ? <Image src={branding.logoUrl} style={documentStyles.logo} /> : null}
      </View>
      {/* Centre: Organisation details */}
      <View style={documentStyles.headerOrgZone}>
        <Text style={documentStyles.organisation}>
          {branding?.organisationName || 'Government Fleet'}
        </Text>
        {branding?.division ? (
          <Text style={documentStyles.orgDetail}>{branding.division}</Text>
        ) : null}
        {branding?.address ? (
          <Text style={documentStyles.orgDetail}>{branding.address}</Text>
        ) : null}
        <Text style={documentStyles.orgDetail}>
          {[branding?.phone, branding?.email, branding?.website].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {/* Right: Document identity */}
      <View style={documentStyles.headerTitleZone}>
        <Text style={documentStyles.title}>{title.toUpperCase()}</Text>
        <Text style={documentStyles.reference}>{reference}</Text>
        <Text style={documentStyles.meta}>
          Version {version} · {issueDate}
        </Text>
        <Text style={documentStyles.statusBadge}>{status}</Text>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image has no alt prop */}
        {qrCode ? <Image src={qrCode} style={documentStyles.qrSmall} /> : null}
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
      {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image has no alt prop */}
      {signatureUrl ? <Image src={signatureUrl} style={documentStyles.signatureImage} /> : null}
      <Text style={documentStyles.signatureName}>{name}</Text>
      <Text style={documentStyles.muted}>{role}</Text>
      <Text style={documentStyles.muted}>
        {signedAt ? `Digitally approved · ${signedAt}` : 'Signature not applied'}
      </Text>
    </View>
  );
}

export function DocumentVerificationBlock({
  branding,
  verificationCode,
  verificationUrl,
  qrCode,
}: {
  branding?: ResolvedTenantBranding | null;
  verificationCode?: string;
  verificationUrl?: string;
  qrCode?: string;
}) {
  return (
    <View style={documentStyles.verificationBlock} wrap={false}>
      <View style={documentStyles.verifyQrCol}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image has no alt prop */}
        {qrCode ? <Image src={qrCode} style={documentStyles.qrSmall} /> : null}
      </View>
      <View style={documentStyles.verifyDetailsCol}>
        <Text style={documentStyles.verifyTitle}>VERIFY THIS DOCUMENT</Text>
        {verificationCode ? (
          <>
            <Text style={documentStyles.verifyLabel}>Verification code</Text>
            <Text style={documentStyles.verifyValue}>{verificationCode}</Text>
          </>
        ) : null}
        {verificationUrl ? (
          <>
            <Text style={documentStyles.verifyLabel}>Secure verification link</Text>
            <Text style={documentStyles.verifyValue}>{verificationUrl}</Text>
          </>
        ) : null}
        <Text style={documentStyles.verifyLabel}>
          {branding?.organisationName || 'Government Fleet'} · Official digital record
        </Text>
      </View>
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
      <Text>
        {branding?.documentFooter || 'This is a digitally generated document and does not require a physical stamp'}
      </Text>
      <Text>
        {verificationCode ? `Verify: ${verificationCode}` : 'Internal record'}
        {verificationUrl ? ` · ${verificationUrl}` : ''}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

export function DocumentRow({ children }: { children: React.ReactNode }) {
  const childArray = React.Children.toArray(children);
  return (
    <View style={documentStyles.sectionRow}>
      {childArray.map((child, index) => (
        <View key={index} style={documentStyles.column}>
          {child}
        </View>
      ))}
    </View>
  );
}
