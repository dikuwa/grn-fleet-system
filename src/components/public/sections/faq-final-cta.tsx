/**
 * FAQ section + final conversion CTA.
 *
 * FAQ items come from the CMS `cms_faqs` table (via getPublishedFaqs) and
 * are editable by Platform Admin. The final CTA is the primary prospect
 * conversion point.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ArrowRight } from 'lucide-react';
import { SectionContainer, SectionHeading } from '@/components/public/section';
import { REQUEST_DEMO_HREF } from '@/components/public/nav';
import type { PublicFaq } from '@/lib/platform/cms-public';

export interface FaqSectionProps {
  faqs?: PublicFaq[];
  heading?: string;
  subheading?: string;
}

export function FaqSection({
  faqs = [],
  heading = 'Frequently Asked Questions',
  subheading = 'Answers to the questions prospective organisations ask most.',
}: FaqSectionProps) {
  if (!faqs.length) return null;

  return (
    <section className="border-b border-border bg-canvas py-20 md:py-24">
      <SectionContainer>
        <SectionHeading title={heading} subtitle={subheading} />
        <div className="mx-auto mt-12 max-w-3xl space-y-3">
          {faqs.map((faq) => (
            <FaqItem key={faq.id} question={faq.question} answer={faq.answer} />
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link
            href="/faq"
            className="text-sm font-medium text-brand-700 underline-offset-4 transition-colors hover:underline dark:text-brand-400"
          >
            View all FAQs →
          </Link>
        </div>
      </SectionContainer>
    </section>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="group rounded-[10px] border border-border bg-surface"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <h3 className="text-sm font-medium text-ink-950">{question}</h3>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-ink-400 transition-transform group-open:rotate-180 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </summary>
      <div className="px-5 pb-5 text-sm leading-relaxed text-ink-500">{answer}</div>
    </details>
  );
}

export interface FinalCtaProps {
  heading?: string;
  description?: string;
}

export function FinalCta({
  heading = 'Ready to transform your fleet operations?',
  description = 'See how GovFleet manages requests, approvals, vehicles, drivers and trip records in one accountable platform.',
}: FinalCtaProps) {
  return (
    <section className="bg-brand-950">
      <SectionContainer className="py-20 text-center md:py-24">
        <h2 className="mx-auto max-w-2xl text-3xl font-[650] tracking-tight text-white md:text-4xl">
          {heading}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/70">
          {description}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href={REQUEST_DEMO_HREF}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] bg-white px-6 text-sm font-semibold text-brand-950 transition-colors hover:bg-brand-50"
          >
            Request a Demo
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            href="/contact"
            className="inline-flex h-12 items-center justify-center rounded-[8px] border border-white/25 bg-white/5 px-6 text-sm font-medium text-white transition-colors hover:bg-white/15"
          >
            Contact the Team
          </Link>
        </div>
      </SectionContainer>
    </section>
  );
}
