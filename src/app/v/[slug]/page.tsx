import { AlertTriangle, CheckCircle2, CircleSlash2, ShieldCheck } from 'lucide-react';
import { PublicThemeToggle } from '@/components/layout/public-theme-toggle';
import { TenantLogo } from '@/components/documents/tenant-logo';
import { resolvePublicVerification } from '@/lib/document-verification';
import { resolveTenantBranding } from '@/lib/tenant-branding';
import {
  documentTypeLabel,
  formatDocumentStatus,
  formatHumanDateTime,
  formatHumanValue,
} from '@/lib/human-readable';

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

function getVerificationState(status: string) {
  if (status === 'draft') {
    return {
      label: 'Draft — not officially issued',
      valid: false,
      message: 'This record exists but has not been officially issued.',
    };
  }
  if (['revoked', 'superseded', 'cancelled', 'rejected', 'expired'].includes(status)) {
    return {
      label: formatDocumentStatus(status),
      valid: false,
      message: `This document is authentic but its current status is ${formatDocumentStatus(status).toLowerCase()}.`,
    };
  }
  return {
    label: 'Verified and active',
    valid: true,
    message:
      'The document was issued by the organisation shown and its verification record is current.',
  };
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
        <div className="border-status-error-border bg-status-error-bg rounded-xl border p-6 text-center">
          <CircleSlash2 className="text-status-error-text mx-auto h-10 w-10" />
          <h1 className="text-ink-950 mt-3 text-xl font-semibold">{state.title}</h1>
          <p className="text-ink-600 mt-2 text-sm">{state.message}</p>
        </div>
      </VerificationShell>
    );
  }

  const document = result.document;
  const branding = await resolveTenantBranding(document.tenantId);
  const snapshot = document.snapshotData as Record<string, unknown>;
  const status = getVerificationState(document.status);
  const reference = String(
    snapshot.authorityNumber || snapshot.reference || `Version ${document.documentVersion}`,
  );
  const summary = [
    ['Document', documentTypeLabel(document.documentType)],
    ['Reference', reference],
    ['Status', formatDocumentStatus(document.status)],
    ['Version', `v${document.documentVersion}`],
    ['Issue date', formatHumanDateTime(document.createdAt, branding?.locale)],
    ['Issuing authority', branding?.organisationName || 'Government Fleet'],
  ];
  for (const [label, key] of [
    ['Vehicle', 'vehicle'],
    ['Driver', 'driver'],
    ['Valid from', 'validFrom'],
    ['Valid until', 'validUntil'],
  ]) {
    if (snapshot[key] !== undefined) summary.push([label, formatHumanValue(snapshot[key], key)]);
  }

  const permanent = result.kind === 'permanent';
  const verificationCode = permanent
    ? result.verificationCode
    : result.shareLink.verificationCode || result.shareLink.shortSlug;
  const downloadAllowedByPolicy =
    !permanent &&
    result.shareLink.accessPolicy?.allowDownload === true &&
    document.status !== 'draft';
  const downloadViewAvailable =
    !permanent &&
    (!result.shareLink.maxViews || result.shareLink.currentViews + 1 < result.shareLink.maxViews);
  const canDownload = downloadAllowedByPolicy && downloadViewAvailable;

  return (
    <VerificationShell>
      <header className="border-border mb-5 flex items-start justify-between gap-4 border-b pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <TenantLogo
            src={branding?.logoUrl}
            organisationName={branding?.organisationName || 'Government Fleet'}
            code={branding?.code}
          />
          <div className="min-w-0">
            <p className="text-ink-950 truncate text-sm font-bold">
              {branding?.organisationName || 'Government Fleet'}
            </p>
            <p className="text-ink-500 text-xs">{branding?.division || 'Fleet Management'}</p>
          </div>
        </div>
        <PublicThemeToggle />
      </header>

      <div
        className={`rounded-xl border p-5 ${
          status.valid
            ? 'border-status-success-border bg-status-success-bg'
            : 'border-status-pending-bg bg-status-pending-bg'
        }`}
      >
        <div className="flex items-start gap-3">
          {status.valid ? (
            <CheckCircle2 className="text-status-success-text h-9 w-9 shrink-0" />
          ) : (
            <AlertTriangle className="text-status-pending-text h-9 w-9 shrink-0" />
          )}
          <div>
            <p className="text-ink-600 text-xs font-semibold tracking-wider uppercase">
              Live verification result
            </p>
            <h1 className="text-ink-950 text-xl font-bold">{status.label}</h1>
            <p className="text-ink-700 mt-1 text-sm">{status.message}</p>
          </div>
        </div>
      </div>

      <div className="border-border bg-surface mt-4 overflow-hidden rounded-xl border shadow-sm">
        {summary.map(([label, value]) => (
          <div
            key={label}
            className="border-border grid grid-cols-[7.5rem_1fr] gap-3 border-b px-4 py-3 last:border-0 sm:grid-cols-[10rem_1fr]"
          >
            <span className="text-ink-500 text-xs font-medium">{label}</span>
            <span className="text-ink-950 text-sm font-medium break-words">{value}</span>
          </div>
        ))}
      </div>

      <div className="border-border bg-surface mt-4 rounded-xl border p-4 text-sm">
        <p className="text-ink-500 text-xs">
          {permanent ? 'Permanent verification code' : 'Temporary share verification code'}
        </p>
        <p className="text-ink-950 mt-1 font-mono font-semibold tracking-wider">
          {verificationCode}
        </p>
        {document.hash && (
          <div className="mt-3">
            <p className="text-ink-500 text-xs">Full document fingerprint (SHA-256)</p>
            <p className="text-ink-700 mt-1 break-all font-mono text-[11px]">{document.hash}</p>
          </div>
        )}
        {permanent ? (
          <p className="text-ink-500 mt-3 text-xs">
            This official verification identity does not expire. Document status may still change if the issuing organisation supersedes or cancels the record.
          </p>
        ) : (
          <>
            <p className="text-ink-500 mt-3 text-xs">
              Temporary link valid until {formatHumanDateTime(result.shareLink.expiresAt, branding?.locale)}
            </p>
            {canDownload && (
              <a
                href={`/api/public/documents/${result.shareLink.shortSlug}/pdf`}
                className="focus-ring bg-brand-800 mt-3 inline-flex min-h-10 items-center rounded-lg px-4 text-sm font-medium text-white"
              >
                Download verified PDF
              </a>
            )}
            {downloadAllowedByPolicy && !downloadViewAvailable && (
              <p className="text-status-pending-text mt-3 text-xs">
                This verification used the final permitted access for the temporary link, so a separate PDF download is no longer available.
              </p>
            )}
          </>
        )}
      </div>
    </VerificationShell>
  );
}

function VerificationShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-page min-h-screen px-4 py-8">
      <div className="mx-auto max-w-xl">
        {children}
        <p className="text-ink-500 mt-6 flex items-center justify-center gap-2 text-center text-xs">
          <ShieldCheck className="h-4 w-4" />
          GovFleet secure document verification
        </p>
      </div>
    </main>
  );
}
