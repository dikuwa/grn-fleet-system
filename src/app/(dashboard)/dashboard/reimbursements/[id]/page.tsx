'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea, Label } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { ArrowRight, ChevronLeft, CreditCard, Fuel, CalendarDays, CheckCircle2, XCircle, DollarSign } from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { formatDate, formatCurrency } from '@/lib/utils';
import Link from 'next/link';

interface ReimbursementDetail {
  id: string;
  amount: string;
  state: string;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  claimantFirstName: string | null;
  claimantLastName: string | null;
  licenceNumber: string | null;
  make: string | null;
  model: string | null;
  transactionAt: string | null;
  stationName: string | null;
  fuelType: string | null;
  litres: string | null;
}

const STATE_LABELS: Record<string, string> = {
  pending: 'Pending', approved: 'Approved', paid: 'Paid', rejected: 'Rejected',
};

const STATE_VARIANTS: Record<string, 'success' | 'pending' | 'info' | 'error'> = {
  pending: 'pending', approved: 'info', paid: 'success', rejected: 'error',
};

const NEXT_STEP: Record<string, string> = {
  pending: 'Review supporting fuel transaction, then approve or reject',
  approved: 'Record payment reference and mark the claim as paid',
  paid: 'Financially complete — use an audited correction workflow for any reversal',
  rejected: 'Claim is closed; no further ordinary Transport Office action is available',
};

export default function ReimbursementDetailPage() {
  const params = useParams();
  const [data, setData] = useState<ReimbursementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionComment, setActionComment] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const initialLoadRef = useRef(false);
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/reimbursements/${params.id}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load reimbursement');
      const json = await res.json();
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      fetchData();
    }
  }, [fetchData]);

  const handleAction = useCallback(async (actionType: 'approved' | 'paid' | 'rejected') => {
    const notes = actionComment.trim();
    if ((actionType === 'paid' || actionType === 'rejected') && !notes) {
      setError(actionType === 'paid' ? 'Enter the payment reference or payment notes before marking this claim as paid.' : 'Enter a rejection reason before rejecting this claim.');
      return;
    }

    setActionLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/reimbursements/${params.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionType, notes: notes || null }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || 'Action failed');
      }
      setActionComment('');
      await fetchData();
      toast({
        title: actionType === 'approved' ? 'Approved' : actionType === 'paid' ? 'Paid' : 'Rejected',
        description: `Claim has been ${actionType}.`,
        variant: actionType === 'rejected' ? 'error' : 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Action failed';
      setError(msg);
      toast({ title: 'Action Failed', description: msg, variant: 'error' });
    } finally {
      setActionLoading(false);
    }
  }, [params.id, fetchData, actionComment, toast]);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Reimbursement Detail" />
        <Card><CardContent className="pt-6"><div className="flex items-center justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /></div></CardContent></Card>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Reimbursement Detail" />
        <EmptyState icon={<CreditCard className="h-8 w-8" />} title="Unable to Load" description={error} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Reimbursement Detail" />
        <EmptyState icon={<CreditCard className="h-8 w-8" />} title="Reimbursement Not Found" />
      </div>
    );
  }

  const canApprove = data.state === 'pending';
  const canPay = data.state === 'approved';
  const canReject = data.state === 'pending' || data.state === 'approved';
  const isFinal = data.state === 'paid' || data.state === 'rejected';

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Reimbursements', href: '/dashboard/reimbursements' },
        { label: `Claim #${data.id.slice(0, 8)}` },
      ]} />
      <PageHeader title="Reimbursement Claim" description={`${data.claimantFirstName} ${data.claimantLastName} · ${formatCurrency(Number(data.amount))}`}>
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/reimbursements"><ChevronLeft className="h-4 w-4" /> Back</Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">Current step</p>
              <p className="mt-0.5 text-sm font-semibold text-ink-950">{STATE_LABELS[data.state] ?? data.state}</p>
            </div>
            <ArrowRight className="hidden h-4 w-4 text-ink-400 sm:block" aria-hidden="true" />
            <div className="border-t border-border pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">Next step</p>
              <p className={`mt-0.5 text-sm font-medium ${isFinal ? 'text-ink-600' : 'text-brand-700'}`}>{NEXT_STEP[data.state] ?? 'Review claim status'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] bg-status-pending-bg text-status-pending-text">
              <CreditCard className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-ink-950">
                  {data.claimantFirstName} {data.claimantLastName}
                </h2>
                <Badge variant={STATE_VARIANTS[data.state] ?? 'pending'} size="sm">{STATE_LABELS[data.state] ?? data.state}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                <span className="flex items-center gap-1"><Fuel className="h-3.5 w-3.5" />{data.licenceNumber}</span>
                <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{formatDate(data.createdAt)}</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold tabular-nums text-ink-950">{formatCurrency(Number(data.amount))}</p>
              <p className="text-xs text-ink-500">Claim Amount</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Claim Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Status</span>
              <StatusBadge status={STATE_VARIANTS[data.state] ?? 'pending'} label={STATE_LABELS[data.state] ?? data.state} />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Amount</span>
              <span className="tabular-nums text-ink-950 font-medium">{formatCurrency(Number(data.amount))}</span>
            </div>
            {data.paidAt && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-500">Paid At</span>
                <span className="text-ink-950">{formatDate(data.paidAt)}</span>
              </div>
            )}
            {data.notes && (
              <div className="space-y-1">
                <span className="text-xs text-ink-500 font-medium">Decision / payment notes</span>
                <p className="text-sm text-ink-700 rounded-[8px] bg-muted px-3 py-2">{data.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Fuel Transaction</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Vehicle</span>
              <span className="text-ink-950">{data.make} {data.model} ({data.licenceNumber})</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Station</span>
              <span className="text-ink-950">{data.stationName || '—'}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Fuel Type</span>
              <span className="text-ink-950 capitalize">{data.fuelType || '—'}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Litres</span>
              <span className="tabular-nums text-ink-950">{data.litres ? `${Number(data.litres).toFixed(1)} L` : '—'}</span>
            </div>
            {data.transactionAt && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-500">Transaction Date</span>
                <span className="text-ink-950">{formatDate(data.transactionAt)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {(canApprove || canPay || canReject) && (
        <Card>
          <CardHeader><CardTitle>Process Claim</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Decision / payment notes</Label>
              <Textarea
                placeholder={canPay ? 'Payment reference or payment notes are required…' : 'Optional for approval; required when rejecting…'}
                value={actionComment}
                onChange={(e) => {
                  setActionComment(e.target.value);
                  setError('');
                }}
                rows={2}
              />
              <p className="text-xs text-ink-500">Rejection requires a reason. Marking as paid requires a payment reference or payment note.</p>
            </div>

            {error && (
              <div className="rounded-[8px] border border-status-error-bg bg-status-error-bg/20 px-4 py-3">
                <p className="text-sm font-medium text-status-error-text">{error}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {canApprove && (
                <Button variant="primary" size="sm" onClick={() => handleAction('approved')} loading={actionLoading}>
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </Button>
              )}
              {canPay && (
                <Button variant="primary" size="sm" onClick={() => handleAction('paid')} loading={actionLoading} disabled={!actionComment.trim()}>
                  <DollarSign className="h-4 w-4" /> Mark as Paid
                </Button>
              )}
              {canReject && (
                <Button variant="secondary" size="sm" onClick={() => handleAction('rejected')} loading={actionLoading} disabled={!actionComment.trim()}>
                  <XCircle className="h-4 w-4" /> Reject
                </Button>
              )}
              {actionLoading && <span className="text-xs text-ink-500">Processing…</span>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
