import React from 'react';
import QRCode from 'qrcode';
import { Document, renderToStream } from '@react-pdf/renderer';
import type { ResolvedTenantBranding } from '@/lib/tenant-branding';
import { abbreviatedDocumentHash } from '@/lib/document-verification';
import {
  buildPublicDocumentSummary,
  normalizePublicDocumentRedactionProfile,
} from '@/lib/public-document-redaction';
import {
  DocumentFieldGrid,
  DocumentHeader,
  DocumentPage,
  DocumentSection,
  DocumentVerificationBlock,
  DocumentVerificationFooter,
  tenantPdfTheme,
} from './document-system';

function snapshotBranding(
  snapshot: Record<string, unknown>,
): ResolvedTenantBranding | null {
  const brandingMeta = snapshot.brandingMeta as Partial<ResolvedTenantBranding> | undefined;
  const identity = snapshot.documentIdentity as
    | {
        organisationName?: string;
        logoUrl?: string;
        primaryColor?: string;
        accentColor?: string;
        executiveSignatoryName?: string;
        executiveSignatoryTitle?: string;
        executiveSignatureUrl?: string;
      }
    | undefined;
  if (!brandingMeta && !identity) return null;

  return {
    tenantId: brandingMeta?.tenantId || '',
    organisationName:
      brandingMeta?.organisationName || identity?.organisationName || 'Government Fleet',
    code: brandingMeta?.code || '',
    locale: brandingMeta?.locale || 'en-NA',
    timezone: brandingMeta?.timezone || 'Africa/Windhoek',
    division: brandingMeta?.division,
    address: brandingMeta?.address,
    phone: brandingMeta?.phone,
    email: brandingMeta?.email,
    website: brandingMeta?.website,
    registrationNumber: brandingMeta?.registrationNumber,
    motto: brandingMeta?.motto,
    logoUrl: identity?.logoUrl,
    documentLogoUrl: identity?.logoUrl,
    primaryColor:
      brandingMeta?.primaryColor || identity?.primaryColor || '#1F2A44',
    accentColor:
      brandingMeta?.accentColor || identity?.accentColor || '#0F766E',
    documentFooter: brandingMeta?.documentFooter,
    executiveSignatoryName:
      brandingMeta?.executiveSignatoryName || identity?.executiveSignatoryName,
    executiveSignatoryTitle:
      brandingMeta?.executiveSignatoryTitle || identity?.executiveSignatoryTitle,
    executiveSignatureUrl: identity?.executiveSignatureUrl,
  };
}

function frozenIssueTimestamp(snapshot: Record<string, unknown>, fallback: Date): string {
  const identity = snapshot.documentIdentity;
  if (identity && typeof identity === 'object' && !Array.isArray(identity)) {
    const snapshottedAt = (identity as Record<string, unknown>).snapshottedAt;
    if (typeof snapshottedAt === 'string' && snapshottedAt.trim()) return snapshottedAt;
  }
  return fallback.toISOString();
}

