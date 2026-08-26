'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, BadgeDollarSign, Loader2 } from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';

type FormState = {
  reference: string;
  financialImpact: 'none' | 'within_budget' | 'additional_funding';
  tripCategory: string;
  estimatedCost: string;
  costCentre: string;
  fundingSource: string;
  budgetReference: string;
};

function fieldClass() {
  return 'border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 min-h-11 w-full rounded-[8px] border px-3 py-2 text-sm focus:ring-2 focus:outline-none';
}

export default function RoutingCorrectionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const requestId = params.id;
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/requests/${requestId}/resubmit`, { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to load request governance details');
        if (cancelled) return;
        const request = payload.data.request;
        setForm({
          reference: request.reference,
          financialImpact:
            request.financialImpact === 'within_budget' || request.financialImpact === 'additional_funding'
              ? request.financialImpact
              : 'none',
          tripCategory: request.tripCategory || 'general',
          estimatedCost: request.estimatedCost || '',
          costCentre: request.costCentre || '',
          fundingSource: request.fundingSource || '',
          budgetReference: request.budgetReference || '',
        });
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load request');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  function patch(value: Partial<FormState>) {
    setForm((current) => (current ? { ...current, ...value } : current));
  }

  async function saveAndContinue() {
    if (!form || saving) return;
    setError(null);
    const category = form.tripCategory.trim().toLowerCase().replace(/\s+/g, '_');
    if (category.length < 2) {
      setError('Trip category is required.');
      return;
    }
    if (form.estimatedCost) {
      const amount = Number(form.estimatedCost);
      if (!Number.isFinite(amount) || amount < 0) {
        setError('Estimated cost must be a valid non-negative amount.');
        return;
      }
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/requests/${requestId}/routing-correction`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          financialImpact: form.financialImpact,
          tripCategory: category,
          estimatedCost: form.financialImpact === 'none' ? null : form.estimatedCost,
          costCentre: form.financialImpact === 'none' ? null : form.costCentre.trim(),
          fundingSource: form.financialImpact === 'none' ? null : form.fundingSource.trim(),
          budgetReference: form.financialImpact === 'none' ? null : form.budgetReference.trim(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to save governance details');
      toast({
        title: payload.changed ? 'Routing details updated' : 'Routing details confirmed',
        description: 'Continue with the remaining request corrections before resubmitting.',
        variant: 'success',
      });
      router.push(`/dashboard/requests/${requestId}/edit`);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Unable to save governance details';
      setError(message);
      toast({ title: 'Save failed', description: message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-ink-500" role="status">
        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />
        Loading routing details…
      </div>
    );
  }

  if (!form) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Requests', href: '/dashboard/requests' }, { label: 'Review Routing & Budget' }]} />
        <PageHeader title="Review Routing & Budget" description="Returned transport request" />
        <div className="border-status-error-border bg-status-error-bg text-status-error-text rounded-[8px] border p-4 text-sm" role="alert">
          {error || 'This request cannot be corrected.'}
        </div>
        <Button variant="secondary" asChild>
          <Link href="/dashboard/requests"><ArrowLeft className="h-4 w-4" /> Back to Requests</Link>
        </Button>
      </div>
    );
  }

  const hasFinancialImpact = form.financialImpact !== 'none';

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-24 sm:space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Requests', href: '/dashboard/requests' }, { label: form.reference, href: `/dashboard/requests/${requestId}` }, { label: 'Review Routing & Budget' }]} />
      <PageHeader
        title="Review Routing & Budget"
        description={`${form.reference} · confirm the governance details that determine the approval route`}
      >
        <Button variant="secondary" size="sm" asChild className="w-full sm:w-auto">
          <Link href={`/dashboard/requests/${requestId}`}><ArrowLeft className="h-4 w-4" /> Back to Request</Link>
        </Button>
      </PageHeader>

      <div className="border-status-pending-border bg-status-pending-bg text-status-pending-text rounded-[8px] border px-4 py-3 text-sm">
        Returned requests may need a different approval route after corrections. Confirm the trip category and financial impact first; the system will use these saved values when the approval workflow is restarted.
      </div>

      {error && (
        <div className="border-status-error-border bg-status-error-bg text-status-error-text rounded-[8px] border px-4 py-3 text-sm" role="alert">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BadgeDollarSign className="h-4 w-4" /> Governance classification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-ink-500 mb-1 block text-xs font-medium">Financial impact *</label>
              <StyledSelect
                value={form.financialImpact}
                onChange={(event) => patch({ financialImpact: event.target.value as FormState['financialImpact'] })}
              >
                <option value="none">No financial impact</option>
                <option value="within_budget">Within approved budget</option>
                <option value="additional_funding">Additional funding required</option>
              </StyledSelect>
              <p className="text-ink-500 mt-1 text-xs">This determines whether a configured Finance / Budget Review route applies.</p>
            </div>
            <div>
              <label className="text-ink-500 mb-1 block text-xs font-medium">Trip category *</label>
              <input
                value={form.tripCategory}
                onChange={(event) => patch({ tripCategory: event.target.value })}
                className={fieldClass()}
                placeholder="e.g. learner transport, outreach, official business"
              />
              <p className="text-ink-500 mt-1 text-xs">Use the organisation's configured category. Spaces are normalised automatically.</p>
            </div>
          </div>

          {hasFinancialImpact ? (
            <div className="border-border grid gap-4 rounded-[10px] border p-4 sm:grid-cols-2">
              <div>
                <label className="text-ink-500 mb-1 block text-xs font-medium">Estimated cost (N$)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.estimatedCost}
                  onChange={(event) => patch({ estimatedCost: event.target.value })}
                  className={fieldClass()}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="text-ink-500 mb-1 block text-xs font-medium">Cost centre</label>
                <input value={form.costCentre} onChange={(event) => patch({ costCentre: event.target.value })} className={fieldClass()} />
              </div>
              <div>
                <label className="text-ink-500 mb-1 block text-xs font-medium">Funding source</label>
                <input value={form.fundingSource} onChange={(event) => patch({ fundingSource: event.target.value })} className={fieldClass()} />
              </div>
              <div>
                <label className="text-ink-500 mb-1 block text-xs font-medium">Budget reference</label>
                <input value={form.budgetReference} onChange={(event) => patch({ budgetReference: event.target.value })} className={fieldClass()} />
              </div>
            </div>
          ) : (
            <p className="border-border bg-surface-subtle text-ink-500 rounded-[8px] border px-4 py-3 text-xs">
              Budget metadata will be cleared because this revision declares no financial impact.
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button variant="secondary" asChild>
              <Link href={`/dashboard/requests/${requestId}`}>Cancel</Link>
            </Button>
            <Button loading={saving} disabled={saving} onClick={() => void saveAndContinue()}>
              Save & Continue to Corrections
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
