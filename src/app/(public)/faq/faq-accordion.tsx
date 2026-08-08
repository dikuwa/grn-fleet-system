/**
 * FaqAccordion — accessible disclosure list for FAQ items.
 */

'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface FaqDisplayItem {
  id: string;
  question: string;
  answer: string;
}

export function FaqAccordion({ items }: { items: FaqDisplayItem[] }) {
  return (
    <div className="space-y-3">
      {items.map((faq) => (
        <FaqItem key={faq.id} question={faq.question} answer={faq.answer} />
      ))}
    </div>
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
      <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-4 rounded-[10px] p-5">
        <h3 className="text-sm font-medium text-ink-950">{question}</h3>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-ink-400 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </summary>
      <div className="px-5 pb-5 text-sm leading-relaxed text-ink-500">{answer}</div>
    </details>
  );
}
