'use client';

import * as Tabs from '@radix-ui/react-tabs';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FaqAccordion, type FaqDisplayItem } from './faq-accordion';

export interface FaqGroup {
  category: string;
  label: string;
  items: FaqDisplayItem[];
}

export function FaqTabs({ groups }: { groups: FaqGroup[] }) {
  const initial = groups[0]?.category ?? 'general';

  return (
    <Tabs.Root
      defaultValue={initial}
      className="mx-auto w-full max-w-6xl lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10"
    >
      <div className="lg:pr-2">
        <p className="hidden text-xs font-semibold uppercase tracking-[0.12em] text-ink-400 lg:block">
          Browse by topic
        </p>
        <Tabs.List
          aria-label="FAQ categories"
          className="scrollbar-thin mt-0 flex max-w-full gap-2 overflow-x-auto border-b border-border pb-3 lg:mt-4 lg:flex-col lg:gap-1 lg:overflow-visible lg:border-b-0 lg:pb-0"
        >
          {groups.map((group) => (
            <Tabs.Trigger
              key={group.category}
              value={group.category}
              className={cn(
                'focus-ring group shrink-0 rounded-[8px] border border-transparent px-4 py-2.5 text-left text-sm font-medium text-ink-500 transition-colors motion-reduce:transition-none',
                'hover:bg-muted hover:text-ink-950 data-[state=active]:border-border data-[state=active]:bg-surface data-[state=active]:text-ink-950',
                'lg:flex lg:w-full lg:items-center lg:justify-between lg:px-3.5 lg:py-3',
              )}
            >
              <span>{group.label}</span>
              <span className="ml-3 hidden items-center gap-1.5 text-xs text-ink-400 lg:flex">
                {group.items.length}
                <ChevronRight
                  className="h-3.5 w-3.5 transition-transform group-data-[state=active]:translate-x-0.5 motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </div>

      <div className="min-w-0 lg:border-l lg:border-border lg:pl-10">
        {groups.map((group) => (
          <Tabs.Content
            key={group.category}
            value={group.category}
            className="mt-6 focus:outline-none lg:mt-0 lg:min-h-[410px]"
          >
            <div className="mb-5 hidden items-end justify-between gap-4 lg:flex">
              <div>
                <h2 className="text-xl font-[650] tracking-tight text-ink-950">{group.label}</h2>
                <p className="mt-1 text-sm text-ink-500">
                  {group.items.length} {group.items.length === 1 ? 'question' : 'questions'} in this topic
                </p>
              </div>
            </div>
            <FaqAccordion items={group.items} />
          </Tabs.Content>
        ))}
      </div>
    </Tabs.Root>
  );
}
