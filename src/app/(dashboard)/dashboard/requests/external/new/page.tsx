'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, CarFront, ExternalLink, UserRound } from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FieldWrapper, Input, Textarea } from '@/components/ui/input';
import { StyledDateInput, StyledSelect } from '@/components/ui/styled-select';
import { EmployeeCombobox, type EmployeeSearchOption } from '@/components/ui/employee-combobox';
import { PlacesAutocomplete } from '@/components/map/places-autocomplete';
import { useToast } from '@/lib/use-toast';

type ExternalParty = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  organisationName: string;
  email?: string | null;
  phone?: string | null;
  isDriverReady?: boolean;
  latestLicence?: { licenceClass?: string; expiryDate?: string } | null;
};

export default function ExternalTransportRequestPage() {
  const router = useRouter();
  const { toast } = useToast();
  const submissionId = useRef<string | null>(null);
  const [parties, setParties] = useState<ExternalParty[]>([]);
  const [driverOptions, setDriverOptions] = useState<ExternalParty[]>([]);
  const [existingRequesterId, setExistingRequesterId] = useState('');
  const [responsibleEmployee, setResponsibleEmployee] = useState<EmployeeSearchOption | null>(null);
  const [externalDriverId, setExternalDriverId] = useState('');
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    organisationName: '',
    organisationType: 'government',
    idReference: '',
    email: '',
    phone: '',
    purpose: '',
    scope: 'regional' as 'regional' | 'national',
    origin: '',
    destination: '',
    departureAt: '',
    returnAt: '',
    urgency: 'normal',
    specialRequirements: '',
    requesterTravels: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadParties = async () => {
    setLoading(true);
    setError('');
    try {
      const [allResponse, driversResponse] = await Promise.all([
        fetch('/api/external-parties?limit=100', { cache: 'no-store' }),
        fetch('/api/external-parties?driverReady=true&limit=100', { cache: 'no-store' }),
      ]);
      const allJson = await allResponse.json().catch(() => ({}));
      const driversJson = await driversResponse.json().catch(() => ({}));
      if (!allResponse.ok) throw new Error(allJson.error || 'Could not load external parties');
      if (!driversResponse.ok) throw new Error(driversJson.error || 'Could not load verified external drivers');
      setParties(Array.isArray(allJson.data) ? allJson.data : []);
      setDriverOptions(Array.isArray(driversJson.data) ? driversJson.data : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load external parties');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadParties();
  }, []);

  const selectedRequester = useMemo(
    () => parties.find((party) => party.id === existingRequesterId) ?? null,
    [existingRequesterId, parties],
  );

  async function ensureRequester() {
    if (existingRequesterId) return existingRequesterId;
    if (!form.firstName.trim() || !form.lastName.trim() || !form.organisationName.trim()) {
      throw new Error('Select an existing external requester or enter their name and organisation.');
    }
    const response = await fetch('/api/external-parties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: form.firstName,
        lastName: form.lastName,
        organisationName: form.organisationName,
        organisationType: form.organisationType,
        idReference: form.idReference,
        email: form.email,
        phone: form.phone,
      }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || 'External requester could not be saved');
    return String(json.data.id);
  }

  async function submit() {
    if (!responsibleEmployee) {
      setError('Select the internal employee responsible for routing and following up this external request.');
      return;
    }
    if (!form.purpose.trim() || !form.origin.trim() || !form.destination.trim()) {
      setError('Purpose, origin and destination are required.');
      return;
    }
    if (!form.departureAt || !form.returnAt) {
      setError('Departure and return date/time are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const requesterId = await ensureRequester();
      if (!submissionId.current) submissionId.current = crypto.randomUUID();
      const response = await fetch('/api/transport-requests/external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          externalRequesterId: requesterId,
          responsibleEmployeeId: responsibleEmployee.id,
          purpose: form.purpose,
          scope: form.scope,
          origin: form.origin,
          destination: form.destination,
          departureAt: form.departureAt,
          returnAt: form.returnAt,
          urgency: form.urgency,
          overnight: false,
          specialRequirements: form.specialRequirements,
          externalDriverId: externalDriverId || undefined,
          requesterTravels: form.requesterTravels,
          clientSubmissionId: submissionId.current,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'External request could not be submitted');
      toast({
        title: 'External request submitted',
        description: `${json.request.reference} entered the normal approval workflow.`,
        variant: 'success',
      });
      router.push(`/dashboard/requests/${json.request.id}`);
      router.refresh();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'External request could not be submitted';
      setError(message);
      toast({ title: 'Submission failed', description: message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Requests', href: '/dashboard/requests' },
          { label: 'External Request' },
        ]}
      />
      <PageHeader
        title="External Transport Request"
        description="Record a request for a person from another organisation without adding them to the tenant staff directory."
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/drivers/external">
            <CarFront className="h-4 w-4" /> External drivers
          </Link>
        </Button>
      </PageHeader>

      <div className="bg-status-info-bg text-status-info-text rounded-[8px] px-4 py-3 text-sm">
        External people remain separate from Staff Management. An internal responsible employee is required only to anchor the existing tenant approval route and operational follow-up.
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" /> External requester</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldWrapper label="Existing external party" description="Reuse a previously recorded person when available.">
                <StyledSelect
                  value={existingRequesterId}
                  onChange={(event) => setExistingRequesterId(event.target.value)}
                  placeholder={loading ? 'Loading external parties…' : 'Create a new external requester'}
                  disabled={loading}
                >
                  <option value="">Create a new external requester</option>
                  {parties.map((party) => (
                    <option key={party.id} value={party.id}>{party.fullName} · {party.organisationName}</option>
                  ))}
                </StyledSelect>
              </FieldWrapper>

              {selectedRequester ? (
                <div className="border-border bg-muted/30 rounded-[8px] border p-4 text-sm">
                  <p className="text-ink-950 font-medium">{selectedRequester.fullName}</p>
                  <p className="text-ink-500 mt-1">{selectedRequester.organisationName}</p>
                  {(selectedRequester.email || selectedRequester.phone) && (
                    <p className="text-ink-500 mt-1 text-xs">{[selectedRequester.email, selectedRequester.phone].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldWrapper label="First name" required><Input value={form.firstName} onChange={(e) => setForm((s) => ({ ...s, firstName: e.target.value }))} /></FieldWrapper>
                  <FieldWrapper label="Last name" required><Input value={form.lastName} onChange={(e) => setForm((s) => ({ ...s, lastName: e.target.value }))} /></FieldWrapper>
                  <FieldWrapper label="Organisation" required className="sm:col-span-2"><Input value={form.organisationName} onChange={(e) => setForm((s) => ({ ...s, organisationName: e.target.value }))} placeholder="Ministry, municipality, contractor or partner" /></FieldWrapper>
                  <FieldWrapper label="Organisation type">
                    <StyledSelect value={form.organisationType} onChange={(e) => setForm((s) => ({ ...s, organisationType: e.target.value }))}>
                      <option value="government">Government institution</option>
                      <option value="municipality">Municipality / council</option>
                      <option value="contractor">Contractor</option>
                      <option value="partner">Partner organisation</option>
                      <option value="other">Other</option>
                    </StyledSelect>
                  </FieldWrapper>
                  <FieldWrapper label="ID / passport reference"><Input value={form.idReference} onChange={(e) => setForm((s) => ({ ...s, idReference: e.target.value }))} /></FieldWrapper>
                  <FieldWrapper label="Email"><Input type="email" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} /></FieldWrapper>
                  <FieldWrapper label="Phone"><Input value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} /></FieldWrapper>
                </div>
              )}

              <FieldWrapper
                label="Responsible internal employee"
                required
                description="This employee supplies the tenant region/office/department used by the existing approval route. The external requester remains the named requester."
              >
                <EmployeeCombobox
                  kind="employee"
                  value={responsibleEmployee?.id || ''}
                  selectedOption={responsibleEmployee}
                  onSelect={setResponsibleEmployee}
                  placeholder="Search responsible employee"
                />
              </FieldWrapper>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Journey</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FieldWrapper label="Purpose" required><Textarea rows={4} value={form.purpose} onChange={(e) => setForm((s) => ({ ...s, purpose: e.target.value }))} /></FieldWrapper>
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Scope" required>
                  <StyledSelect value={form.scope} onChange={(e) => setForm((s) => ({ ...s, scope: e.target.value === 'national' ? 'national' : 'regional' }))}>
                    <option value="regional">Regional</option>
                    <option value="national">National</option>
                  </StyledSelect>
                </FieldWrapper>
                <FieldWrapper label="Urgency">
                  <StyledSelect value={form.urgency} onChange={(e) => setForm((s) => ({ ...s, urgency: e.target.value }))}>
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgent</option>
                    <option value="emergency">Emergency</option>
                  </StyledSelect>
                </FieldWrapper>
                <FieldWrapper label="Departure" required><StyledDateInput type="datetime-local" value={form.departureAt} onChange={(e) => setForm((s) => ({ ...s, departureAt: e.target.value }))} /></FieldWrapper>
                <FieldWrapper label="Return" required><StyledDateInput type="datetime-local" value={form.returnAt} onChange={(e) => setForm((s) => ({ ...s, returnAt: e.target.value }))} /></FieldWrapper>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Origin" required>
                  <PlacesAutocomplete value={form.origin} onTextChange={(origin) => setForm((s) => ({ ...s, origin }))} onSelect={(place) => setForm((s) => ({ ...s, origin: place.name }))} placeholder="Select origin" ariaLabel="External request origin" />
                </FieldWrapper>
                <FieldWrapper label="Destination" required>
                  <PlacesAutocomplete value={form.destination} onTextChange={(destination) => setForm((s) => ({ ...s, destination }))} onSelect={(place) => setForm((s) => ({ ...s, destination: place.name }))} placeholder="Select destination" ariaLabel="External request destination" />
                </FieldWrapper>
              </div>
              <FieldWrapper label="Special requirements"><Textarea rows={3} value={form.specialRequirements} onChange={(e) => setForm((s) => ({ ...s, specialRequirements: e.target.value }))} /></FieldWrapper>
              <label className="text-ink-700 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.requesterTravels} onChange={(e) => setForm((s) => ({ ...s, requesterTravels: e.target.checked }))} />
                External requester is travelling as a passenger
              </label>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><UserRound className="h-4 w-4" /> Driver preference</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <FieldWrapper
                label="Verified external driver (optional)"
                description="Only external drivers whose licence evidence has been explicitly verified by Transport Administration are selectable. Final allocation will recheck compliance."
              >
                <StyledSelect value={externalDriverId} onChange={(e) => setExternalDriverId(e.target.value)} placeholder="Transport Administration will assign driver">
                  <option value="">Transport Administration will assign driver</option>
                  {driverOptions.map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.fullName} · {driver.organisationName}{driver.latestLicence?.licenceClass ? ` · ${driver.latestLicence.licenceClass}` : ''}
                    </option>
                  ))}
                </StyledSelect>
              </FieldWrapper>
              <p className="text-ink-500 text-xs">Need to add or verify an external driver's licence first?</p>
              <Button variant="secondary" size="sm" asChild>
                <Link href="/dashboard/drivers/external"><ExternalLink className="h-4 w-4" /> Manage external drivers</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Submission boundary</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-ink-600">
              <p>• The external requester is stored outside the employee/staff directory.</p>
              <p>• This request enters the same configured approval workflow as internal requests.</p>
              <p>• Nominating an external driver does not allocate or authorise them automatically.</p>
              <p>• Licence verification is separate from final vehicle/driver allocation.</p>
            </CardContent>
          </Card>

          {error && <div className="bg-status-error-bg text-status-error-text rounded-[8px] px-4 py-3 text-sm" role="alert">{error}</div>}
          <div className="flex flex-wrap justify-start gap-2">
            <Button variant="secondary" asChild><Link href="/dashboard/requests">Cancel</Link></Button>
            <Button loading={saving} disabled={loading} onClick={() => void submit()}>Submit external request</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
