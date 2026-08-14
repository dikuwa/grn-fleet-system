'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldWrapper, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';
import { ArrowLeft, CalendarClock, Car, Loader2, ShieldCheck, UserRound } from 'lucide-react';

type AssignmentDetail = {
  id: string;
  state: string;
  assignedAt: string;
  acceptedAt: string | null;
  acceptanceMethod: string | null;
  acceptanceNote: string | null;
  cancellationReason: string | null;
  allocationId: string;
  tripId: string;
  allocationState: string;
  tripStatus: string;
  request: { id: string; reference: string; purpose: string | null; status: string };
  vehicle: { licenceNumber: string; registerNumber: string | null; make: string; model: string };
  period: { startAt: string; endAt: string };
  driver: { id: string; name: string; organisation: string; phone: string | null; email: string | null };
  licence: { id: string; number: string; class: string; expiryDate: string; verificationStatus: string };
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-NA', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ExternalAssignmentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = useState<AssignmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [acceptanceMethod, setAcceptanceMethod] = useState('in_person');
  const [note, setNote] = useState('');
  const [cancellationReason, setCancellationReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/allocations/external/${params.id}`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Could not load external assignment');
      setData(json.data);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load assignment');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { void load(); }, [load]);

  async function decide(action: 'accept' | 'cancel') {
    if (action === 'cancel' && cancellationReason.trim().length < 3) {
      setError('Enter a reason before cancelling the external driver assignment.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/allocations/external/${params.id}/decision`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'accept'
            ? { action, acceptanceMethod, note }
            : { action, reason: cancellationReason },
        ),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Decision could not be recorded');
      toast({
        title: action === 'accept' ? 'External driver acceptance recorded' : 'External driver assignment cancelled',
        description: action === 'accept'
          ? 'The trip now records the external driver as accepted for departure preparation.'
          : 'The request is ready for driver reallocation.',
        variant: action === 'accept' ? 'success' : 'pending',
      });
      await load();
      router.refresh();
    } catch (decisionError) {
      const message = decisionError instanceof Error ? decisionError.message : 'Decision failed';
      setError(message);
      toast({ title: 'Decision failed', description: message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-ink-500 flex items-center justify-center gap-2 py-16"><Loader2 className="h-5 w-5 animate-spin" /> Loading external assignment…</div>;
  }

  if (!data) {
    return <div role="alert" className="bg-status-error-bg text-status-error-text rounded-[8px] px-4 py-3 text-sm">{error || 'External assignment not found'}</div>;
  }

  const pending = data.state === 'pending_acceptance';

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Allocations', href: '/dashboard/allocations' },
        { label: data.request.reference },
      ]} />
      <PageHeader title="External Driver Assignment" description={`${data.request.reference} · ${data.driver.name}`}>
        <Button variant="secondary" size="sm" asChild><Link href="/dashboard/allocations"><ArrowLeft className="h-4 w-4" /> Back to allocations</Link></Button>
      </PageHeader>

      {error && <div role="alert" className="bg-status-error-bg text-status-error-text rounded-[8px] px-4 py-3 text-sm">{error}</div>}

      <div className="flex flex-wrap gap-2">
        <Badge variant={data.state === 'accepted' ? 'success' : data.state === 'cancelled' ? 'error' : 'pending'}>{data.state.replace(/_/g, ' ')}</Badge>
        <Badge variant="info">External driver</Badge>
        <Badge variant={data.licence.verificationStatus === 'verified' ? 'success' : 'pending'}>Licence {data.licence.verificationStatus.replace(/_/g, ' ')}</Badge>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><UserRound className="h-4 w-4" /> Driver</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-ink-950 font-semibold">{data.driver.name}</p>
            <p className="text-ink-600">{data.driver.organisation}</p>
            {data.driver.phone && <p className="text-ink-500">{data.driver.phone}</p>}
            {data.driver.email && <p className="text-ink-500">{data.driver.email}</p>}
            <div className="border-border mt-3 rounded-[8px] border p-3">
              <p className="text-status-success-text flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4" /> Verified licence evidence</p>
              <p className="text-ink-600 mt-1">Class {data.licence.class} · expires {data.licence.expiryDate}</p>
              <p className="text-ink-400 mt-1 text-xs">Licence reference: {data.licence.number}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Car className="h-4 w-4" /> Trip allocation</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-ink-950 font-semibold">{data.vehicle.licenceNumber} · {data.vehicle.make} {data.vehicle.model}</p>
            {data.vehicle.registerNumber && <p className="text-ink-500">Register: {data.vehicle.registerNumber}</p>}
            <p className="text-ink-600">{data.request.purpose || 'Transport request'}</p>
            <p className="text-ink-500 flex items-center gap-2"><CalendarClock className="h-4 w-4" /> {formatDate(data.period.startAt)} → {formatDate(data.period.endAt)}</p>
            <div className="mt-3 flex flex-wrap gap-2"><Badge variant="info">Allocation {data.allocationState}</Badge><Badge variant="default">Trip {data.tripStatus}</Badge></div>
          </CardContent>
        </Card>
      </div>

      {pending && (
        <Card>
          <CardHeader><CardTitle>Record driver decision</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="bg-status-info-bg text-status-info-text rounded-[8px] px-4 py-3 text-sm">
              Record only a decision actually communicated by the external driver. This is a staff-recorded acceptance, not a system self-acknowledgement by the external person.
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <FieldWrapper label="Acceptance confirmation method" required>
                  <StyledSelect value={acceptanceMethod} onChange={(event) => setAcceptanceMethod(event.target.value)}>
                    <option value="in_person">Confirmed in person</option>
                    <option value="phone">Confirmed by phone</option>
                    <option value="signed_paper">Signed paper acceptance</option>
                    <option value="secure_link">Secure link confirmation</option>
                  </StyledSelect>
                </FieldWrapper>
                <FieldWrapper label="Acceptance note"><Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional reference or confirmation note" /></FieldWrapper>
                <Button loading={saving} onClick={() => void decide('accept')}>Record acceptance</Button>
              </div>
              <div className="border-border border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
                <FieldWrapper label="Cancel / cannot perform reason" required><Textarea rows={3} value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} placeholder="Why must this driver be reallocated?" /></FieldWrapper>
                <Button variant="danger" loading={saving} className="mt-4" onClick={() => void decide('cancel')}>Cancel driver assignment</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {data.state === 'accepted' && (
        <div className="bg-status-success-bg text-status-success-text rounded-[8px] px-4 py-3 text-sm">
          Acceptance recorded {data.acceptedAt ? formatDate(data.acceptedAt) : ''}{data.acceptanceMethod ? ` via ${data.acceptanceMethod.replace(/_/g, ' ')}` : ''}. This acceptance is retained with the external assignment audit record.
        </div>
      )}
      {data.state === 'cancelled' && data.cancellationReason && (
        <div className="bg-status-warning-bg text-status-warning-text rounded-[8px] px-4 py-3 text-sm">Cancelled: {data.cancellationReason}. Transport Office should allocate another driver.</div>
      )}
    </div>
  );
}
