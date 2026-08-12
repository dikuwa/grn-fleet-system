/* eslint-disable jsx-a11y/alt-text -- React-PDF Image renders PDF content, not an HTML img element. */
import React from 'react';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ResolvedTenantBranding } from '@/lib/tenant-branding';

/**
 * The official Allura signature font is bundled locally so official PDFs never
 * depend on third-party network availability at render time. If the asset is
 * ever missing, rendering falls back to the built-in Helvetica-Oblique.
 */
export const ALLURA_FONT_PATH = path.join(
  process.cwd(),
  'public',
  'official',
  'Allura-Regular.ttf',
);
export const SIGNATURE_FONT = existsSync(ALLURA_FONT_PATH) ? 'Allura' : 'Helvetica-Oblique';
if (SIGNATURE_FONT === 'Allura') {
  Font.register({ family: 'Allura', src: ALLURA_FONT_PATH });
}

/**
 * The PDF renderer deliberately uses the built-in Helvetica family.  The former
 * implementation downloaded fonts from GitHub and Google during every render,
 * which made production documents depend on third-party network availability.
 */
const OFFICIAL_RED = '#C1121F';
const INK = '#172033';
const MUTED = '#667085';
const RULE = '#D9DEE7';
const EMPTY_VALUE = '—';

export type PdfTheme = {
  primary: string;
  accent: string;
  tint: string;
  ink: string;
  muted: string;
  rule: string;
};

export const officialRedTheme: PdfTheme = {
  primary: OFFICIAL_RED,
  accent: OFFICIAL_RED,
  tint: '#FFF7F7',
  ink: INK,
  muted: MUTED,
  rule: '#E8B8BB',
};

const defaultTenantTheme: PdfTheme = {
  primary: '#245B9E',
  accent: '#0F766E',
  tint: '#F4F7FB',
  ink: INK,
  muted: MUTED,
  rule: RULE,
};

export function tenantPdfTheme(branding?: ResolvedTenantBranding | null): PdfTheme {
  return {
    primary: branding?.primaryColor || '#245B9E',
    accent: branding?.accentColor || '#0F766E',
    tint: '#F4F7FB',
    ink: INK,
    muted: MUTED,
    rule: RULE,
  };
}

export const NAMIBIA_COAT_OF_ARMS_PATH = path.join(
  process.cwd(),
  'public',
  'official',
  'namibia-coat-of-arms.png',
);

export function safePdfValue(value: unknown, fallback = EMPTY_VALUE): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number' && !Number.isFinite(value)) return fallback;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text || /^(undefined|null|nan)$/i.test(text)) return fallback;
  return text;
}

export function SafePdfText({
  value,
  fallback,
  style,
}: {
  value: unknown;
  fallback?: string;
  style?: React.ComponentProps<typeof Page>['style'];
}) {
  return (
    <Text style={style} orphans={2} widows={2}>
      {safePdfValue(value, fallback)}
    </Text>
  );
}

