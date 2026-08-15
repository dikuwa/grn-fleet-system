/* eslint-disable jsx-a11y/alt-text -- React-PDF Image renders PDF content, not an HTML img element. */
import React from 'react';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ResolvedTenantBranding } from '@/lib/tenant-branding';

/**
 * The official Allura signature font is bundled locally so official PDFs never
 * depend on third-party network availability at render time.
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
 * Official document family typography.
 *
 * Fake Receipt is the primary thermal-receipt face and Share Tech Mono is the
 * bundled fallback. Both fonts are resolved from local application assets so
 * official PDF generation remains deterministic and does not require network
 * access at render time.
 */
export const FAKE_RECEIPT_FONT_PATH = path.join(
  process.cwd(),
  'public',
  'official',
  'FakeReceipt-Regular.otf',
);
export const SHARE_TECH_MONO_FONT_PATH = path.join(
  process.cwd(),
  'public',
  'official',
  'ShareTechMono-Regular.ttf',
);
export const DOCUMENT_FONT = 'Fake Receipt';
export const DOCUMENT_FONT_FALLBACK = 'Share Tech Mono';
const fakeReceiptPresent = existsSync(FAKE_RECEIPT_FONT_PATH);
const shareTechMonoPresent = existsSync(SHARE_TECH_MONO_FONT_PATH);
export const DOCUMENT_FONT_STACK: string[] = fakeReceiptPresent
  ? shareTechMonoPresent
    ? [DOCUMENT_FONT, DOCUMENT_FONT_FALLBACK]
    : [DOCUMENT_FONT, 'Helvetica']
  : shareTechMonoPresent
    ? [DOCUMENT_FONT_FALLBACK, 'Helvetica']
    : ['Helvetica'];

if (fakeReceiptPresent) {
  Font.register({ family: DOCUMENT_FONT, src: FAKE_RECEIPT_FONT_PATH });
}
if (shareTechMonoPresent) {
  Font.register({ family: DOCUMENT_FONT_FALLBACK, src: SHARE_TECH_MONO_FONT_PATH });
}

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

