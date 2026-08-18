'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/lib/use-toast';

interface InvitationData {
  tenant: { id: string; name: string; lifecycleStatus: string };
  invitation: {
    id: string;
    email: string;
    name: string | null;
    status: string;
    expiresAt: string;
    sentAt: string | null;
    acceptedAt: string | null;
    createdAt: string;
  } | null;
  emailConfigured: boolean;
  invitationTtlDays: number;
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-NA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function statusVariant(status: string) {
  if (status === 'accepted') return 'success' as const;
  if (status === 'expired' || status === 'cancelled') return 'error' as const;
  if (status === 'sent') return 'info' as const;
  return 'warning' as const;
}

export default function TenantAdministratorInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { toast } = useToast();
  const [data, setData] = useState<InvitationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [emailSent, setEmailSent] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/platform/tenants/${id}/admin-invitation`, {
        cache: 'no-store',
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not load invitation');
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load invitation');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function regenerate() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/platform/tenants/${id}/admin-invitation`, {
        method: 'POST',
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Invitation could not be regenerated');
      setManualUrl(json.data.acceptUrl || '');
      setEmailSent(json.data.emailSent === true);
      setData((current) =>
        current
          ? {
              ...current,
              invitation: json.data.invitation,
              emailConfigured: json.data.emailConfigured,
            }
          : current,
      );
      toast({
        title: json.data.emailSent ? 'Invitation regenerated and emailed' : 'Secure link generated',
        description: json.data.emailSent
          ? 'A fresh seven-day invitation was sent. You may also copy the link as a fallback.'
          : 'Copy the secure link and send it to the Tenant Administrator manually.',
        variant: 'success',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invitation could not be regenerated';
      setError(message);
      toast({ title: 'Invitation update failed', description: message, variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!manualUrl) return;
    try {
      await navigator.clipboard.writeText(manualUrl);
      toast({ title: 'Invitation link copied', variant: 'success' });
    } catch {
      toast({
        title: 'Could not copy automatically',
        description: 'Select the link and copy it manually.',
        variant: 'error',
      });
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-ink-500" role="status">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> Loading invitation…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Platform', href: '/dashboard/platform' }, { label: 'Tenants', href: '/dashboard/platform/tenants' }, { label: 'Administrator Invitation' }]} />
        <EmptyState icon={<Mail className="h-6 w-6" />} title="Invitation unavailable" description={error || 'No invitation information is available.'} />
      </div>
    );
  }

  const invitation = data.invitation;
  const accepted = invitation?.status === 'accepted';

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Platform', href: '/dashboard/platform' },
          { label: 'Tenants', href: '/dashboard/platform/tenants' },
          { label: data.tenant.name, href: `/dashboard/platform/tenants/${id}` },
          { label: 'Administrator Invitation' },
        ]}
      />
      <PageHeader
        title="Tenant Administrator Invitation"
        description="Securely hand over initial tenant access without requiring a messaging provider."
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/dashboard/platform/tenants/${id}`}>Tenant details</Link>
        </Button>
      </PageHeader>

      {error && (
        <div className="rounded-[8px] border border-status-error-border bg-status-error-bg px-4 py-3 text-sm text-status-error-text" role="alert">
          {error}
        </div>
      )}

      {!invitation ? (
        <EmptyState
          icon={<Mail className="h-6 w-6" />}
          title="No Tenant Administrator invitation"
          description="This tenant does not currently have an administrator invitation to manage."
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Administrator access</CardTitle>
                  <p className="mt-1 text-sm text-ink-500">
                    {invitation.name || 'Tenant Administrator'} · {invitation.email}
                  </p>
                </div>
                <Badge variant={statusVariant(invitation.status)} size="sm">
                  {invitation.status.replaceAll('_', ' ')}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[8px] border border-border bg-muted/20 p-3">
                  <p className="text-xs text-ink-400">Expires</p>
                  <p className="mt-1 text-sm font-medium text-ink-950">{formatDateTime(invitation.expiresAt)}</p>
                </div>
                <div className="rounded-[8px] border border-border bg-muted/20 p-3">
                  <p className="text-xs text-ink-400">Email delivery</p>
                  <p className="mt-1 text-sm font-medium text-ink-950">
                    {data.emailConfigured ? 'Configured' : 'Not configured'}
                  </p>
                </div>
                <div className="rounded-[8px] border border-border bg-muted/20 p-3">
                  <p className="text-xs text-ink-400">Accepted</p>
                  <p className="mt-1 text-sm font-medium text-ink-950">{formatDateTime(invitation.acceptedAt)}</p>
                </div>
              </div>

              {accepted ? (
                <div className="flex items-start gap-3 rounded-[8px] border border-status-success-border bg-status-success-bg p-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-status-success-text" />
                  <div>
                    <p className="text-sm font-semibold text-status-success-text">Invitation accepted</p>
                    <p className="mt-1 text-xs text-ink-600">
                      The Tenant Administrator has completed the secure handoff. No invitation link is required.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 rounded-[8px] border border-brand-200 bg-brand-50/40 p-4 dark:bg-brand-950/10">
                    {data.emailConfigured ? (
                      <Mail className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
                    ) : (
                      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
                    )}
                    <div>
                      <p className="text-sm font-semibold text-ink-950">
                        {data.emailConfigured ? 'Email is available' : 'Manual delivery is ready'}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-ink-600">
                        {data.emailConfigured
                          ? 'Generating a fresh link also attempts email delivery. The same secure link is returned here as a fallback.'
                          : `No email provider is configured. Generate a secure link and send it through a trusted channel such as direct email, WhatsApp or in person. The link expires after ${data.invitationTtlDays} days and is single-use.`}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void regenerate()} loading={busy} disabled={busy}>
                      <RefreshCw className="h-4 w-4" /> Generate fresh secure link
                    </Button>
                  </div>

                  {manualUrl && (
                    <div className="space-y-3 rounded-[8px] border border-border bg-surface p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-ink-950">
                        <Clock3 className="h-4 w-4 text-brand-700" /> Fresh invitation link
                      </div>
                      <p className="break-all rounded-[6px] bg-muted px-3 py-2 font-mono text-xs text-ink-700">
                        {manualUrl}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" size="sm" onClick={() => void copyLink()}>
                          <Copy className="h-4 w-4" /> Copy link
                        </Button>
                        <Button variant="secondary" size="sm" asChild>
                          <a href={manualUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-4 w-4" /> Open link
                          </a>
                        </Button>
                      </div>
                      <p className="text-xs text-ink-500">
                        {emailSent === true
                          ? 'Email delivery succeeded. Keep this link only as a fallback.'
                          : 'This raw link is shown only for this regeneration response. Generate another link if it is lost.'}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
