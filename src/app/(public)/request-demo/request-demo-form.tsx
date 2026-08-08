/**
 * RequestDemoForm — client component.
 *
 * Fields follow the spec (Full Name, Organisation, Organisation Type, Email,
 * Phone, Approximate Fleet Size, Message). Submits to /api/demo-requests,
 * which persists the lead and blocks duplicate in-progress submissions from
 * the same email. Shows an intentional success state on completion.
 */

'use client';

import { useState } from 'react';
import { CheckCircle2, Send } from 'lucide-react';

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

const FLEET_SIZE_OPTIONS = [
  '1–10',
  '11–25',
  '26–50',
  '51–100',
  '101–250',
  '250+',
];

const inputCls =
  'h-11 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600';
const labelCls = 'block text-xs font-medium text-ink-500 mb-1';

export function RequestDemoForm() {
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

    try {
      const res = await fetch('/api/demo-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Submission failed. Please try again.');
      }
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
        <h2 className="mt-5 text-2xl font-[650] tracking-tight text-ink-950">
          Demo request received
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-500">
          Our team will review your organisation&apos;s requirements and contact you
          using the details provided.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[12px] border border-border bg-surface p-6 md:p-8"
      noValidate={false}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="demo-name" className={labelCls}>
            Full Name *
          </label>
          <input
            id="demo-name"
            name="name"
            type="text"
            required
            autoComplete="name"
            maxLength={120}
            className={inputCls}
            placeholder="Your name"
          />
        </div>
        <div>
          <label htmlFor="demo-organisation" className={labelCls}>
            Organisation *
          </label>
          <input
            id="demo-organisation"
            name="organisation"
            type="text"
            required
            autoComplete="organization"
            maxLength={160}
            className={inputCls}
            placeholder="Your organisation"
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="demo-org-type" className={labelCls}>
            Organisation Type *
          </label>
          <select id="demo-org-type" name="organisationType" required className={inputCls}>
            <option value="">Select an organisation type</option>
            {ORGANISATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="demo-email" className={labelCls}>
            Email *
          </label>
          <input
            id="demo-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            maxLength={254}
            className={inputCls}
            placeholder="you@organisation.na"
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="demo-phone" className={labelCls}>
            Phone <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <input
            id="demo-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            maxLength={40}
            className={inputCls}
            placeholder="+264 61 123 4567"
          />
        </div>
        <div>
          <label htmlFor="demo-fleet-size" className={labelCls}>
            Approximate Fleet Size
          </label>
          <select id="demo-fleet-size" name="fleetSize" className={inputCls}>
            <option value="">Select fleet size</option>
            {FLEET_SIZE_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f} vehicles
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="demo-message" className={labelCls}>
          Message / Operational Need
        </label>
        <textarea
          id="demo-message"
          name="message"
          rows={5}
          maxLength={5000}
          className="w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none"
          placeholder="Describe your current fleet challenges, how many vehicles you manage, and what you'd like to see in a demo."
        />
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-[8px] bg-status-error-bg px-3 py-2 text-sm text-status-error-text"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-[8px] bg-brand-800 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-700 dark:hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSubmitting ? 'Submitting…' : 'Request a Demo'}
        <Send className="h-4 w-4" aria-hidden="true" />
      </button>
    </form>
  );
}