function tintHex(value: string | undefined, strength = 0.955): string {
  const hex = (value || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#F8FAFC';

  const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  const mixed = channels.map((channel) => Math.round(channel + (255 - channel) * strength));

  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export const officialRedTheme: PdfTheme = {
  primary: OFFICIAL_RED,
  accent: OFFICIAL_RED,
  tint: '#FFF5F5',
  ink: INK,
  muted: MUTED,
  rule: '#F0C9CB',
};

const defaultTenantTheme: PdfTheme = {
  primary: '#245B9E',
  accent: '#0F766E',
  tint: '#F7F9FC',
  ink: INK,
  muted: MUTED,
  rule: RULE,
};

export function tenantPdfTheme(branding?: ResolvedTenantBranding | null): PdfTheme {
  const primary = branding?.primaryColor || '#245B9E';
  return {
    primary,
    accent: branding?.accentColor || '#0F766E',
    tint: tintHex(primary),
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

function formatGeneratedTimestamp(
  value: unknown,
  locale = 'en-NA',
  timezone = 'Africa/Windhoek',
): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return safePdfValue(value, '') || null;

  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function compactVerificationUrl(value: unknown): string {
  const text = safePdfValue(value, '');
  if (!text) return 'Not available';

  try {
    const url = new URL(text);
    const parts = url.pathname.split('/').filter(Boolean);
    const tail = parts.at(-1) || '';

    if (url.pathname.startsWith('/v/') && tail) {
      return `${url.host}/v/${tail}`;
    }
    if (tail.length > 18) {
      return `${url.host}/…/${tail.slice(0, 8)}…${tail.slice(-6)}`;
    }
    return `${url.host}${url.pathname}`;
  } catch {
    return text.length > 42 ? `${text.slice(0, 24)}…${text.slice(-10)}` : text;
  }
}

function compactFingerprint(value: unknown): string {
  const text = safePdfValue(value, '');
  if (!text) return 'Not available';
  return text.length > 24 ? `${text.slice(0, 12)}…${text.slice(-8)}` : text;
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
    fontFamily: DOCUMENT_FONT_STACK,
    fontSize: 7.4,
    lineHeight: 1.28,
    color: INK,
    backgroundColor: '#FBFCFE',
  },
  officialPage: {
    borderWidth: 0,
    backgroundColor: '#FFFAFA',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderBottomWidth: 0.55,
    paddingBottom: 8,
    marginBottom: 8,
    minHeight: 102,
  },
  headerLogoZone: {
    width: '18%',
    minHeight: 94,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 2,
  },
  coatOfArmsLogo: { width: 68, height: 68, objectFit: 'contain' },
  tenantLogo: { width: 76, height: 76, objectFit: 'contain' },
  headerOrgZone: {
    width: '64%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
    paddingTop: 5,
  },
  republic: { fontSize: 7, fontFamily: DOCUMENT_FONT_STACK, textAlign: 'center' },
  tenantContext: {
    fontSize: 5.1,
    marginTop: 5,
    marginBottom: 0.3,
    textAlign: 'center',
    color: MUTED,
  },
  organisation: {
    fontSize: 10.2,
    fontFamily: DOCUMENT_FONT_STACK,
    color: INK,
    textAlign: 'center',
    marginTop: 0.4,
  },
  orgDetail: { color: MUTED, fontSize: 6.4, marginTop: 1, textAlign: 'center' },
  headerTitleZone: {
    width: '18%',
    minHeight: 94,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
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
  title: {
    fontSize: 11.4,
    fontFamily: DOCUMENT_FONT_STACK,
    textAlign: 'center',
    lineHeight: 1.16,
  },
  reference: {
    fontSize: 5.4,
    fontFamily: DOCUMENT_FONT_STACK,
    marginTop: 1.5,
    textAlign: 'center',
    color: MUTED,
  },
  meta: { color: MUTED, fontSize: 4.6, marginTop: 0.5, textAlign: 'center', lineHeight: 1.15 },
  muted: { color: MUTED, fontSize: 6.3 },
  statusBadge: {
    alignSelf: 'center',
    paddingVertical: 0.6,
    paddingHorizontal: 2,
    fontSize: 4.7,
    fontFamily: DOCUMENT_FONT_STACK,
    textTransform: 'uppercase',
    marginTop: 0.7,
    color: MUTED,
  },
  section: { marginBottom: 4 },
  sectionTitle: {
    fontSize: 7.7,
    fontFamily: DOCUMENT_FONT_STACK,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
    paddingVertical: 2.2,
    marginBottom: 0,
  },
  sectionBody: {
    paddingHorizontal: 3.5,
    paddingTop: 2.5,
    paddingBottom: 2,
  },
  sectionRow: { flexDirection: 'row', gap: 6 },
  column: { flex: 1 },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  field: { width: '50%', flexDirection: 'row', paddingVertical: 1.7, paddingRight: 5 },
  fieldLabel: { width: '40%', color: MUTED, fontSize: 6.2, fontFamily: DOCUMENT_FONT_STACK },
  fieldValue: { width: '60%', color: INK, fontSize: 6.7 },
  table: { width: '100%' },
  tableHeader: { flexDirection: 'row', paddingVertical: 2.2 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.18, paddingVertical: 2.1, minHeight: 11 },
  tableCell: { paddingHorizontal: 2.5, fontSize: 6.25 },
  tableHeading: {
    paddingHorizontal: 2.5,
    fontSize: 5.9,
    fontFamily: DOCUMENT_FONT_STACK,
    textTransform: 'uppercase',
  },
  empty: { paddingVertical: 4, color: MUTED, fontSize: 6.5 },
  verificationBlock: {
    marginTop: 5,
    padding: 4,
    flexDirection: 'row',
    gap: 7,
    backgroundColor: '#FFFFFF',
  },
  verifyQrCol: { width: 50, justifyContent: 'center', alignItems: 'center' },
  qrSmall: { width: 28, height: 28, objectFit: 'contain' },
  qrVerification: { width: 46, height: 46, objectFit: 'contain' },
  verifyDetailsCol: { flex: 1, justifyContent: 'center' },
  verifyTitle: { fontSize: 6.5, fontFamily: DOCUMENT_FONT_STACK, marginBottom: 2 },
  verifyLabel: { fontSize: 4.8, color: MUTED, textTransform: 'uppercase' },
  verifyValue: { fontSize: 5.4, color: INK, marginBottom: 1.5 },
  watermark: {
    position: 'absolute',
    top: '42%',
    left: '19%',
    transform: 'rotate(-30deg)',
    fontSize: 48,
    color: '#DDE3EA',
    opacity: 0.34,
    fontFamily: DOCUMENT_FONT_STACK,
    letterSpacing: 7,
  },
  footer: {
    position: 'absolute',
    bottom: 12,
    left: 24,
    right: 24,
    borderTopWidth: 0.25,
    paddingTop: 3,
    flexDirection: 'row',
    alignItems: 'flex-end',
    color: MUTED,
    fontSize: 5.1,
  },
  footerLeft: { width: '44%' },
  footerCentre: { width: '41%', textAlign: 'center' },
  footerRight: { width: '15%', textAlign: 'right' },
  signatureRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  signature: { flex: 1, minHeight: 48, paddingTop: 2, paddingHorizontal: 2 },
  signatureStatement: {
    fontSize: 5.35,
    textAlign: 'center',
    minHeight: 16,
    color: '#344054',
  },
  signatureImage: { height: 22, maxWidth: 96, objectFit: 'contain', objectPosition: 'left' },
  signatureName: {
    fontSize: 14.5,
    lineHeight: 1.05,
    fontFamily: SIGNATURE_FONT,
    marginTop: 2,
  },
  warnings: { marginTop: 3, marginBottom: 2 },
  warning: {
    fontSize: 6.3,
    fontFamily: DOCUMENT_FONT_STACK,
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
  const contact = [branding?.phone, branding?.email, branding?.website].filter(Boolean).join('  ·  ');
  const tenantLogo = branding?.documentLogoUrl || branding?.logoUrl;
  const identityMeta = [version ? `v${version}` : null, issueDate, status].filter(Boolean).join(' · ');

  return (
    <View style={[documentStyles.header, { borderBottomColor: theme.primary }]}>
      <View style={documentStyles.headerLogoZone}>
        <Image src={coatOfArmsPath} style={documentStyles.coatOfArmsLogo} />
      </View>
      <View style={documentStyles.headerOrgZone}>
        <Text style={documentStyles.republic}>REPUBLIC OF NAMIBIA</Text>
        <Text style={[documentStyles.title, { color: theme.primary }]}>{title.toUpperCase()}</Text>
        <Text style={documentStyles.tenantContext}>OFFICE / MINISTRY / DEPARTMENT / MUNICIPALITY</Text>
        <Text style={documentStyles.organisation}>
          {safePdfValue(branding?.organisationName, 'Government Fleet')}
        </Text>
        {branding?.division ? <SafePdfText value={branding.division} style={documentStyles.orgDetail} /> : null}
        {branding?.address ? <SafePdfText value={branding.address} style={documentStyles.orgDetail} /> : null}
        {contact ? <SafePdfText value={contact} style={documentStyles.orgDetail} /> : null}
      </View>
      <View style={documentStyles.headerTitleZone}>
        {tenantLogo ? <Image src={tenantLogo} style={documentStyles.tenantLogo} /> : null}
        {showIdentity && reference ? <SafePdfText value={reference} style={documentStyles.reference} /> : null}
        {showIdentity && identityMeta ? <SafePdfText value={identityMeta} style={documentStyles.meta} /> : null}
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
    <View style={documentStyles.section} wrap={wrap} minPresenceAhead={minPresenceAhead} break={breakBefore}>
      <Text style={[documentStyles.sectionTitle, { color: theme.primary, backgroundColor: theme.tint }]}>
        {title}
      </Text>
      <View style={documentStyles.sectionBody}>{children}</View>
    </View>
  );
}

export function DocumentFieldGrid({
  fields,
  columns = 2,
  labelWidth = 40,
  labelColor,
}: {
  fields: Array<{ label: string; value: unknown }>;
  columns?: 1 | 2 | 3;
  labelWidth?: number;
  labelColor?: string;
}) {
  return (
    <View style={documentStyles.fieldGrid}>
      {fields.map((field, index) => (
        <View key={`${field.label}-${index}`} style={[documentStyles.field, { width: `${100 / columns}%` }]}>
          <SafePdfText
            value={field.label}
            style={[
              documentStyles.fieldLabel,
              { width: `${labelWidth}%`, ...(labelColor ? { color: labelColor } : {}) },
            ]}
          />
          <SafePdfText value={field.value} style={[documentStyles.fieldValue, { width: `${100 - labelWidth}%` }]} />
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
    ...(heading ? { color: theme.primary } : {}),
  });

  return (
    <View style={documentStyles.table} minPresenceAhead={22}>
      <View style={[documentStyles.tableHeader, { backgroundColor: theme.tint }]} fixed>
        {columns.map((column) => (
          <SafePdfText key={column.key} value={column.label} style={cellStyle(column, true)} />
        ))}
      </View>
      {rows.map((row, index) => (
        <View key={index} style={[documentStyles.tableRow, { borderBottomColor: theme.rule }]} wrap={false}>
          {columns.map((column) => (
            <SafePdfText key={column.key} value={row[column.key]} style={cellStyle(column, false)} />
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
      {statement ? <SafePdfText value={statement} style={documentStyles.signatureStatement} /> : null}
      {signatureUrl ? <Image src={signatureUrl} style={documentStyles.signatureImage} /> : null}
      <SafePdfText value={name} style={documentStyles.signatureName} />
      <SafePdfText value={role} style={documentStyles.muted} />
      <SafePdfText
        value={signedAt ? `Digitally approved · ${safePdfValue(signedAt)}` : 'Signature not applied'}
        style={documentStyles.muted}
      />
    </View>
  );
}

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
    <View style={{ marginTop: 7 }} wrap={false}>
      <Text style={[documentStyles.sectionTitle, { color: theme.primary, backgroundColor: theme.tint }]}>
        Executive certification
      </Text>
      <View style={documentStyles.sectionBody}>
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
    <View
      style={[
        documentStyles.verificationBlock,
        { borderTopWidth: 0.25, borderTopColor: theme.rule },
      ]}
      wrap={false}
    >
      <View style={documentStyles.verifyQrCol}>
        {qrCode ? (
          <Image src={qrCode} style={documentStyles.qrVerification} />
        ) : (
          <SafePdfText value="QR unavailable" style={documentStyles.verifyLabel} />
        )}
      </View>
      <View style={documentStyles.verifyDetailsCol}>
        <SafePdfText value="Verification code" style={documentStyles.verifyLabel} />
        <SafePdfText value={verificationCode} style={[documentStyles.verifyTitle, { color: theme.primary }]} />
      </View>
      <View style={documentStyles.verifyDetailsCol}>
        <SafePdfText value="Verify online" style={documentStyles.verifyLabel} />
        <SafePdfText value={compactVerificationUrl(verificationUrl)} style={documentStyles.verifyValue} />
      </View>
      <View style={{ ...documentStyles.verifyDetailsCol, flex: 1.05 }}>
        <SafePdfText value="Fingerprint" style={documentStyles.verifyLabel} />
        <SafePdfText value={compactFingerprint(documentHash)} style={documentStyles.verifyValue} />
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
  verificationUrl: _verificationUrl,
  documentHash,
  generatedAt,
  theme = tenantPdfTheme(branding),
}: {
  branding?: ResolvedTenantBranding | null;
  verificationCode?: unknown;
  verificationUrl?: unknown;
  documentHash?: unknown;
  generatedAt?: unknown;
  theme?: PdfTheme;
}) {
  const generatedTimestamp = formatGeneratedTimestamp(
    generatedAt,
    branding?.locale || 'en-NA',
    branding?.timezone || 'Africa/Windhoek',
  );
  const verificationParts = verificationCode
    ? [
        `Verify ${safePdfValue(verificationCode)}`,
        documentHash ? `FP ${compactFingerprint(documentHash)}` : null,
      ].filter(Boolean)
    : ['Internal record'];
  const footerParts = [
    branding?.documentFooter || `${branding?.organisationName || 'Government Fleet'} · Fleet Management Internal Record`,
    generatedTimestamp ? `Generated ${generatedTimestamp}` : null,
  ].filter(Boolean);

  return (
    <View style={[documentStyles.footer, { borderTopColor: theme.primary }]} fixed>
      <SafePdfText value={footerParts.join(' · ')} style={documentStyles.footerLeft} />
      <SafePdfText value={verificationParts.join(' · ')} style={documentStyles.footerCentre} />
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