async function streamToBuffer(element: React.ReactElement): Promise<Uint8Array> {
  const stream = await renderToStream(
    element as unknown as React.ReactElement<Record<string, unknown>>,
  );
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(new Uint8Array(chunk as unknown as ArrayBuffer));
  }
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function PublicSharedDocument({
  documentType,
  documentVersion,
  documentStatus,
  createdAt,
  snapshotData,
  branding,
  redactionProfile,
  verificationCode,
  verificationUrl,
  documentHash,
  qrCodeDataUrl,
}: {
  documentType: string;
  documentVersion: number;
  documentStatus: string;
  createdAt: string;
  snapshotData: Record<string, unknown>;
  branding: ResolvedTenantBranding | null;
  redactionProfile: string;
  verificationCode?: string | null;
  verificationUrl: string;
  documentHash?: string | null;
  qrCodeDataUrl: string;
}) {
  const summary = buildPublicDocumentSummary({
    documentType,
    documentVersion,
    documentStatus,
    snapshotData,
    profile: redactionProfile,
  });
  const profile = normalizePublicDocumentRedactionProfile(redactionProfile);
  const theme = tenantPdfTheme(branding);

  return (
    <Document
      title={`${documentType.replace(/_/g, ' ')} ${summary.reference}`}
      author={branding?.organisationName || 'Government Fleet'}
    >
      <DocumentPage continuationLabel={`${branding?.organisationName || 'Government Fleet'} · Verified shared document`}>
        <DocumentHeader
          branding={branding}
          title={documentType.replace(/_/g, ' ')}
          reference={summary.reference}
          version={documentVersion}
          status={documentStatus}
          issueDate={createdAt}
          qrCode={qrCodeDataUrl}
          theme={theme}
        />

        <DocumentSection
          title={profile === 'external_minimal' ? 'Verification Summary' : 'Approved Public Summary'}
          theme={theme}
        >
          <DocumentFieldGrid
            columns={1}
            labelWidth={34}
            labelColor={theme.primary}
            fields={summary.rows.map((row) => ({ label: row.label, value: row.value }))}
          />
        </DocumentSection>

        <DocumentSection title="Disclosure Profile" theme={theme} wrap={false}>
          <DocumentFieldGrid
            columns={1}
            labelWidth={34}
            labelColor={theme.primary}
            fields={[
              {
                label: 'Profile',
                value:
                  profile === 'external_minimal'
                    ? 'External Minimal'
                    : profile === 'external_standard'
                      ? 'External Standard'
                      : 'Legacy Internal Label',
              },
              {
                label: 'Privacy notice',
                value:
                  'This public copy is allow-list redacted. Personal identifiers, licence details, passenger lists, signatures, internal comments, fuel-card data and attachment references are omitted.',
              },
            ]}
          />
        </DocumentSection>

        <DocumentVerificationBlock
          branding={branding}
          verificationCode={verificationCode || undefined}
          verificationUrl={verificationUrl}
          documentHash={abbreviatedDocumentHash(documentHash) || undefined}
          qrCode={qrCodeDataUrl}
          theme={theme}
        />
        <DocumentVerificationFooter
          branding={branding}
          verificationCode={verificationCode || summary.reference}
          verificationUrl={verificationUrl}
          documentHash={abbreviatedDocumentHash(documentHash) || undefined}
          generatedAt={createdAt}
          theme={theme}
        />
      </DocumentPage>
    </Document>
  );
}

export async function generatePublicSharedDocumentPdf(input: {
  document: {
    id: string;
    documentType: string;
    documentVersion: number;
    status: string;
    snapshotData: Record<string, unknown> | null | undefined;
    hash: string | null;
    createdAt: Date;
  };
  shareLink: {
    shortSlug: string | null;
    verificationCode: string | null;
    redactionProfile: string;
  };
  baseUrl: string;
}): Promise<{ buffer: Uint8Array; filename: string }> {
  const snapshot = input.document.snapshotData || {};
  const branding = snapshotBranding(snapshot);
  const issuedAt = frozenIssueTimestamp(snapshot, input.document.createdAt);
  const slug = input.shareLink.shortSlug || input.shareLink.verificationCode || input.document.id;
  const verificationUrl = `${input.baseUrl.replace(/\/$/, '')}/v/${encodeURIComponent(slug)}`;
  const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, { width: 220, margin: 1 });
  const element = React.createElement(PublicSharedDocument, {
    documentType: input.document.documentType,
    documentVersion: input.document.documentVersion,
    documentStatus: input.document.status,
    createdAt: issuedAt,
    snapshotData: snapshot,
    branding,
    redactionProfile: input.shareLink.redactionProfile,
    verificationCode: input.shareLink.verificationCode,
    verificationUrl,
    documentHash: input.document.hash,
    qrCodeDataUrl,
  });
  const buffer = await streamToBuffer(element);
  return {
    buffer,
    filename: `${input.document.documentType}_${input.document.id.slice(0, 8)}_shared.pdf`,
  };
}
