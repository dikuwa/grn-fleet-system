import type { ReactNode } from 'react';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CircleSlash2,
  Clock3,
  Download,
  FileText,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { tripAmendments, tripAuthorities } from '@/db/schema/trips';
import { TenantLogo } from '@/components/documents/tenant-logo';
import { resolvePublicVerification } from '@/lib/document-verification';
import {
  resolveTenantBranding,
  type ResolvedTenantBranding,
} from '@/lib/tenant-branding';
import { buildPublicDocumentSummary } from '@/lib/public-document-redaction';
import {
  documentTypeLabel,
  formatDocumentStatus,
  formatHumanDateTime,
} from '@/lib/human-readable';
import { VerificationCodeCopy } from './verification-code-copy';

export const dynamic = 'force-dynamic';

const INVALID_STATES: Record<string, { title: string; message: string }> = {
  not_found: {
    title: 'Document not found',
    message: 'This verification code is invalid or is no longer recognised.',
  },
  revoked: {
    title: 'Link revoked',
    message: 'The issuing organisation has revoked this secure share link.',
  },
  expired: {
    title: 'Link expired',
    message: 'This temporary share link has reached its configured expiry date.',
  },
  max_views_exceeded: {
    title: 'Access limit reached',
    message: 'This temporary share link has reached its permitted number of views.',
  },
  document_not_found: {
    title: 'Document unavailable',
    message: 'The linked record is no longer available for public verification.',
  },
};

type VerificationState = {
  label: string;
  valid: boolean;
  tone: 'success' | 'warning' | 'error';
  message: string;
  explanation: string;
};

function getVerificationState(status: string): VerificationState {
  if (status === 'draft') {
    return {
      label: 'Draft — not officially issued',
      valid: false,
      tone: 'warning',
      message: 'This record exists but has not been officially issued.',
      explanation:
        'This record can be verified as a system record, but it is still a draft and should not be treated as an issued official document.',
    };
  }
  if (status === 'superseded') {
    return {
      label: 'Superseded',
      valid: false,
      tone: 'warning',
      message: 'This document is authentic but its current status is superseded.',
      explanation:
        'This document is genuine and was issued by the stated authority. However, it has been superseded by a newer version. Always use the latest valid document for an active transaction.',
    };
  }
  if (['revoked', 'cancelled', 'rejected', 'expired'].includes(status)) {
    const formatted = formatDocumentStatus(status);
    return {
      label: formatted,
      valid: false,
      tone: status === 'expired' ? 'warning' : 'error',
      message: `This document is authentic but its current status is ${formatted.toLowerCase()}.`,
      explanation:
        'The verification record confirms the document identity, but its current status means it must not be relied on as an active authority.',
    };
  }
  return {
    label: 'Verified and active',
    valid: true,
    tone: 'success',
    message:
      'The document was issued by the organisation shown and its verification record is current.',
    explanation:
      'This document is genuine, its digital fingerprint matches the verification record, and the issuing authority currently recognises it as active.',
  };
}

function frozenVerificationBranding(
  snapshot: Record<string, unknown>,
  liveBranding: ResolvedTenantBranding | null,
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

  if (!brandingMeta && !identity) return liveBranding;

  const base = liveBranding || ({} as ResolvedTenantBranding);
  return {
    ...base,
    ...brandingMeta,
    organisationName:
      brandingMeta?.organisationName ||
      identity?.organisationName ||
      liveBranding?.organisationName ||
      'Government Fleet',
    logoUrl: identity?.logoUrl || liveBranding?.logoUrl,
    primaryColor:
      brandingMeta?.primaryColor ||
      identity?.primaryColor ||
      liveBranding?.primaryColor ||
      '#1F2A44',
    accentColor:
      brandingMeta?.accentColor ||
      identity?.accentColor ||
      liveBranding?.accentColor ||
      '#0F766E',
    executiveSignatoryName:
      brandingMeta?.executiveSignatoryName ||
      identity?.executiveSignatoryName ||
      liveBranding?.executiveSignatoryName,
    executiveSignatoryTitle:
      brandingMeta?.executiveSignatoryTitle ||
      identity?.executiveSignatoryTitle ||
      liveBranding?.executiveSignatoryTitle,
    executiveSignatureUrl:
      identity?.executiveSignatureUrl || liveBranding?.executiveSignatureUrl,
  } as ResolvedTenantBranding;
}

