/**
 * Public CMS FAQ section component.
 *
 * Renders an accordion-style FAQ list grouped by category. Data comes from
 * the public `cmsFaqs` table via `/api/cms/faqs` or the server-side
 * `getPublishedFaqs()` service. Each category renders as a collapsible
 * section.
 */

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FaqItem {
  id: string;
  category: string;
  question: string;
  answer: string;
  sortOrder: number;
}

export interface FaqsSectionProps {
  faqs?: FaqItem[];
  heading?: string;
  subheading?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Defaults (fallback when CMS is empty)
// ---------------------------------------------------------------------------

const DEFAULT_FAQS: FaqItem[] = [
  {
    id: '1',
    category: 'general',
    question: 'What is GovFleet Namibia?',
    answer: 'GovFleet Namibia is a digital fleet management platform that replaces paper-based transport requests, approval, vehicle allocation, inspections, fuel records, trip closure and maintenance with one secure, traceable workflow.',
    sortOrder: 10,
  },
  {
    id: '2',
    category: 'general',
    question: 'Who can use the platform?',
    answer: 'The platform is designed for government institutions, regional councils, municipalities, public enterprises, mines, logistics providers, NGOs and private companies that manage vehicles or transport workflows.',
    sortOrder: 20,
  },
  {
    id: '3',
    category: 'getting-started',
    question: 'How do I request a demonstration?',
    answer: 'Use the "Request a Demonstration" form on the contact page to reach our team. We will set up a walkthrough tailored to your organisation.',
    sortOrder: 10,
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FaqsSection({
  faqs,
  heading = 'Frequently Asked Questions',
  subheading,
  className = '',
}: FaqsSectionProps) {
  const items = faqs?.length ? faqs : DEFAULT_FAQS;

  // Group by category preserving sort order
  const grouped = new Map<string, FaqItem[]>();
  for (const item of items) {
    const cat = item.category || 'general';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(item);
  }
  // Sort within each category
  for (const [, arr] of grouped) {
    arr.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const categoryLabels: Record<string, string> = {
    general: 'General',
    'getting-started': 'Getting Started',
    pricing: 'Pricing & Billing',
    features: 'Features',
    security: 'Security & Compliance',
  };

  return (
    <section className={`bg-surface py-24 ${className}`}>
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-[650] tracking-tight text-ink-950">{heading}</h2>
          {subheading && <p className="mt-4 text-ink-500">{subheading}</p>}
        </div>
        <div className="mt-16 max-w-3xl mx-auto">
          {Array.from(grouped.entries()).map(([category, categoryFaqs]) => (
            <div key={category} className="mb-8">
              <h3 className="text-lg font-semibold text-ink-950 mb-4 capitalize">
                {categoryLabels[category] || category}
              </h3>
              <div className="space-y-3">
                {categoryFaqs.map((faq) => (
                  <FaqItemCard key={faq.id} faq={faq} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqItemCard({ faq }: { faq: FaqItem }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <details
      className="group rounded-[10px] border border-border bg-surface"
      open={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
    >
      <summary className="flex items-center justify-between p-5 cursor-pointer list-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <p className="text-sm font-medium text-ink-950 pr-4">{faq.question}</p>
        <div className="flex h-6 w-6 shrink-0 items-center justify-center text-ink-400 transition-transform group-open:rotate-180">
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </summary>
      <div className="px-5 pb-5 pt-0 text-sm text-ink-500 animate-in fade-in-0 duration-200">
        {faq.answer}
      </div>
    </details>
  );
}