'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldWrapper, Input, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';
import {
  ArrowLeft,
  CalendarClock,
  Car,
  Gauge,
  KeyRound,
  Loader2,
  Play,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

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
  issueId: string | null;
  issueOdometer: number | null;
  tripIssuedAt: string | null;
  authorityStatus: string | null;
  allocationState: string;
  tripStatus: string;
  request: { id: string; reference: string; purpose: string | null; status: string };
  vehicle: {
    licenceNumber: string;
    registerNumber: string | null;
    make: string;
    model: string;
    currentOdometer: number;
  };
  period: { startAt: string; endAt: string };
  driver: {
    id: string;
    name: string;
    organisation: string;
    phone: string | null;
    email: string | null;
  };
  licence: {
    id: string;
    number: string;
    class: string;
    expiryDate: string;
    verificationStatus: string;
  };
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-NA', { dateStyle: 'medium', timeStyle: 'short' });
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
  const [issueOdometer, setIssueOdometer] = useState('');
  const [fuelCardIssued, setFuelCardIssued] = useState('no');
  const [issueNotes, setIssueNotes] = useState('');
  const [startOdometer, setStartOdometer] = useState('');
  const [fuelLevel, setFuelLevel] = useState('');
  const [passengersConfirmed, setPassengersConfirmed] = useState('no');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/allocations/external/${params.id}`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Could not load external assignment');
      const nextData = json.data as AssignmentDetail;
      setData(nextData);
      setIssueOdometer((current) => current || String(nextData.vehicle.currentOdometer ?? 0));
      setStartOdometer(
        (current) => current || String(nextData.issueOdometer ?? nextData.vehicle.currentOdometer ?? 0),
      );
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load assignment');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

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
        title:
          action === 'accept'
            ? 'External driver acceptance recorded'
            : 'External driver assignment cancelled',
        description:
          action === 'accept'
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

  async function issueVehicle() {
    const parsedOdometer = Number(issueOdometer);
    if (!Number.isInteger(parsedOdometer) || parsedOdometer < 0) {
      setError('Enter a valid whole-number issue odometer.');
      return;
    }
    if (!data) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/trips/${data.tripId}/external-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueOdometer: parsedOdometer,
          keysIssued: true,
          fuelCardIssued: fuelCardIssued === 'yes',
          notes: issueNotes,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Vehicle issue could not be recorded');
      toast({
        title: 'Vehicle issued',
        description: 'Physical issue evidence is recorded against the accepted external assignment.',
        variant: 'success',
      });
      setStartOdometer(String(parsedOdometer));
      await load();
      router.refresh();
    } catch (issueError) {
      const message = issueError instanceof Error ? issueError.message : 'Vehicle issue failed';
      setError(message);
      toast({ title: 'Vehicle issue failed', description: message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function startTrip() {
    const parsedOdometer = Number(startOdometer);
    if (!Number.isInteger(parsedOdometer) || parsedOdometer < 0) {
      setError('Enter a valid whole-number beginning odometer.');
      return;
    }
    if (!fuelLevel.trim()) {
      setError('Record the fuel level before starting the trip.');
      return;
    }
    if (passengersConfirmed !== 'yes') {
      setError('Confirm the actual passenger manifest before starting the trip.');
      return;
    }
    if (!data) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/trips/${data.tripId}/external-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          beginningOdometer: parsedOdometer,
          passengersConfirmed: true,
          fuelLevel: fuelLevel.trim(),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Trip could not be started');
      toast({
        title: 'External-driver trip started',
        description: 'The trip, authority, request and vehicle are now in their active lifecycle states.',
        variant: 'success',
      });
      await load();
      router.refresh();
    } catch (startError) {
      const message = startError instanceof Error ? startError.message : 'Trip start failed';
      setError(message);
      toast({ title: 'Trip start failed', description: message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="text-ink-500 flex items-center justify-center gap-2 py-16">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading external assignment…
      </div>
    );
  }

  if (!data) {
    return (
      <div
        role="alert"
        className="bg-status-error-bg text-status-error-text rounded-[8px] px-4 py-3 text-sm"
      >
        {error || 'External assignment not found'}
      </div>
    );
  }

  const pending = data.state === 'pending_acceptance';
  const canIssue =
    data.state === 'accepted' &&
    !data.issueId &&
    data.tripStatus === 'pending' &&
    data.allocationState === 'confirmed' &&
    data.request.status === 'authorised' &&
    data.authorityStatus === 'ready_for_departure';
  const canStart =
    data.state === 'accepted' &&
    Boolean(data.issueId) &&
    Boolean(data.tripIssuedAt) &&
    data.tripStatus === 'pending' &&
    data.request.status === 'vehicle_issued' &&
    data.authorityStatus === 'ready_for_departure';

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Allocations', href: '/dashboard/allocations' },
          { label: data.request.reference },
        ]}
      />
      <PageHeader
        title="External Driver Assignment"
        description={`${data.request.reference} · ${data.driver.name}`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/allocations">
            <ArrowLeft className="h-4 w-4" /> Back to allocations
          </Link>
        </Button>
      </PageHeader>

      {error && (
        <div
          role="alert"
          className="bg-status-error-bg text-status-error-text rounded-[8px] px-4 py-3 text-sm"
        >
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Badge
          variant={
            data.state === 'accepted' ? 'success' : data.state === 'cancelled' ? 'error' : 'pending'
          }
        >
          {data.state.replace(/_/g, ' ')}
        </Badge>
        <Badge variant="info">External driver</Badge>
        <Badge
          variant={data.licence.verificationStatus === 'verified' ? 'success' : 'pending'}
        >
          Licence {data.licence.verificationStatus.replace(/_/g, ' ')}
        </Badge>
        <Badge variant="default">Request {data.request.status.replace(/_/g, ' ')}</Badge>
        {data.authorityStatus && (
          <Badge variant="default">Authority {data.authorityStatus.replace(/_/g, ' ')}</Badge>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="h-4 w-4" /> Driver
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-ink-950 font-semibold">{data.driver.name}</p>
            <p className="text-ink-600">{data.driver.organisation}</p>
            {data.driver.phone && <p className="text-ink-500">{data.driver.phone}</p>}
            {data.driver.email && <p className="text-ink-500">{data.driver.email}</p>}
            <div className="border-border mt-3 rounded-[8px] border p-3">
              <p className="text-status-success-text flex items-center gap-2 font-medium">
                <ShieldCheck className="h-4 w-4" /> Verified licence evidence
              </p>
              <p className="text-ink-600 mt-1">
                Class {data.licence.class} · expires {data.licence.expiryDate}
              </p>
              <p className="text-ink-400 mt-1 text-xs">Licence reference: {data.licence.number}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Car className="h-4 w-4" /> Trip allocation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-ink-950 font-semibold">
              {data.vehicle.licenceNumber} · {data.vehicle.make} {data.vehicle.model}
            </p>
            {data.vehicle.registerNumber && (
              <p className="text-ink-500">Register: {data.vehicle.registerNumber}</p>
            )}
            <p className="text-ink-600">{data.request.purpose || 'Transport request'}</p>
            <p className="text-ink-500 flex items-center gap-2">
              <CalendarClock className="h-4 w-4" /> {formatDate(data.period.startAt)} →{' '}
              {formatDate(data.period.endAt)}
            </p>
            <p className="text-ink-500 flex items-center gap-2">
              <Gauge className="h-4 w-4" /> Current odometer {data.vehicle.currentOdometer.toLocaleString()} km
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="info">Allocation {data.allocationState}</Badge>
              <Badge variant="default">Trip {data.tripStatus}</Badge>
              {data.issueId && <Badge variant="success">Vehicle issued</Badge>}
            </div>
          </CardContent>
        </Card>
      </div>

      {pending && (
        <Card>
          <CardHeader>
            <CardTitle>Record driver decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="bg-status-info-bg text-status-info-text rounded-[8px] px-4 py-3 text-sm">
              Record only a decision actually communicated by the external driver. This is a
              staff-recorded acceptance, not a system self-acknowledgement by the external person.
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <FieldWrapper label="Acceptance confirmation method" required>
                  <StyledSelect
                    value={acceptanceMethod}
                    onChange={(event) => setAcceptanceMethod(event.target.value)}
                  >
                    <option value="in_person">Confirmed in person</option>
                    <option value="phone">Confirmed by phone</option>
                    <option value="signed_paper">Signed paper acceptance</option>
                    <option value="secure_link">Secure link confirmation</option>
                  </StyledSelect>
                </FieldWrapper>
                <FieldWrapper label="Acceptance note">
                  <Textarea
                    rows={3}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Optional reference or confirmation note"
                  />
                </FieldWrapper>
                <Button loading={saving} onClick={() => void decide('accept')}>
                  Record acceptance
                </Button>
              </div>
              <div className="border-border border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
                <FieldWrapper label="Cancel / cannot perform reason" required>
                  <Textarea
                    rows={3}
                    value={cancellationReason}
                    onChange={(event) => setCancellationReason(event.target.value)}
                    placeholder="Why must this driver be reallocated?"
                  />
                </FieldWrapper>
                <Button
                  variant="destructive"
                  loading={saving}
                  className="mt-4"
                  onClick={() => void decide('cancel')}
                >
                  Cancel driver assignment
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {data.state === 'accepted' && (
        <div className="bg-status-success-bg text-status-success-text rounded-[8px] px-4 py-3 text-sm">
          Acceptance recorded {data.acceptedAt ? formatDate(data.acceptedAt) : ''}
          {data.acceptanceMethod
            ? ` via ${data.acceptanceMethod.replace(/_/g, ' ')}`
            : ''}
          . This acceptance is retained with the external assignment audit record.
        </div>
      )}

      {data.state === 'accepted' && !data.issueId && !canIssue && (
        <div className="bg-status-pending-bg text-status-pending-text rounded-[8px] px-4 py-3 text-sm">
          Physical issue is not available yet. Final request authorisation, a ready Trip Authority,
          a confirmed allocation and all pre-departure safety checks must be complete first.
        </div>
      )}

      {canIssue && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> Physical vehicle issue
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-status-info-bg text-status-info-text rounded-[8px] px-4 py-3 text-sm">
              Record the actual handover of the vehicle. The backend rechecks the accepted external
              driver, current verified licence, latest departure inspection, defects and authority
              before committing the issue.
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldWrapper label="Issue odometer" required>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={issueOdometer}
                  onChange={(event) => setIssueOdometer(event.target.value)}
                />
              </FieldWrapper>
              <FieldWrapper label="Fuel card issued">
                <StyledSelect
                  value={fuelCardIssued}
                  onChange={(event) => setFuelCardIssued(event.target.value)}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </StyledSelect>
              </FieldWrapper>
            </div>
            <FieldWrapper label="Issue notes">
              <Textarea
                rows={3}
                value={issueNotes}
                onChange={(event) => setIssueNotes(event.target.value)}
                placeholder="Optional handover reference or notes"
              />
            </FieldWrapper>
            <Button loading={saving} onClick={() => void issueVehicle()}>
              <KeyRound className="h-4 w-4" /> Record vehicle issue
            </Button>
          </CardContent>
        </Card>
      )}

      {data.issueId && data.tripIssuedAt && data.tripStatus === 'pending' && !canStart && (
        <div className="bg-status-pending-bg text-status-pending-text rounded-[8px] px-4 py-3 text-sm">
          Vehicle issue is recorded, but departure is not currently permitted. Check request,
          authority, vehicle, licence and safety readiness before starting the trip.
        </div>
      )}

      {canStart && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-4 w-4" /> Start external-driver trip
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-status-warning-bg text-status-warning-text rounded-[8px] px-4 py-3 text-sm">
              Use this only when Transport Office has confirmed the vehicle is physically issued,
              the external driver is present and accepted, and the actual passenger manifest is
              correct. Starting changes the trip, authority, request and vehicle to active states.
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <FieldWrapper label="Beginning odometer" required>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={startOdometer}
                  onChange={(event) => setStartOdometer(event.target.value)}
                />
              </FieldWrapper>
              <FieldWrapper label="Fuel level" required>
                <Input
                  value={fuelLevel}
                  onChange={(event) => setFuelLevel(event.target.value)}
                  placeholder="e.g. 3/4 or 75%"
                />
              </FieldWrapper>
              <FieldWrapper label="Actual passengers confirmed" required>
                <StyledSelect
                  value={passengersConfirmed}
                  onChange={(event) => setPassengersConfirmed(event.target.value)}
                >
                  <option value="no">Not yet</option>
                  <option value="yes">Yes, confirmed</option>
                </StyledSelect>
              </FieldWrapper>
            </div>
            <Button loading={saving} onClick={() => void startTrip()}>
              <Play className="h-4 w-4" /> Start trip
            </Button>
          </CardContent>
        </Card>
      )}

      {data.tripStatus === 'in_progress' && (
        <div className="bg-status-success-bg text-status-success-text rounded-[8px] px-4 py-3 text-sm">
          This external-driver trip is in progress. Operational events remain attached to the same
          tenant-scoped trip and external assignment audit trail.
        </div>
      )}

      {data.state === 'cancelled' && data.cancellationReason && (
        <div className="bg-status-warning-bg text-status-warning-text rounded-[8px] px-4 py-3 text-sm">
          Cancelled: {data.cancellationReason}. Transport Office should allocate another driver.
        </div>
      )}
    </div>
  );
}