export const documentStyles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingHorizontal: 24,
    paddingBottom: 50,
    fontFamily: 'Helvetica',
    fontSize: 7.4,
    lineHeight: 1.25,
    color: INK,
  },
  officialPage: {
    borderWidth: 0.8,
    borderColor: OFFICIAL_RED,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 0.9,
    paddingBottom: 8,
    marginBottom: 8,
    minHeight: 96,
  },
  headerLogoZone: { width: '20%', justifyContent: 'center', alignItems: 'flex-start' },
  logo: { width: 76, height: 82, objectFit: 'contain' },
  headerOrgZone: {
    width: '64%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  organisation: {
    fontSize: 10.2,
    fontFamily: 'Helvetica-Bold',
    color: INK,
    textAlign: 'center',
    marginTop: 2,
  },
  orgDetail: { color: MUTED, fontSize: 6.4, marginTop: 1, textAlign: 'center' },
  headerTitleZone: { width: '18%', alignItems: 'flex-end', justifyContent: 'center' },
  continuationHeader: {
    position: 'absolute',
    top: 10,
    left: 24,
    right: 24,
    paddingBottom: 2,
    color: MUTED,
    fontSize: 5.5,
    textAlign: 'center',
  },
  title: { fontSize: 11.4, fontFamily: 'Helvetica-Bold', textAlign: 'center', lineHeight: 1.16 },
  reference: { fontSize: 7.2, fontFamily: 'Helvetica-Bold', marginTop: 2, textAlign: 'center' },
  meta: { color: MUTED, fontSize: 5.8, marginTop: 1, textAlign: 'center' },
  muted: { color: MUTED, fontSize: 6.3 },
  statusBadge: {
    alignSelf: 'flex-end',
    borderWidth: 0.6,
    borderColor: RULE,
    paddingVertical: 1.5,
    paddingHorizontal: 4,
    fontSize: 5.8,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    marginTop: 2,
  },
  section: { marginBottom: 3.5 },
  sectionTitle: {
    fontSize: 7.7,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    borderWidth: 0.55,
    paddingHorizontal: 4,
    paddingVertical: 2,
    marginBottom: 0,
  },
  sectionBody: {
    borderLeftWidth: 0.45,
    borderRightWidth: 0.45,
    borderBottomWidth: 0.45,
    padding: 3,
  },
  sectionRow: { flexDirection: 'row', gap: 6 },
  column: { flex: 1 },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  field: { width: '50%', flexDirection: 'row', paddingVertical: 1.7, paddingRight: 5 },
  fieldLabel: { width: '40%', color: MUTED, fontSize: 6.2, fontFamily: 'Helvetica-Bold' },
  fieldValue: { width: '60%', color: INK, fontSize: 6.7 },
  table: { width: '100%' },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 0.65, paddingVertical: 2 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.35, paddingVertical: 2, minHeight: 11 },
  tableCell: { paddingHorizontal: 2.5, fontSize: 6.25 },
  tableHeading: {
    paddingHorizontal: 2.5,
    fontSize: 5.9,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
  },
  empty: { paddingVertical: 4, color: MUTED, fontSize: 6.5 },
  verificationBlock: {
    marginTop: 3,
    borderWidth: 0.55,
    padding: 3.5,
    flexDirection: 'row',
    gap: 6,
  },
  verifyQrCol: { width: 37, justifyContent: 'center' },
  qrSmall: { width: 34, height: 34, objectFit: 'contain' },
  verifyDetailsCol: { flex: 1, justifyContent: 'center' },
  verifyTitle: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  verifyLabel: { fontSize: 5.2, color: MUTED, textTransform: 'uppercase' },
  verifyValue: { fontSize: 5.9, color: INK, marginBottom: 1.5 },
  watermark: {
    position: 'absolute',
    top: '42%',
    left: '19%',
    transform: 'rotate(-30deg)',
    fontSize: 48,
    color: '#DDE3EA',
    opacity: 0.34,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 7,
  },
  footer: {
    position: 'absolute',
    bottom: 12,
    left: 24,
    right: 24,
    borderTopWidth: 0.5,
    paddingTop: 3,
    flexDirection: 'row',
    alignItems: 'flex-end',
    color: MUTED,
    fontSize: 5.3,
  },
  footerLeft: { width: '45%' },
  footerCentre: { width: '38%', textAlign: 'center' },
  footerRight: { width: '17%', textAlign: 'right' },
  signatureRow: { flexDirection: 'row', gap: 8, marginTop: 3 },
  signature: { flex: 1, minHeight: 34, paddingTop: 2 },
  signatureStatement: { fontSize: 5.2, textAlign: 'center', minHeight: 13, color: '#344054' },
  signatureImage: { height: 15, maxWidth: 82, objectFit: 'contain', objectPosition: 'left' },
  signatureName: { fontSize: 9.6, fontFamily: SIGNATURE_FONT, marginTop: 0.5 },
  warnings: { marginTop: 2, marginBottom: 2 },
  warning: {
    fontSize: 6.3,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    lineHeight: 1.35,
    textTransform: 'uppercase',
  },
  finalBlock: {},
  spacer: { height: 4 },
});

