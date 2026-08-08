/**
 * RequestDemoForm — client component.
 *
 * Uses the same theme-aware form controls as the authenticated application so
 * native browser select styling never leaks into the public experience.
 */

'use client';

import { useState } from 'react';
import { CheckCircle2, Send } from 'lucide-react';
import { StyledSelect } from '@/components/ui/styled-select';

interface RequestDemoFormProps {
  successMessage?: string;
  expectedResponse?: string;
}

const DEFAULT_SUCCESS =
  'Demo request received. Our team will review your organisation’s requirements and contact you using the details provided.';
const DEFAULT_EXPECTED =
  'A member of our team will contact you to schedule a short walkthrough tailored to your organisation.';

const ORGANISATION_TYPES = [
  'Government Ministry',
  'Regional Council',
  'Municipality / Local Authority',
  'Public Enterprise',
  'Mining / Industrial',
  'Logistics Provider',
  'Private Organisation',
  'Other',
];
const FLEET_SIZE_OPTIONS = ['1–10', '11–25', '26–50', '51–100', '101–250', '250+'];

const inputCls =
  'h-11 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600';
const labelCls = 'mb-1 block text-xs font-medium text-ink-500';

export function RequestDemoForm({
  successMessage = DEFAULT_SUCCESS,
  expectedResponse = DEFAULT_EXPECTED,
}: RequestDemoFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const payload = {
      name: String(form.get('name') ?? ''),
      organisation: String(form.get('organisation') ?? ''),
      organisationType: String(form.get('organisationType') ?? ''),
      email: String(form.get('email') ?? ''),
      phone: String(form.get('phone') ?? ''),
      fleetSize: String(form.get('fleetSize') ?? ''),
      message: String(form.get('message') ?? ''),
      source: 'request_demo_page',
    };

    if (!payload.name || !payload.organisation || !payload.organisationType || !payload.email) {
      setError('Please complete the required fields before submitting.');
      setIsSubmitting(false);
      return;
    }

    try {
      const res = await fetch('/api/demo-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Submission failed. Please try again.');
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="rounded-[12px] border border-border bg-surface p-8 text-center md:p-12">
        <CheckCircle2 className="mx-auto h-12 w-12 text-status-success-text" aria-hidden="true" />
        <h2 className="mt-5 text-2xl font-[650] tracking-tight text-ink-950">Demo request received</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-500">{successMessage}</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-400">{expectedResponse}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-[12px] border border-border bg-surface p-6 md:p-8" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="demo-name" className={labelCls}>Full Name *</label>
          <input id="demo-name" name="name" type="text" required autoComplete="name" maxLength={120} className={inputCls} placeholder="Your name" />
        </div>
        <div>
          <label htmlFor="demo-organisation" className={labelCls}>Organisation *</label>
          <input id="demo-organisation" name="organisation" type="text" required autoComplete="organization" maxLength={160} className={inputCls} placeholder="Your organisation" />
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Organisation Type *</label>
          <StyledSelect name="organisationType" required placeholder="Select an organisation type" className="h-11">
            <option value="">Select an organisation type</option>
            {ORGANISATION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </StyledSelect>
        </div>
        <div>
          <label htmlFor="demo-email" className={labelCls}>Email *</label>
          <input id="demo-email" name="email" type="email" required autoComplete="email" maxLength={254} className={inputCls} placeholder="you@organisation.na" />
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="demo-phone" className={labelCls}>Phone <span className="font-normal text-ink-400">(optional)</span></label>
          <input id="demo-phone" name="phone" type="tel" autoComplete="tel" maxLength={40} className={inputCls} placeholder="+264 61 123 4567" />
        </div>
        <div>
          <label className={labelCls}>Approximate Fleet Size</label>
          <StyledSelect name="fleetSize" placeholder="Select fleet size" className="h-11">
            <option value="">Select fleet size</option>
            {FLEET_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size} vehicles</option>)}
          </StyledSelect>
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="demo-message" className={labelCls}>Message / Operational Need</label>
        <textarea
          id="demo-message"
          name="message"
          rows={5}
          maxLength={5000}
          className="w-full resize-none rounded-[8px] border border-border bg-surface px-3 py-2 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600"
          placeholder="Describe your current fleet challenges, how many vehicles you manage, and what you'd like to see in a demo."
        />
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-[8px] bg-status-error-bg px-3 py-2 text-sm text-status-error-text">{error}</p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-[8px] bg-brand-800 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-brand-600"
      >
        {isSubmitting ? 'Submitting…' : 'Request a Demo'}
        <Send className="h-4 w-4" aria-hidden="true" />
      </button>
    </form>
  );
}
