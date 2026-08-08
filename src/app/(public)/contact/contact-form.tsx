/**
 * ContactForm — client component.
 *
 * Generic contact enquiries are persisted to /api/public/enquiries
 * (cms_enquiries table) so Platform Admin can review and respond. Demo
 * requests live on their own /request-demo flow.
 */

'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';

const inputCls =
  'h-11 w-full rounded-[8px] border border-border bg-canvas px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600';
const labelCls = 'block text-xs font-medium text-ink-500 mb-1';

export function ContactForm() {
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
      email: String(form.get('email') ?? ''),
      phone: String(form.get('phone') ?? ''),
      subject: String(form.get('subject') ?? ''),
      message: String(form.get('message') ?? ''),
    };

    try {
      const res = await fetch('/api/public/enquiries', {
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
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-status-success-bg text-status-success-text">
          <Send className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 className="mt-5 text-xl font-[650] tracking-tight text-ink-950">
          Thank you for your message
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-500">
          We have received your enquiry and will get back to you shortly.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[12px] border border-border bg-surface p-6 md:p-8"
    >
      <h2 className="text-base font-semibold text-ink-950">Send a Message</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-name" className={labelCls}>
            Name *
          </label>
          <input
            id="contact-name"
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
          <label htmlFor="contact-email" className={labelCls}>
            Email *
          </label>
          <input
            id="contact-email"
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
          <label htmlFor="contact-phone" className={labelCls}>
            Phone <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <input
            id="contact-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            maxLength={40}
            className={inputCls}
            placeholder="+264 61 123 4567"
          />
        </div>
        <div>
          <label htmlFor="contact-subject" className={labelCls}>
            Subject *
          </label>
          <input
            id="contact-subject"
            name="subject"
            type="text"
            required
            maxLength={200}
            className={inputCls}
            placeholder="How can we help?"
          />
        </div>
      </div>
      <div className="mt-4">
        <label htmlFor="contact-message" className={labelCls}>
          Message *
        </label>
        <textarea
          id="contact-message"
          name="message"
          rows={6}
          required
          maxLength={5000}
          className="w-full rounded-[8px] border border-border bg-canvas px-3 py-2 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none"
          placeholder="Your message..."
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
        {isSubmitting ? 'Sending…' : 'Send Message'}
        <Send className="h-4 w-4" aria-hidden="true" />
      </button>
    </form>
  );
}