function frozenIssueTimestamp(snapshot: Record<string, unknown>, legacyCreatedAt: Date) {
  const identity = snapshot.documentIdentity;
  if (identity && typeof identity === 'object' && !Array.isArray(identity)) {
    const snapshottedAt = (identity as Record<string, unknown>).snapshottedAt;
    if (typeof snapshottedAt === 'string' && snapshottedAt.trim()) return snapshottedAt;
  }
  return legacyCreatedAt;
}

async function hasPostIssueTripAuthorityAmendment(input: {
  tenantId: string;
  allocationId: string;
  issuedAt: string | Date;
}) {
  const issuedAt = input.issuedAt instanceof Date ? input.issuedAt : new Date(input.issuedAt);
  if (!Number.isFinite(issuedAt.getTime())) return false;

  const db = getDb();
  const [authority] = await db
    .select({ id: tripAuthorities.id })
    .from(tripAuthorities)
    .where(
      and(
        eq(tripAuthorities.tenantId, input.tenantId),
        eq(tripAuthorities.allocationId, input.allocationId),
      ),
    )
    .limit(1);
  if (!authority) return false;

  const [amendment] = await db
    .select({ id: tripAmendments.id })
    .from(tripAmendments)
    .where(
      and(
        eq(tripAmendments.authorityId, authority.id),
        eq(tripAmendments.status, 'approved'),
        sql`COALESCE(${tripAmendments.approvedAt}, ${tripAmendments.createdAt}) > ${issuedAt}`,
      ),
    )
    .limit(1);
  return Boolean(amendment);
}

