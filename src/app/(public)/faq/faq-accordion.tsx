/**
 * FaqAccordion — accessible single-open disclosure list for FAQ items.
 */

'use client';

import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FaqDisplayItem {
  id: string;
  question: string;
  answer: string;
}

export interface FaqAccordionProps {
  items: FaqDisplayItem[];
  openId?: string | null;
  onOpenChange?: (id: string | null) => void;
}

export function FaqAccordion({ items, openId = null, onOpenChange }: FaqAccordionProps) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
      {items.map((faq, index) => {
        const isOpen = faq.id === openId;
        const panelId = `faq-panel-${faq.id}`;
        const triggerId = `faq-trigger-${faq.id}`;

        return (
          <div key={faq.id} className={cn(index > 0 && 'border-t border-border')}>
            <button
              id={triggerId}
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => onOpenChange?.(isOpen ? null : faq.id)}
              className="focus-ring flex w-full items-center justify-between gap-4 px-5 py-5 text-left transition-colors hover:bg-muted/45 motion-reduce:transition-none"
            >
              <span className="text-sm font-semibold leading-relaxed text-ink-950 sm:text-[15px]">
                {faq.question}
              </span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-ink-400 transition-transform duration-200 motion-reduce:transition-none',
                  isOpen && 'rotate-180',
                )}
                aria-hidden="true"
              />
            </button>

            <div
              id={panelId}
              role="region"
              aria-labelledby={triggerId}
              hidden={!isOpen}
              className="px-5 pb-5 text-sm leading-relaxed text-ink-500 sm:pr-12"
            >
              {faq.answer}
            </div>
          </div>
        );
      })}
    </div>
  );
}
