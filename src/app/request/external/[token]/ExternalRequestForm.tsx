'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type LinkInfo = {
  tenantName: string;
  label: string | null;
  tripScope: string;
  expiresAt: string;
  remainingSubmissions: number;
  sponsor: { firstName: string; lastName: string; office: string | null };
};

type FormState = {
  firstName: string;
  lastName: string;
  organisationName: string;
  organisationType: string;
  email: string;
  phone: string;
  idReference: string;
  purpose: string;
  origin: string;
  destination: string;
  departureAt: string;
  returnAt: string;
  urgency: string;
  overnight: boolean;
  specialRequirements: string;
  requesterTravels: boolean;
};

const INITIAL_FORM: FormState = {
  firstName: '',
  lastName: '',
  organisationName: '',
  organisationType: 'other',
  email: '',
  phone: '',
  idReference: '',
  purpose: '',
  origin: '',
  destination: '',
  departureAt: '',
  returnAt: '',
  urgency: 'normal',
  overnight: false,
  specialRequirements: '',
  requesterTravels: true,
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-ink-800">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-ink-500">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  'h-11 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20';
const textareaClass =
  'w-full rounded-[8px] border border-border bg-surface px-3 py-2.5 text-sm text-ink-950 outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20';

export function ExternalRequestForm({ token }: { token: string }) {
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{ reference: string; trackingUrl: string } | null>(null);
  const clientSubmissionId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/external-request/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (response) => {
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json.error || 'This external request link is unavailable.');
        return json;
      })
      .then((json) => {
        if (!cancelled) setInfo(json.data);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'This external request link is unavailable.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const patch = (values: Partial<FormState>) => setForm((current) => ({ ...current, ...values }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`/api/public/external-request/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, clientSubmissionId }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Your request could not be submitted.');
      setResult({ reference: json.request.reference, trackingUrl: json.trackingUrl });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Your request could not be submitted.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="rounded-[10px] border border-border bg-surface p-8 text-sm text-ink-500">Validating secure request link…</div>;
  }
  if (loadError || !info) {
    return (
      <div className="rounded-[10px] border border-border bg-surface p-6 sm:p-8">
        <h1 className="text-xl font-semibold text-ink-950">External request link unavailable</h1>
        <p className="mt-2 text-sm text-ink-500">{loadError || 'This link can no longer be used.'}</p>
        <Link href="/" className="mt-5 inline-flex text-sm font-medium text-brand-700 hover:underline">Return to home</Link>
      </div>
    );
  }
  if (result) {
    return (
      <div className="rounded-[10px] border border-border bg-surface p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Request received</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink-950">Your transport request was submitted</h1>
        <p className="mt-3 text-sm text-ink-600">
          Reference <strong className="text-ink-950">{result.reference}</strong>. The request has entered {info.tenantName}&apos;s normal approval workflow.
        </p>
        <a href={result.trackingUrl} className="mt-6 inline-flex h-10 items-center rounded-[8px] bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800">
          Track request
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[10px] border border-border bg-surface p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">{info.tenantName}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-950">External transport request</h1>
            <p className="mt-2 max-w-2xl text-sm text-ink-500">
              This secure link was issued for an external requester. It does not create a staff account and does not provide access to internal fleet, driver or approval information.
            </p>
          </div>
          <span className="w-fit rounded-full border border-border bg-canvas px-3 py-1 text-xs font-medium capitalize text-ink-700">{info.tripScope} trip</span>
        </div>
        <div className="mt-4 grid gap-3 rounded-[8px] bg-canvas p-4 text-sm sm:grid-cols-2">
          <div><span className="text-ink-500">Internal sponsor</span><p className="font-medium text-ink-950">{info.sponsor.firstName} {info.sponsor.lastName}</p></div>
          <div><span className="text-ink-500">Sponsoring office</span><p className="font-medium text-ink-950">{info.sponsor.office || 'Organisation office'}</p></div>
          {info.label ? <div className="sm:col-span-2"><span className="text-ink-500">Link purpose</span><p className="font-medium text-ink-950">{info.label}</p></div> : null}
        </div>
      </section>

      <form onSubmit={submit} className="space-y-5">
        <section className="rounded-[10px] border border-border bg-surface p-5 sm:p-6">
          <h2 className="text-base font-semibold text-ink-950">Requester details</h2>
          <p className="mt-1 text-sm text-ink-500">Identify the external person and organisation making this request.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="First name *"><input required className={inputClass} value={form.firstName} onChange={(e) => patch({ firstName: e.target.value })} /></Field>
            <Field label="Last name *"><input required className={inputClass} value={form.lastName} onChange={(e) => patch({ lastName: e.target.value })} /></Field>
            <Field label="Organisation *"><input required className={inputClass} value={form.organisationName} onChange={(e) => patch({ organisationName: e.target.value })} /></Field>
            <Field label="Organisation type">
              <select className={inputClass} value={form.organisationType} onChange={(e) => patch({ organisationType: e.target.value })}>
                <option value="government">Government institution</option><option value="municipality">Municipality / council</option><option value="contractor">Contractor</option><option value="ngo">NGO / community organisation</option><option value="private">Private organisation</option><option value="other">Other</option>
              </select>
            </Field>
            <Field label="Email" hint="Provide email or phone so the organisation can contact you."><input type="email" className={inputClass} value={form.email} onChange={(e) => patch({ email: e.target.value })} /></Field>
            <Field label="Phone"><input className={inputClass} value={form.phone} onChange={(e) => patch({ phone: e.target.value })} /></Field>
            <Field label="ID / reference number" hint="Optional reference used by your organisation."><input className={inputClass} value={form.idReference} onChange={(e) => patch({ idReference: e.target.value })} /></Field>
          </div>
        </section>

        <section className="rounded-[10px] border border-border bg-surface p-5 sm:p-6">
          <h2 className="text-base font-semibold text-ink-950">Trip details</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label="Purpose / reason for travel *"><textarea required rows={3} className={textareaClass} value={form.purpose} onChange={(e) => patch({ purpose: e.target.value })} /></Field></div>
            <Field label="Origin *"><input required className={inputClass} value={form.origin} onChange={(e) => patch({ origin: e.target.value })} /></Field>
            <Field label="Destination *"><input required className={inputClass} value={form.destination} onChange={(e) => patch({ destination: e.target.value })} /></Field>
            <Field label="Departure *"><input required type="datetime-local" className={inputClass} value={form.departureAt} onChange={(e) => patch({ departureAt: e.target.value })} /></Field>
            <Field label="Return *"><input required type="datetime-local" className={inputClass} value={form.returnAt} onChange={(e) => patch({ returnAt: e.target.value })} /></Field>
            <Field label="Urgency"><select className={inputClass} value={form.urgency} onChange={(e) => patch({ urgency: e.target.value })}><option value="normal">Normal</option><option value="urgent">Urgent</option></select></Field>
            <div className="flex flex-col justify-end gap-3 pb-1">
              <label className="flex items-center gap-2 text-sm text-ink-800"><input type="checkbox" checked={form.overnight} onChange={(e) => patch({ overnight: e.target.checked })} /> Overnight travel</label>
              <label className="flex items-center gap-2 text-sm text-ink-800"><input type="checkbox" checked={form.requesterTravels} onChange={(e) => patch({ requesterTravels: e.target.checked })} /> I will travel on this request</label>
            </div>
            <div className="sm:col-span-2"><Field label="Special requirements"><textarea rows={3} className={textareaClass} value={form.specialRequirements} onChange={(e) => patch({ specialRequirements: e.target.value })} placeholder="Accessibility, cargo, timing or other relevant requirements" /></Field></div>
          </div>
        </section>

        {submitError ? <div role="alert" className="rounded-[8px] border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800">{submitError}</div> : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-500">Submitting does not guarantee approval or vehicle availability. Internal routing remains controlled by {info.tenantName}.</p>
          <button type="submit" disabled={submitting} className="h-11 shrink-0 rounded-[8px] bg-brand-700 px-5 text-sm font-medium text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60">
            {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </form>
    </div>
  );
}
