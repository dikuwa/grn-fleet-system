'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, FileCheck2, Plus, RefreshCw, ShieldCheck, Upload } from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldWrapper, Input, Textarea } from '@/components/ui/input';
import { StyledDateInput, StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';

type Party = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  organisationName: string;
  latestLicence?: {
    id: string;
    licenceClass: string;
    expiryDate: string;
    verificationStatus: string;
  } | null;
  isDriverReady?: boolean;
};

type Licence = {
  id: string;
  version: number;
  licenceNumber: string;
  licenceClass: string;
  issueDate?: string | null;
  expiryDate: string;
  verificationStatus: string;
  reviewNotes?: string | null;
  frontUrl?: string | null;
  backUrl?: string | null;
};

const badgeVariant = (status: string): 'success' | 'pending' | 'error' | 'info' => {
  if (status === 'verified') return 'success';
  if (status === 'rejected') return 'error';
  if (status === 'needs_correction') return 'info';
  return 'pending';
};

export default function ExternalDriversPage() {
  const { toast } = useToast();
  const [parties, setParties] = useState<Party[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState('');
  const [licences, setLicences] = useState<Licence[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [reviewReason, setReviewReason] = useState('');
  const [partyForm, setPartyForm] = useState({ firstName: '', lastName: '', organisationName: '', phone: '', email: '' });
  const [licenceForm, setLicenceForm] = useState({ licenceNumber: '', licenceClass: '', issueDate: '', expiryDate: '' });
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);

  const selectedParty = useMemo(
    () => parties.find((party) => party.id === selectedPartyId) ?? null,
    [parties, selectedPartyId],
  );

  async function loadParties(preferredId?: string) {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/external-parties?limit=100', { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Could not load external parties');
      const rows = Array.isArray(json.data) ? json.data : [];
      setParties(rows);
      const next = preferredId || selectedPartyId || rows[0]?.id || '';
      setSelectedPartyId(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load external parties');
    } finally {
      setLoading(false);
    }
  }

  async function loadLicences(partyId: string) {
    if (!partyId) {
      setLicences([]);
      return;
    }
    try {
      const response = await fetch(`/api/external-parties/${partyId}/licences`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Could not load licence evidence');
      setLicences(Array.isArray(json.data) ? json.data : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load licence evidence');
    }
  }

  useEffect(() => {
    void loadParties();
  }, []);

  useEffect(() => {
    void loadLicences(selectedPartyId);
  }, [selectedPartyId]);

  async function createParty() {
    if (!partyForm.firstName.trim() || !partyForm.lastName.trim() || !partyForm.organisationName.trim()) {
      setError('First name, last name and organisation are required.');
      return;
    }
    setWorking(true);
    setError('');
    try {
      const response = await fetch('/api/external-parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partyForm),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'External driver could not be created');
      setPartyForm({ firstName: '', lastName: '', organisationName: '', phone: '', email: '' });
      await loadParties(json.data.id);
      toast({ title: 'External party created', description: 'Licence evidence can now be uploaded for review.', variant: 'success' });
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'External driver could not be created';
      setError(message);
      toast({ title: 'Create failed', description: message, variant: 'error' });
    } finally {
      setWorking(false);
    }
  }

  async function uploadLicence() {
    if (!selectedPartyId || !front || !back || !licenceForm.licenceNumber.trim() || !licenceForm.licenceClass.trim() || !licenceForm.expiryDate) {
      setError('Select an external party and provide licence number, class, expiry date, front and back evidence.');
      return;
    }
    const data = new FormData();
    data.set('licenceNumber', licenceForm.licenceNumber);
    data.set('licenceClass', licenceForm.licenceClass);
    data.set('issueDate', licenceForm.issueDate);
    data.set('expiryDate', licenceForm.expiryDate);
    data.set('front', front);
    data.set('back', back);
    setWorking(true);
    setError('');
    try {
      const response = await fetch(`/api/external-parties/${selectedPartyId}/licences`, { method: 'POST', body: data });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Licence evidence could not be uploaded');
      setLicenceForm({ licenceNumber: '', licenceClass: '', issueDate: '', expiryDate: '' });
      setFront(null);
      setBack(null);
      const frontInput = document.getElementById('external-licence-front') as HTMLInputElement | null;
      const backInput = document.getElementById('external-licence-back') as HTMLInputElement | null;
      if (frontInput) frontInput.value = '';
      if (backInput) backInput.value = '';
      await Promise.all([loadLicences(selectedPartyId), loadParties(selectedPartyId)]);
      toast({ title: 'Evidence uploaded', description: 'The licence remains provisional until Transport Administration verifies it.', variant: 'success' });
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Licence evidence could not be uploaded';
      setError(message);
      toast({ title: 'Upload failed', description: message, variant: 'error' });
    } finally {
      setWorking(false);
    }
  }

  async function review(licenceId: string, action: 'verify' | 'reject' | 'request_upload') {
    const reason = reviewReason.trim();
    if (action !== 'verify' && reason.length < 5) {
      setError('Enter a review note of at least 5 characters before rejecting or requesting a new upload.');
      return;
    }
    setWorking(true);
    setError('');
    try {
      const response = await fetch(`/api/external-parties/licences/${licenceId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Licence review could not be saved');
      setReviewReason('');
      await Promise.all([loadLicences(selectedPartyId), loadParties(selectedPartyId)]);
      toast({ title: action === 'verify' ? 'Licence verified' : 'Review saved', description: action === 'verify' ? 'The external driver is now eligible for nomination subject to final allocation checks.' : 'The licence remains unavailable for assignment.', variant: 'success' });
    } catch (reviewError) {
      const message = reviewError instanceof Error ? reviewError.message : 'Licence review could not be saved';
      setError(message);
      toast({ title: 'Review failed', description: message, variant: 'error' });
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Drivers', href: '/dashboard/drivers' }, { label: 'External Drivers' }]} />
      <PageHeader title="External Drivers" description="Maintain external transport identities and verify licence evidence without creating staff records.">
        <Button variant="secondary" size="sm" onClick={() => void loadParties(selectedPartyId)} loading={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>
        <Button size="sm" asChild><Link href="/dashboard/requests/external/new"><Plus className="h-4 w-4" /> External request</Link></Button>
      </PageHeader>

      <div className="bg-status-info-bg text-status-info-text rounded-[8px] px-4 py-3 text-sm">
        Verification here only confirms the external driver's licence evidence. It does not allocate a vehicle, assign a trip, create a user account, or add the person to Staff Management.
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>External party register</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FieldWrapper label="Select external party">
                <StyledSelect value={selectedPartyId} onChange={(event) => setSelectedPartyId(event.target.value)} placeholder={loading ? 'Loading…' : 'Select external party'} disabled={loading}>
                  <option value="">Select external party</option>
                  {parties.map((party) => (
                    <option key={party.id} value={party.id}>{party.fullName} · {party.organisationName}{party.isDriverReady ? ' · verified driver' : ''}</option>
                  ))}
                </StyledSelect>
              </FieldWrapper>
              {selectedParty && (
                <div className="border-border rounded-[8px] border p-3 text-sm">
                  <p className="text-ink-950 font-medium">{selectedParty.fullName}</p>
                  <p className="text-ink-500">{selectedParty.organisationName}</p>
                  <div className="mt-2">
                    {selectedParty.latestLicence ? (
                      <Badge variant={badgeVariant(selectedParty.latestLicence.verificationStatus)}>{selectedParty.latestLicence.verificationStatus.replaceAll('_', ' ')}</Badge>
                    ) : (
                      <Badge variant="pending">No licence evidence</Badge>
                    )}
                  </div>
                </div>
              )}
              <div className="border-border border-t pt-4">
                <p className="text-ink-950 mb-3 text-sm font-semibold">Add external party</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FieldWrapper label="First name" required><Input value={partyForm.firstName} onChange={(e) => setPartyForm((s) => ({ ...s, firstName: e.target.value }))} /></FieldWrapper>
                  <FieldWrapper label="Last name" required><Input value={partyForm.lastName} onChange={(e) => setPartyForm((s) => ({ ...s, lastName: e.target.value }))} /></FieldWrapper>
                  <FieldWrapper label="Organisation" required className="sm:col-span-2"><Input value={partyForm.organisationName} onChange={(e) => setPartyForm((s) => ({ ...s, organisationName: e.target.value }))} /></FieldWrapper>
                  <FieldWrapper label="Email"><Input type="email" value={partyForm.email} onChange={(e) => setPartyForm((s) => ({ ...s, email: e.target.value }))} /></FieldWrapper>
                  <FieldWrapper label="Phone"><Input value={partyForm.phone} onChange={(e) => setPartyForm((s) => ({ ...s, phone: e.target.value }))} /></FieldWrapper>
                </div>
                <Button className="mt-3" variant="secondary" size="sm" loading={working} onClick={() => void createParty()}><Plus className="h-4 w-4" /> Add external party</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Upload className="h-4 w-4" /> Upload licence evidence</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldWrapper label="Licence number" required><Input disabled={!selectedPartyId} value={licenceForm.licenceNumber} onChange={(e) => setLicenceForm((s) => ({ ...s, licenceNumber: e.target.value }))} /></FieldWrapper>
                <FieldWrapper label="Licence class" required><Input disabled={!selectedPartyId} value={licenceForm.licenceClass} onChange={(e) => setLicenceForm((s) => ({ ...s, licenceClass: e.target.value }))} placeholder="e.g. C1" /></FieldWrapper>
                <FieldWrapper label="Issue date"><StyledDateInput type="date" disabled={!selectedPartyId} value={licenceForm.issueDate} onChange={(e) => setLicenceForm((s) => ({ ...s, issueDate: e.target.value }))} /></FieldWrapper>
                <FieldWrapper label="Expiry date" required><StyledDateInput type="date" disabled={!selectedPartyId} value={licenceForm.expiryDate} onChange={(e) => setLicenceForm((s) => ({ ...s, expiryDate: e.target.value }))} /></FieldWrapper>
                <FieldWrapper label="Front evidence" required><Input id="external-licence-front" type="file" disabled={!selectedPartyId} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFront(e.target.files?.[0] || null)} /></FieldWrapper>
                <FieldWrapper label="Back evidence" required><Input id="external-licence-back" type="file" disabled={!selectedPartyId} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setBack(e.target.files?.[0] || null)} /></FieldWrapper>
              </div>
              <p className="text-ink-500 text-xs">JPEG, PNG, WebP or PDF · maximum 12 MB per side. Uploads remain provisional until explicit review.</p>
              <Button disabled={!selectedPartyId} loading={working} onClick={() => void uploadLicence()}><Upload className="h-4 w-4" /> Upload for review</Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Licence review history</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!selectedPartyId ? (
              <p className="text-ink-500 text-sm">Select an external party to review licence evidence.</p>
            ) : licences.length === 0 ? (
              <p className="text-ink-500 text-sm">No licence evidence has been uploaded for this external party.</p>
            ) : (
              <>
                <FieldWrapper label="Review note" description="Required when rejecting evidence or requesting another upload.">
                  <Textarea rows={3} value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} placeholder="Explain the correction or rejection reason" />
                </FieldWrapper>
                <div className="space-y-3">
                  {licences.map((licence) => {
                    const reviewable = ['awaiting_review', 'needs_correction'].includes(licence.verificationStatus);
                    return (
                      <div key={licence.id} className="border-border rounded-[10px] border p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-ink-950 text-sm font-semibold">Version {licence.version} · {licence.licenceClass}</p>
                            <p className="text-ink-500 mt-1 text-xs">Licence {licence.licenceNumber} · expires {licence.expiryDate}</p>
                          </div>
                          <Badge variant={badgeVariant(licence.verificationStatus)}>{licence.verificationStatus.replaceAll('_', ' ')}</Badge>
                        </div>
                        {licence.reviewNotes && <p className="bg-muted/40 text-ink-600 mt-3 rounded-[8px] px-3 py-2 text-xs">{licence.reviewNotes}</p>}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {licence.frontUrl && <Button variant="secondary" size="sm" asChild><a href={licence.frontUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Front</a></Button>}
                          {licence.backUrl && <Button variant="secondary" size="sm" asChild><a href={licence.backUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Back</a></Button>}
                        </div>
                        {reviewable && (
                          <div className="border-border mt-4 flex flex-wrap gap-2 border-t pt-3">
                            <Button size="sm" loading={working} onClick={() => void review(licence.id, 'verify')}><FileCheck2 className="h-4 w-4" /> Verify</Button>
                            <Button variant="secondary" size="sm" disabled={working} onClick={() => void review(licence.id, 'request_upload')}>Request new upload</Button>
                            <Button variant="destructive" size="sm" disabled={working} onClick={() => void review(licence.id, 'reject')}>Reject</Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {error && <div className="bg-status-error-bg text-status-error-text rounded-[8px] px-4 py-3 text-sm" role="alert">{error}</div>}
    </div>
  );
}