export default async function ShortVerificationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await resolvePublicVerification(slug);

  if (result.kind === 'invalid') {
    const state = INVALID_STATES[result.error || 'not_found'] || INVALID_STATES.not_found;
    return (
      <VerificationShell>
        <OfficialTenantHeader />
        <section className="border-status-error-border bg-status-error-bg mt-6 rounded-2xl border px-5 py-8 text-center sm:px-8">
          <CircleSlash2 className="text-status-error-text mx-auto h-10 w-10" aria-hidden="true" />
          <h1 className="text-ink-950 mt-3 text-xl font-semibold">{state.title}</h1>
          <p className="text-ink-600 mx-auto mt-2 max-w-lg text-sm leading-6">{state.message}</p>
        </section>
      </VerificationShell>
    );
  }

  const document = result.document;
  const snapshot = document.snapshotData as Record<string, unknown>;
  const liveBranding = await resolveTenantBranding(document.tenantId);
  const branding = frozenVerificationBranding(snapshot, liveBranding);
  const status = getVerificationState(document.status);
  const permanent = result.kind === 'permanent';
  const frozenIssueAt = frozenIssueTimestamp(snapshot, document.createdAt);
  const postIssueAuthorityAmendment =
    document.documentType === 'trip_authority' && document.entityType === 'vehicle_allocation'
      ? await hasPostIssueTripAuthorityAmendment({
          tenantId: document.tenantId,
          allocationId: document.entityId,
          issuedAt: frozenIssueAt,
        })
      : false;

  const currentVersion =
    document.status === 'superseded'
      ? (
          await getDb()
            .select({
              id: generatedDocuments.id,
              documentVersion: generatedDocuments.documentVersion,
              verificationSlug: generatedDocuments.verificationSlug,
            })
            .from(generatedDocuments)
            .where(
              and(
                eq(generatedDocuments.tenantId, document.tenantId),
                eq(generatedDocuments.entityType, document.entityType),
                eq(generatedDocuments.entityId, document.entityId),
                eq(generatedDocuments.documentType, document.documentType),
                eq(generatedDocuments.status, 'issued'),
              ),
            )
            .orderBy(desc(generatedDocuments.documentVersion))
            .limit(1)
        )[0]
      : null;

  const shareSummary = permanent
    ? null
    : buildPublicDocumentSummary({
        documentType: document.documentType,
        documentVersion: document.documentVersion,
        documentStatus: document.status,
        snapshotData: snapshot,
        profile: result.shareLink.redactionProfile,
      });
  const reference =
    shareSummary?.reference ||
    String(
      snapshot.authorityNumber ||
        snapshot.reference ||
        snapshot.requestReference ||
        `Version ${document.documentVersion}`,
    );
  const summary: Array<[string, string]> = [
    ['Document', documentTypeLabel(document.documentType)],
    ['Reference', reference],
    ['Status', formatDocumentStatus(document.status)],
    ['Version', `v${document.documentVersion}`],
    ['Issue date', formatHumanDateTime(frozenIssueAt, branding?.locale)],
    ['Issuing authority', branding?.organisationName || 'Government Fleet'],
  ];

  if (shareSummary) {
    for (const row of shareSummary.rows) {
      if (['Reference', 'Status', 'Version'].includes(row.label)) continue;
      summary.push([row.label, row.value]);
    }
  }

  const verificationCode = permanent
    ? result.verificationCode
    : result.shareLink.verificationCode || result.shareLink.shortSlug;
  const downloadAllowedByPolicy =
    !permanent &&
    result.shareLink.accessPolicy?.allowDownload === true &&
    document.status !== 'draft';
  const downloadViewAvailable =
    !permanent &&
    (!result.shareLink.maxViews || result.shareLink.currentViews + 1 <= result.shareLink.maxViews);
  const canDownload = downloadAllowedByPolicy && downloadViewAvailable;

  return (
    <VerificationShell>
      <OfficialTenantHeader branding={branding} />

      <VerificationHero status={status}>
        {currentVersion?.verificationSlug ? (
          <p className="text-ink-700 mt-3 text-sm">
            Current official version:{' '}
            <a
              href={`/v/${currentVersion.verificationSlug}`}
              className="focus-ring text-brand-800 font-semibold underline underline-offset-2"
            >
              verify v{currentVersion.documentVersion}
            </a>
          </p>
        ) : null}
      </VerificationHero>

      {postIssueAuthorityAmendment ? (
        <section className="border-status-pending-border bg-status-pending-bg mt-5 rounded-xl border p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-status-pending-text mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-ink-950 text-sm font-semibold">Subsequent operational amendments recorded</p>
              <p className="text-ink-700 mt-1 text-sm leading-6">
                This is the authentic Trip Authority issued for departure. The trip record contains one or more approved operational amendments recorded after this document was issued. The original issued authority remains unchanged as historical evidence.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="border-border bg-surface mt-5 overflow-hidden rounded-2xl border shadow-sm">
        <div className="border-border flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div className="flex items-center gap-3">
            <FileText className="text-ink-500 h-5 w-5" aria-hidden="true" />
            <h2 className="text-ink-950 text-base font-semibold">Document details</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="border-status-success-border bg-status-success-bg text-status-success-text inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Authentic record
            </span>
            <span className="text-ink-500 inline-flex items-center gap-1.5 text-xs">
              <Clock3 className="h-4 w-4" aria-hidden="true" />
              Issued {formatHumanDateTime(frozenIssueAt, branding?.locale)}
            </span>
          </div>
        </div>

        <div className="grid min-w-0 md:grid-cols-2">
          {summary.map(([label, value], index) => (
            <div
              key={`${label}-${index}`}
              className={`border-border min-w-0 px-5 py-4 sm:px-7 ${
                index < summary.length - (summary.length % 2 === 0 ? 2 : 1) ? 'border-b' : ''
              } ${index % 2 === 0 ? 'md:border-r' : ''} md:border-b`}
            >
              <div className="grid min-w-0 gap-1.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                <span className="text-ink-500 text-xs font-medium">{label}</span>
                <span className="text-ink-950 min-w-0 text-sm font-medium break-words [overflow-wrap:anywhere]">
                  {label === 'Status' ? (
                    <span className={statusPillClass(status.tone)}>{value}</span>
                  ) : (
                    value
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-border bg-surface mt-5 overflow-hidden rounded-2xl border shadow-sm">
        <div className="border-border flex items-center gap-3 border-b px-5 py-4 sm:px-7">
          <ShieldCheck className="text-ink-500 h-5 w-5" aria-hidden="true" />
          <h2 className="text-ink-950 text-base font-semibold">Verification &amp; security</h2>
        </div>

        <div className="grid min-w-0 gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
          <div className="min-w-0 space-y-5">
            <div>
              <p className="text-ink-500 text-xs">
                {permanent ? 'Permanent verification code' : 'Temporary share verification code'}
              </p>
              <div className="border-border bg-page mt-2 flex w-full max-w-sm items-center gap-2 rounded-xl border px-4 py-2.5">
                <code className="text-ink-950 min-w-0 flex-1 font-mono text-base font-bold tracking-[0.16em] break-all">
                  {verificationCode}
                </code>
                <VerificationCodeCopy value={verificationCode} />
              </div>
            </div>

            {document.hash ? (
              <div className="min-w-0">
                <p className="text-ink-500 text-xs">Full document fingerprint (SHA-256)</p>
                <div className="border-border bg-page mt-2 rounded-xl border px-4 py-3">
                  <code className="text-ink-700 block min-w-0 break-all font-mono text-[11px] leading-5">
                    {document.hash}
                  </code>
                </div>
              </div>
            ) : null}

            {permanent ? (
              <div className="text-ink-600 flex items-start gap-2 text-xs leading-5">
                <ShieldCheck className="text-brand-700 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>
                  This official verification identity does not expire. Document status may still change if the issuing organisation supersedes or cancels the record.
                </p>
              </div>
            ) : (
              <div className="text-ink-600 flex items-start gap-2 text-xs leading-5">
                <CalendarDays className="text-ink-500 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>
                  Temporary link valid until{' '}
                  <span className="text-ink-950 font-semibold">
                    {formatHumanDateTime(result.shareLink.expiresAt, branding?.locale)}
                  </span>
                </p>
              </div>
            )}
          </div>

          <div className="border-brand-200 bg-brand-50/50 dark:border-brand-800/60 dark:bg-brand-950/20 flex min-w-0 flex-col justify-between rounded-2xl border p-5">
            <div>
              <div className="flex items-start gap-3">
                <span className="bg-brand-100 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-ink-950 text-sm font-semibold">Secure and tamper-evident</h3>
                  <p className="text-ink-600 mt-2 text-sm leading-6">
                    This document was issued digitally by {branding?.organisationName || 'the stated authority'} and can be verified using GovFleet secure verification.
                  </p>
                </div>
              </div>
            </div>

            {!permanent && canDownload ? (
              <a
                href={`/api/public/documents/${result.shareLink.shortSlug}/pdf`}
                className="focus-ring bg-brand-800 hover:bg-brand-900 mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition-colors sm:w-fit"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download verified PDF
              </a>
            ) : null}

            {!permanent && downloadAllowedByPolicy && !downloadViewAvailable ? (
              <p className="text-status-pending-text mt-4 text-xs leading-5">
                This verification used the final permitted access for the temporary link, so a separate PDF download is no longer available.
              </p>
            ) : null}
          </div>
        </div>

        <div className="border-border border-t px-5 pb-5 sm:px-7 sm:pb-7">
          <div className="border-status-success-border bg-status-success-bg mt-5 flex items-start gap-3 rounded-xl border p-4">
            <ShieldCheck className="text-status-success-text mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-ink-950 text-sm font-semibold">What does this mean?</p>
              <p className="text-ink-700 mt-1 text-xs leading-5 sm:text-sm">{status.explanation}</p>
            </div>
          </div>
        </div>
      </section>
    </VerificationShell>
  );
}

function statusPillClass(tone: VerificationState['tone']) {
  if (tone === 'success') {
    return 'border-status-success-border bg-status-success-bg text-status-success-text inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold';
  }
  if (tone === 'error') {
    return 'border-status-error-border bg-status-error-bg text-status-error-text inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold';
  }
  return 'border-status-pending-border bg-status-pending-bg text-status-pending-text inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold';
}

function VerificationHero({
  status,
  children,
}: {
  status: VerificationState;
  children?: ReactNode;
}) {
  const toneClasses =
    status.tone === 'success'
      ? 'border-status-success-border bg-status-success-bg'
      : status.tone === 'error'
        ? 'border-status-error-border bg-status-error-bg'
        : 'border-status-pending-border bg-status-pending-bg';
  const iconClasses =
    status.tone === 'success'
      ? 'text-status-success-text bg-status-success-text/10'
      : status.tone === 'error'
        ? 'text-status-error-text bg-status-error-text/10'
        : 'text-status-pending-text bg-status-pending-text/10';
  const titleClasses =
    status.tone === 'success'
      ? 'text-status-success-text'
      : status.tone === 'error'
        ? 'text-status-error-text'
        : 'text-status-pending-text';

  return (
    <section className={`relative mt-6 overflow-hidden rounded-2xl border px-5 py-7 sm:px-7 sm:py-8 ${toneClasses}`}>
      <ShieldCheck
        className={`pointer-events-none absolute -right-4 top-1/2 h-32 w-32 -translate-y-1/2 opacity-[0.09] sm:right-3 sm:h-36 sm:w-36 ${titleClasses}`}
        aria-hidden="true"
      />
      <div className="relative flex items-start gap-4">
        <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full sm:h-14 sm:w-14 ${iconClasses}`}>
          {status.tone === 'success' ? (
            <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-7 w-7" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 max-w-2xl pr-6 sm:pr-24">
          <p className="text-ink-600 text-xs font-semibold tracking-[0.16em] uppercase">Live verification result</p>
          <h1 className={`mt-1 text-2xl font-bold sm:text-3xl ${titleClasses}`}>{status.label}</h1>
          <p className="text-ink-700 mt-2 text-sm leading-6">{status.message}</p>
          {children}
        </div>
      </div>
    </section>
  );
}

function OfficialTenantHeader({ branding }: { branding?: ResolvedTenantBranding | null }) {
  const contactParts = [branding?.phone, branding?.email || branding?.website].filter(Boolean);

  return (
    <header className="border-border grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)_4.5rem] items-start gap-3 border-b pb-5 sm:grid-cols-[7rem_minmax(0,1fr)_7rem] sm:gap-5 sm:pb-6">
      <div className="flex justify-center pt-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/official/namibia-coat-of-arms.png"
          alt="Republic of Namibia coat of arms"
          className="h-16 w-16 object-contain sm:h-24 sm:w-24"
        />
      </div>

      <div className="min-w-0 text-center">
        <p className="text-ink-600 text-[9px] font-semibold tracking-[0.16em] uppercase sm:text-[10px]">Republic of Namibia</p>
        <p className="text-brand-800 mt-1 text-sm font-bold tracking-wide uppercase sm:text-base">Fleet Management System</p>
        <p className="text-ink-500 mt-2 text-[9px] font-medium tracking-wide uppercase sm:text-[10px]">
          {branding?.division || 'Official fleet document verification'}
        </p>
        <p className="text-ink-950 mt-1 text-sm font-semibold leading-5 sm:text-base">
          {branding?.organisationName || 'Government Fleet'}
        </p>
        {branding?.address ? (
          <p className="text-ink-500 mt-1 text-[10px] leading-4 sm:text-xs">{branding.address}</p>
        ) : null}
        {contactParts.length ? (
          <p className="text-ink-500 mt-1 break-words text-[9px] leading-4 sm:text-xs">
            {contactParts.join('  ·  ')}
          </p>
        ) : null}
      </div>

      <div className="flex justify-center pt-1">
        {branding?.logoUrl ? (
          <TenantLogo
            src={branding.logoUrl}
            organisationName={branding.organisationName}
            code={branding.code}
            className="h-16 w-16 sm:h-24 sm:w-24"
          />
        ) : (
          <span className="h-16 w-16 sm:h-24 sm:w-24" aria-hidden="true" />
        )}
      </div>
    </header>
  );
}

function VerificationShell({ children }: { children: ReactNode }) {
  return (
    <main className="bg-page min-h-screen px-3 py-6 sm:px-5 sm:py-8 lg:px-8">
      <div className="mx-auto min-w-0 max-w-5xl">
        {children}
        <footer className="text-ink-500 mt-6 flex flex-col items-center justify-center gap-1 text-center text-xs">
          <p className="flex items-center justify-center gap-2 font-medium">
            <LockKeyhole className="h-4 w-4" aria-hidden="true" />
            Powered by GovFleet Secure Verification
          </p>
          <p>Ensuring authenticity. Protecting integrity.</p>
        </footer>
      </div>
    </main>
  );
}
