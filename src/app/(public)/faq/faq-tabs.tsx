'use client';

import * as Tabs from '@radix-ui/react-tabs';
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
    <Tabs.Root defaultValue={initial} className="mx-auto w-full max-w-4xl">
      <Tabs.List
        aria-label="FAQ categories"
        className="scrollbar-thin flex max-w-full gap-2 overflow-x-auto border-b border-border pb-3"
      >
        {groups.map((group) => (
          <Tabs.Trigger
            key={group.category}
            value={group.category}
            className={cn(
              'focus-ring shrink-0 rounded-[8px] border border-transparent px-4 py-2 text-sm font-medium text-ink-500 transition-colors',
              'hover:bg-muted hover:text-ink-950 data-[state=active]:border-border data-[state=active]:bg-surface data-[state=active]:text-ink-950',
            )}
          >
            {group.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      {groups.map((group) => (
        <Tabs.Content key={group.category} value={group.category} className="mt-6 focus:outline-none">
          <FaqAccordion items={group.items} />
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
