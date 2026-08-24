'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, Link2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmployeeCombobox, type EmployeeSearchOption } from '@/components/ui/employee-combobox';
import { StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';

interface IntakeLink {
  id: string;
  label: string | null;
  sponsorEmployeeId: string;
  sponsorFirstName: string;
  sponsorLastName: string;
  tripScope: string;
  expiresAt: string;
  maxSubmissions: number;
  submissionCount: number;
  lastSubmittedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  isExpired: boolean;
}

export default function ExternalIntakeLinksPage() {
  const { toast } = useToast();
  const [links, setLinks] = useState<IntakeLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sponsor, setSponsor] = useState<EmployeeSearchOption | null>(null);
  const [tripScope, setTripScope] = useState<'regional' | 'national'>('regional');
  const [expiresInHours, setExpiresInHours] = useState('168');
  const [maxSubmissions, setMaxSubmissions] = useState('1');
  const [label, setLabel] = useState('');
  const [newUrl, setNewUrl] = useState<string | null>(null);

  const loadLinks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/transport-requests/external/intake-links', { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Could not load external intake links');
      setLinks(Array.isArray(json.data) ? json.data : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load external intake links');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLinks(), 0);
    return () => window.clearTimeout(timer);
  }, [loadLinks]);

  async function createLink() {
    if (!sponsor) {
      setError('Select the internal sponsor who will own and route requests from this link.');
      return;
    }
    setSaving(true);
    setError('');
    setNewUrl(null);
    try {
      const response = await fetch('/api/transport-requests/external/intake-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sponsorEmployeeId: sponsor.id,
          tripScope,
          expiresInHours: Number(expiresInHours),
          maxSubmissions: Number(maxSubmissions),
          label,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Could not create external intake link');
      setNewUrl(json.data.intakeUrl);
      setLabel('');
      toast({
        title: 'Secure intake link created',
        description: 'Copy the link now. The bearer token is not stored in plaintext and cannot be shown again later.',
        variant: 'success',
      });
      await loadLinks();
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Could not create external intake link';
      setError(message);
      toast({ title: 'Link creation failed', description: message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function revoke(id: string) {
    try {
      const response = await fetch(`/api/transport-requests/external/intake-links?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Could not revoke link');
      toast({ title: 'Link revoked', description: 'The public link can no longer accept requests.', variant: 'success' });
      await loadLinks();
    } catch (revokeError) {
      const message = revokeError instanceof Error ? revokeError.message : 'Could not revoke link';
      toast({ title: 'Revocation failed', description: message, variant: 'error' });
    }
  }

  async function copyNewUrl() {
    if (!newUrl) return;
    await navigator.clipboard.writeText(newUrl);
    toast({ title: 'Link copied', description: 'Share it only with the intended external requester.', variant: 'success' });
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Requests', href: '/dashboard/requests' },
        { label: 'External Request Intake', href: '/dashboard/requests/external/new' },
        { label: 'Secure Links' },
      ]} />
      <PageHeader
        title="External Intake Links"
        description="Issue controlled public request links that remain bound to one internal sponsor and the tenant's normal approval workflow."
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/requests/external/new">Assisted external intake</Link>
        </Button>
      </PageHeader>

      <div className="rounded-[8px] bg-status-info-bg px-4 py-3 text-sm text-status-info-text">
        The public requester cannot choose approvers, employees, drivers, vehicles or a tenant. Those controls remain internal. A secure link contains a bearer secret and should be shared only with the intended requester.
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4" /> Create secure link</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-500">Internal sponsor *</label>
              <EmployeeCombobox
                kind="employee"
                value={sponsor?.id || ''}
                selectedOption={sponsor}
                onSelect={setSponsor}
                placeholder="Search active employee"
              />
              <p className="mt-1 text-xs text-ink-500">This employee supplies the region, office and department used for workflow routing.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-500">Trip scope</label>
                <StyledSelect value={tripScope} onChange={(event) => setTripScope(event.target.value === 'national' ? 'national' : 'regional')}>
                  <option value="regional">Regional</option><option value="national">National</option>
                </StyledSelect>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-500">Expires</label>
                <StyledSelect value={expiresInHours} onChange={(event) => setExpiresInHours(event.target.value)}>
                  <option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option><option value="336">14 days</option><option value="720">30 days</option>
                </StyledSelect>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-500">Maximum submissions</label>
                <input type="number" min={1} max={1000} value={maxSubmissions} onChange={(event) => setMaxSubmissions(event.target.value)} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-500">Purpose / label</label>
                <input value={label} maxLength={160} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Contractor site visit" className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950" />
              </div>
            </div>
            {error ? <div role="alert" className="rounded-[8px] border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-800">{error}</div> : null}
            <Button onClick={createLink} disabled={saving || !sponsor} className="w-full sm:w-auto">
              <Link2 className="h-4 w-4" /> {saving ? 'Creating…' : 'Create secure link'}
            </Button>
            {newUrl ? (
              <div className="rounded-[8px] border border-status-success-border bg-status-success-bg p-4">
                <p className="text-sm font-medium text-status-success-text">Copy this link now</p>
                <p className="mt-1 break-all font-mono text-xs text-ink-700">{newUrl}</p>
                <Button variant="secondary" size="sm" className="mt-3" onClick={copyNewUrl}><Copy className="h-4 w-4" /> Copy link</Button>
                <p className="mt-2 text-xs text-ink-500">For security, the secret token is stored only as a one-way hash and this full URL cannot be reconstructed later.</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3"><CardTitle>Issued links</CardTitle><Button variant="ghost" size="sm" onClick={() => void loadLinks()} disabled={loading}><RotateCcw className="h-4 w-4" /> Refresh</Button></div>
          </CardHeader>
          <CardContent>
            {loading ? <p className="py-8 text-center text-sm text-ink-500">Loading links…</p> : links.length === 0 ? <p className="rounded-[8px] border border-dashed border-border px-4 py-8 text-center text-sm text-ink-500">No external intake links have been issued.</p> : (
              <div className="space-y-3">
                {links.map((link) => {
                  const exhausted = link.submissionCount >= link.maxSubmissions;
                  const active = !link.revokedAt && !link.isExpired && !exhausted;
                  return (
                    <div key={link.id} className="rounded-[8px] border border-border p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-ink-950">{link.label || 'External request intake'}</p>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${active ? 'bg-status-success-bg text-status-success-text' : 'bg-muted text-ink-600'}`}>{link.revokedAt ? 'Revoked' : link.isExpired ? 'Expired' : exhausted ? 'Limit reached' : 'Active'}</span>
                          </div>
                          <p className="mt-1 text-sm text-ink-600">Sponsor: {link.sponsorFirstName} {link.sponsorLastName} · <span className="capitalize">{link.tripScope}</span></p>
                          <p className="mt-1 text-xs text-ink-500">Submissions {link.submissionCount}/{link.maxSubmissions} · Expires {new Date(link.expiresAt).toLocaleString()}</p>
                        </div>
                        {active ? <Button variant="ghost" size="sm" onClick={() => void revoke(link.id)}><Trash2 className="h-4 w-4" /> Revoke</Button> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
