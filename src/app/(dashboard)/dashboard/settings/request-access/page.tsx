'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { ArrowLeft, Check, Copy, ExternalLink, Loader2, QrCode, ShieldCheck } from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/lib/use-toast';

type RequestAccessData = {
  tenantName: string;
  slug: string;
  enabled: boolean;
  path: string;
  emailOtpConfigured: boolean;
  verificationFallback: 'staff_directory';
};

export default function RequestAccessSettingsPage() {
  const { toast } = useToast();
  const [data, setData] = useState<RequestAccessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const publicUrl = useMemo(() => {
    if (!data || typeof window === 'undefined') return '';
    return `${window.location.origin}${data.path}`;
  }, [data]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/settings/request-access', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Could not load request access settings');
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load request access settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!publicUrl) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(publicUrl, { width: 320, margin: 2 })
      .then((value) => {
        if (!cancelled) setQrDataUrl(value);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [publicUrl]);

  async function setEnabled(enabled: boolean) {
    if (!data || saving) return;
    const previous = data.enabled;
    setData({ ...data, enabled });
    setSaving(true);
    try {
      const response = await fetch('/api/settings/request-access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Could not update request access');
      toast({
        title: enabled ? 'Employee request link enabled' : 'Employee request link disabled',
        description: enabled
          ? 'Active staff can use the tenant-specific public request link.'
          : 'New public employee verification and secure request sessions are blocked.',
        variant: 'success',
      });
    } catch (err) {
      setData({ ...data, enabled: previous });
      toast({
        title: 'Request access update failed',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
    toast({ title: 'Request link copied', variant: 'success' });
  }

  if (loading) {
    return (
      <div className="text-ink-500 flex items-center justify-center gap-2 py-16 text-sm" role="status">
        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Loading request access…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Settings', href: '/dashboard/settings' },
          { label: 'Request Access' },
        ]}
      />
      <PageHeader
        title="Employee Request Access"
        description="Manage the tenant-specific link used by active staff who do not have dashboard accounts."
      >
        <Button asChild variant="secondary" size="sm">
          <Link href="/dashboard/settings">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Tenant settings
          </Link>
        </Button>
      </PageHeader>

      {error && (
        <div className="border-status-error-border bg-status-error-bg text-status-error-text rounded-[8px] border px-4 py-3 text-sm" role="alert">
          {error}
        </div>
      )}

      {data && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="border-border bg-surface rounded-[10px] border p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="text-brand-700 mt-0.5 h-5 w-5" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h2 className="text-ink-950 text-sm font-semibold">Employee self-service link</h2>
                <p className="text-ink-500 mt-1 text-xs">
                  This is for staff already recorded in {data.tenantName}&apos;s active Staff Directory. External organisations and non-employees should use External Request Intake instead.
                </p>
              </div>
            </div>

            <label className="border-border hover:bg-muted/30 mt-5 flex cursor-pointer items-start gap-3 rounded-[8px] border p-4">
              <Checkbox
                checked={data.enabled}
                disabled={saving}
                onCheckedChange={(checked) => void setEnabled(checked === true)}
                aria-label="Allow employee requests without dashboard accounts"
              />
              <span>
                <span className="text-ink-950 block text-sm font-medium">Allow employee requests without dashboard accounts</span>
                <span className="text-ink-500 mt-1 block text-xs">
                  When disabled, the public employee request page and verification flow are blocked server-side.
                </span>
              </span>
            </label>

            <div className="mt-5">
              <p className="text-ink-700 text-xs font-medium">Public employee request URL</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <div className="border-border bg-muted/30 text-ink-800 min-w-0 flex-1 overflow-x-auto rounded-[8px] border px-3 py-2.5 font-mono text-xs">
                  {publicUrl}
                </div>
                <Button variant="secondary" size="sm" onClick={() => void copyLink()} disabled={!publicUrl}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
                <Button asChild variant="secondary" size="sm" disabled={!data.enabled}>
                  <a href={publicUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" /> Open
                  </a>
                </Button>
              </div>
            </div>

            <div className="border-border mt-5 border-t pt-5">
              <h3 className="text-ink-950 text-sm font-medium">Verification currently used</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="border-border rounded-[8px] border p-3">
                  <p className="text-ink-950 text-xs font-medium">Staff Directory match</p>
                  <p className="text-ink-500 mt-1 text-xs">Employee number + surname + registered email/mobile must match an active staff record.</p>
                </div>
                <div className="border-border rounded-[8px] border p-3">
                  <p className="text-ink-950 text-xs font-medium">Email OTP</p>
                  <p className="text-ink-500 mt-1 text-xs">
                    {data.emailOtpConfigured
                      ? 'Configured. Matching employees with email receive a one-time code.'
                      : 'Not configured yet. The verified Staff Directory fallback remains available at no messaging cost.'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <aside className="border-border bg-surface rounded-[10px] border p-5">
            <div className="flex items-center gap-2">
              <QrCode className="text-brand-700 h-5 w-5" aria-hidden="true" />
              <h2 className="text-ink-950 text-sm font-semibold">Printable QR code</h2>
            </div>
            <p className="text-ink-500 mt-1 text-xs">Place this on internal notices or send it to employees. It points only to this tenant.</p>
            <div className="border-border bg-white mt-4 flex aspect-square items-center justify-center rounded-[8px] border p-3">
              {qrDataUrl ? <img src={qrDataUrl} alt={`QR code for ${data.tenantName} employee transport request`} className="h-full w-full object-contain" /> : <Loader2 className="text-ink-400 h-5 w-5 animate-spin" />}
            </div>
            {qrDataUrl && (
              <Button asChild variant="secondary" size="sm" className="mt-3 w-full">
                <a href={qrDataUrl} download={`${data.slug}-employee-transport-request-qr.png`}>Download QR</a>
              </Button>
            )}
            <p className="text-ink-400 mt-3 text-[11px]">Disabling employee request access immediately makes the QR/link unusable until re-enabled.</p>
          </aside>
        </div>
      )}
    </div>
  );
}