export function DocumentPage({
  children,
  status,
  official = false,
  continuationLabel = 'Official document continuation',
}: {
  children: React.ReactNode;
  status?: string;
  official?: boolean;
  continuationLabel?: string;
}) {
  return (
    <Page size="A4" style={[documentStyles.page, official ? documentStyles.officialPage : {}]} wrap>
      {status === 'draft' && (
        <Text style={documentStyles.watermark} fixed>
          DRAFT
        </Text>
      )}
      <Text
        style={documentStyles.continuationHeader}
        render={({ pageNumber }) => (pageNumber > 1 ? continuationLabel : '')}
        fixed
      />
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
  official = false,
  showIdentity = true,
  coatOfArmsPath = NAMIBIA_COAT_OF_ARMS_PATH,
  theme = official ? officialRedTheme : tenantPdfTheme(branding),
}: {
  branding?: ResolvedTenantBranding | null;
  title: string;
  reference?: string;
  version?: number;
  status?: string;
  issueDate?: string;
  qrCode?: string;
  official?: boolean;
  showIdentity?: boolean;
  coatOfArmsPath?: string;
  theme?: PdfTheme;
}) {
  const contact = [branding?.phone, branding?.email, branding?.website]
    .filter(Boolean)
    .join('  ·  ');
  return (
    <View style={[documentStyles.header, { borderBottomColor: theme.primary }]}>
      <View style={documentStyles.headerLogoZone}>
        <Image src={coatOfArmsPath} style={documentStyles.logo} />
      </View>
      <View style={documentStyles.headerOrgZone}>
        <Text style={{ fontSize: 7, fontFamily: 'Helvetica-Bold', textAlign: 'center' }}>
          REPUBLIC OF NAMIBIA
        </Text>
        <Text style={[documentStyles.title, { color: theme.primary }]}>{title.toUpperCase()}</Text>
        <Text style={{ fontSize: 5.3, marginTop: 2, textAlign: 'center' }}>
          OFFICE / MINISTRY / DEPARTMENT / MUNICIPALITY
        </Text>
        <Text style={documentStyles.organisation}>
          {safePdfValue(branding?.organisationName, 'GOVERNMENT FLEET')}
        </Text>
        {branding?.division ? (
          <SafePdfText value={branding.division} style={documentStyles.orgDetail} />
        ) : null}
        {branding?.address ? (
          <SafePdfText value={branding.address} style={documentStyles.orgDetail} />
        ) : null}
        {contact ? <SafePdfText value={contact} style={documentStyles.orgDetail} /> : null}
      </View>
      <View style={documentStyles.headerTitleZone}>
        {branding?.logoUrl ? <Image src={branding.logoUrl} style={documentStyles.logo} /> : null}
        {showIdentity && reference ? (
          <SafePdfText value={reference} style={documentStyles.reference} />
        ) : null}
        {showIdentity && (version || issueDate) ? (
          <Text style={documentStyles.meta}>
            {[version ? `Version ${version}` : null, issueDate].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        {showIdentity && status ? (
          <SafePdfText value={status} style={documentStyles.statusBadge} />
        ) : null}
        {showIdentity && qrCode ? <Image src={qrCode} style={documentStyles.qrSmall} /> : null}
      </View>
    </View>
  );
}

export function DocumentSection({
  title,
  children,
  wrap = true,
  theme = defaultTenantTheme,
  minPresenceAhead = 45,
  breakBefore = false,
}: {
  title: string;
  children: React.ReactNode;
  wrap?: boolean;
  theme?: PdfTheme;
  minPresenceAhead?: number;
  breakBefore?: boolean;
}) {
  return (
    <View
      style={documentStyles.section}
      wrap={wrap}
      minPresenceAhead={minPresenceAhead}
      break={breakBefore}
    >
      <Text
        style={[
          documentStyles.sectionTitle,
          { color: theme.primary, borderColor: theme.rule, backgroundColor: theme.tint },
        ]}
      >
        {title}
      </Text>
      <View style={[documentStyles.sectionBody, { borderColor: theme.rule }]}>{children}</View>
    </View>
  );
}

export function DocumentFieldGrid({
  fields,
  columns = 2,
  labelWidth = 40,
}: {
  fields: Array<{ label: string; value: unknown }>;
  columns?: 1 | 2 | 3;
  labelWidth?: number;
}) {
  return (
    <View style={documentStyles.fieldGrid}>
      {fields.map((field, index) => (
        <View
          key={`${field.label}-${index}`}
          style={[documentStyles.field, { width: `${100 / columns}%` }]}
        >
          <SafePdfText
            value={field.label}
            style={[documentStyles.fieldLabel, { width: `${labelWidth}%` }]}
          />
          <SafePdfText
            value={field.value}
            style={[documentStyles.fieldValue, { width: `${100 - labelWidth}%` }]}
          />
        </View>
      ))}
    </View>
  );
}

export type DocumentTableColumn = {
  key: string;
  label: string;
  width?: string | number;
  align?: 'left' | 'center' | 'right';
};

export function DocumentTable({
  columns,
  rows,
  emptyLabel = 'No records recorded',
  theme = defaultTenantTheme,
}: {
  columns: DocumentTableColumn[];
  rows: Array<Record<string, unknown>>;
  emptyLabel?: string;
  theme?: PdfTheme;
}) {
  if (!rows.length) return <SafePdfText value={emptyLabel} style={documentStyles.empty} />;
  const fallbackWidth = `${100 / columns.length}%`;
  const cellStyle = (column: DocumentTableColumn, heading: boolean) => ({
    ...(heading ? documentStyles.tableHeading : documentStyles.tableCell),
    width: column.width || fallbackWidth,
    textAlign: column.align || 'left',
  });
  return (
    <View style={documentStyles.table} minPresenceAhead={22}>
      <View
        style={[
          documentStyles.tableHeader,
          { backgroundColor: theme.tint, borderBottomColor: theme.primary },
        ]}
        fixed
      >
        {columns.map((column) => (
          <SafePdfText key={column.key} value={column.label} style={cellStyle(column, true)} />
        ))}
      </View>
      {rows.map((row, index) => (
        <View
          key={index}
          style={[documentStyles.tableRow, { borderBottomColor: theme.rule }]}
          wrap={false}
        >
          {columns.map((column) => (
            <SafePdfText
              key={column.key}
              value={row[column.key]}
              style={cellStyle(column, false)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

export function DocumentSignature({
  name,
  role,
  statement,
  signedAt,
  signatureUrl,
}: {
  name: unknown;
  role: unknown;
  statement?: string;
  signedAt?: unknown;
  signatureUrl?: string;
}) {
  return (
    <View style={documentStyles.signature}>
      {statement ? (
        <SafePdfText value={statement} style={documentStyles.signatureStatement} />
      ) : null}
      {signatureUrl ? <Image src={signatureUrl} style={documentStyles.signatureImage} /> : null}
      <SafePdfText value={name} style={documentStyles.signatureName} />
      <SafePdfText value={role} style={documentStyles.muted} />
      <SafePdfText
        value={
          signedAt ? `Digitally approved · ${safePdfValue(signedAt)}` : 'Signature not applied'
        }
        style={documentStyles.muted}
      />
    </View>
  );
}

/**
 * Compact red official warnings rendered near the document footer. The text is
 * always presented in the official accent and never styled as a heavy box.
 */
export function DocumentWarnings({
  items,
  theme = officialRedTheme,
}: {
  items: string[];
  theme?: PdfTheme;
}) {
  if (!items.length) return null;
  return (
    <View style={documentStyles.warnings} wrap={false}>
      {items.map((item) => (
        <Text key={item} style={[documentStyles.warning, { color: theme.primary }]}>
          {item}
        </Text>
      ))}
    </View>
  );
}

export function DocumentExecutiveCertification({
  branding,
  generatedAt,
  statement = 'I certify that this report is a true system record for the stated reporting period.',
  theme = tenantPdfTheme(branding),
}: {
  branding?: ResolvedTenantBranding | null;
  generatedAt?: unknown;
  statement?: string;
  theme?: PdfTheme;
}) {
  return (
    <View style={{ marginTop: 5 }} wrap={false}>
      <Text
        style={[
          documentStyles.sectionTitle,
          { color: theme.primary, borderColor: theme.rule, backgroundColor: theme.tint },
        ]}
      >
        Executive certification
      </Text>
      <View style={[documentStyles.sectionBody, { borderColor: theme.rule }]}>
        <View style={documentStyles.signatureRow}>
          <DocumentSignature
            name={branding?.executiveSignatoryName}
            role={branding?.executiveSignatoryTitle || 'Chief Executive Officer'}
            statement={statement}
            signedAt={generatedAt}
            signatureUrl={branding?.executiveSignatureUrl}
          />
        </View>
      </View>
    </View>
  );
}

export function DocumentVerificationBlock({
  branding,
  verificationCode,
  verificationUrl,
  documentHash,
  qrCode,
  theme = tenantPdfTheme(branding),
}: {
  branding?: ResolvedTenantBranding | null;
  verificationCode?: unknown;
  verificationUrl?: unknown;
  documentHash?: unknown;
  qrCode?: string;
  theme?: PdfTheme;
}) {
  return (
    <View style={[documentStyles.verificationBlock, { borderColor: theme.rule }]} wrap={false}>
      <View style={documentStyles.verifyQrCol}>
        {qrCode ? <Image src={qrCode} style={documentStyles.qrSmall} /> : null}
      </View>
      <View style={documentStyles.verifyDetailsCol}>
        <SafePdfText value="Verification code" style={documentStyles.verifyLabel} />
        <SafePdfText
          value={verificationCode}
          style={[documentStyles.verifyTitle, { color: theme.primary }]}
        />
      </View>
      <View style={documentStyles.verifyDetailsCol}>
        <SafePdfText value="Short link" style={documentStyles.verifyLabel} />
        <SafePdfText value={verificationUrl} style={documentStyles.verifyValue} />
      </View>
      <View style={{ ...documentStyles.verifyDetailsCol, flex: 1.35 }}>
        <SafePdfText value="Document hash (SHA256)" style={documentStyles.verifyLabel} />
        <SafePdfText value={documentHash} style={documentStyles.verifyValue} />
        <SafePdfText
          value={`${branding?.organisationName || 'Government Fleet'} · Official digital record`}
          style={documentStyles.verifyLabel}
        />
      </View>
    </View>
  );
}

export function DocumentVerificationFooter({
  branding,
  verificationCode,
  verificationUrl,
  theme = tenantPdfTheme(branding),
}: {
  branding?: ResolvedTenantBranding | null;
  verificationCode?: unknown;
  verificationUrl?: unknown;
  theme?: PdfTheme;
}) {
  return (
    <View style={[documentStyles.footer, { borderTopColor: theme.primary }]} fixed>
      <SafePdfText
        value={
          branding?.documentFooter ||
          `${branding?.organisationName || 'Government Fleet'} · Fleet Management Internal Record`
        }
        style={documentStyles.footerLeft}
      />
      <SafePdfText
        value={
          verificationCode
            ? `Verify: ${safePdfValue(verificationCode)}${verificationUrl ? ` · ${safePdfValue(verificationUrl)}` : ''}`
            : 'Internal record'
        }
        style={documentStyles.footerCentre}
      />
      <Text
        style={documentStyles.footerRight}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  );
}

export function DocumentRow({ children }: { children: React.ReactNode }) {
  return (
    <View style={documentStyles.sectionRow}>
      {React.Children.toArray(children).map((child, index) => (
        <View key={index} style={documentStyles.column}>
          {child}
        </View>
      ))}
    </View>
  );
}
