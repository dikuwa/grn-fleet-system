'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import * as Tabs from '@radix-ui/react-tabs';
import { CalendarCheck2, Headphones, Mail, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FaqAccordion, type FaqDisplayItem } from './faq-accordion';

export interface FaqGroup {
  category: string;
  label: string;
  items: FaqDisplayItem[];
}

export function FaqTabs({ groups }: { groups: FaqGroup[] }) {
  const initial = groups[0]?.category ?? 'general';
  const [activeCategory, setActiveCategory] = useState(initial);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(groups[0]?.items[0]?.id ?? null);

  const normalizedQuery = query.trim().toLowerCase();
  const activeGroup = groups.find((group) => group.category === activeCategory) ?? groups[0];

  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];

    return groups.flatMap((group) =>
      group.items
        .filter((item) =>
          `${item.question} ${item.answer}`.toLowerCase().includes(normalizedQuery),
        )
        .map((item) => ({ ...item, categoryLabel: group.label })),
    );
  }, [groups, normalizedQuery]);

  const visibleItems = normalizedQuery ? searchResults : activeGroup?.items ?? [];

  function handleCategoryChange(value: string) {
    setActiveCategory(value);
    setQuery('');
    const nextGroup = groups.find((group) => group.category === value);
    setOpenId(nextGroup?.items[0]?.id ?? null);
  }

  function handleSearch(value: string) {
    setQuery(value);
    setOpenId(null);
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => handleSearch(event.target.value)}
          placeholder="Search questions, topics or problems…"
          aria-label="Search frequently asked questions"
          className="focus-ring h-12 w-full rounded-[10px] border border-border bg-surface pl-12 pr-12 text-sm text-ink-950 placeholder:text-ink-400 shadow-sm outline-none transition-colors hover:border-ink-300 focus:border-brand-400 dark:hover:border-ink-600"
        />
        {query ? (
          <button
            type="button"
            onClick={() => handleSearch('')}
            className="focus-ring absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[7px] text-ink-400 transition-colors hover:bg-muted hover:text-ink-800"
            aria-label="Clear FAQ search"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <Tabs.Root value={activeCategory} onValueChange={handleCategoryChange} className="mt-5">
        <Tabs.List
          aria-label="FAQ categories"
          className="scrollbar-thin flex max-w-full gap-2 overflow-x-auto pb-2"
        >
          {groups.map((group) => (
            <Tabs.Trigger
              key={group.category}
              value={group.category}
              className={cn(
                'focus-ring shrink-0 rounded-[9px] border border-transparent px-4 py-2.5 text-sm font-medium text-ink-500 transition-colors motion-reduce:transition-none',
                'hover:bg-muted hover:text-ink-950 data-[state=active]:border-brand-800 data-[state=active]:bg-brand-800 data-[state=active]:text-white dark:data-[state=active]:border-brand-600 dark:data-[state=active]:bg-brand-700',
              )}
            >
              {group.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <div className="mt-4 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-8">
          <div className="min-w-0">
            {normalizedQuery ? (
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-lg font-[650] tracking-tight text-ink-950">Search results</h2>
                  <p className="mt-1 text-sm text-ink-500">
                    {searchResults.length} {searchResults.length === 1 ? 'answer' : 'answers'} found for “{query.trim()}”
                  </p>
                </div>
              </div>
            ) : null}

            {visibleItems.length > 0 ? (
              <FaqAccordion
                items={visibleItems}
                openId={openId}
                onOpenChange={setOpenId}
              />
            ) : (
              <div className="rounded-[10px] border border-border bg-surface px-6 py-10 text-center">
                <Search className="mx-auto h-7 w-7 text-ink-300" aria-hidden="true" />
                <h2 className="mt-4 text-base font-semibold text-ink-950">No matching questions found</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-500">
                  Try a shorter search term, choose another FAQ category, or contact the GovFleet team for help.
                </p>
                <Link
                  href="/contact"
                  className="mt-5 inline-flex h-10 items-center justify-center rounded-[8px] border border-border bg-canvas px-4 text-sm font-semibold text-ink-900 transition-colors hover:bg-muted"
                >
                  Contact Support
                </Link>
              </div>
            )}
          </div>

          <aside className="rounded-[12px] border border-border bg-surface p-6 shadow-sm lg:sticky lg:top-28">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-800 dark:bg-brand-900/50 dark:text-brand-300">
              <Headphones className="h-6 w-6" aria-hidden="true" />
            </span>
            <h2 className="mt-5 text-lg font-[650] tracking-tight text-ink-950">Still need help?</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              Continue with a tailored walkthrough or send the platform team your specific question.
            </p>

            <div className="mt-6 space-y-3">
              <Link
                href="/request-demo"
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[8px] bg-brand-800 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 dark:hover:bg-brand-600"
              >
                <CalendarCheck2 className="h-4 w-4" aria-hidden="true" />
                Request a Demo
              </Link>
              <Link
                href="/contact"
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[8px] border border-border bg-canvas px-4 text-sm font-semibold text-ink-900 transition-colors hover:bg-muted"
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                Contact Support
              </Link>
            </div>
          </aside>
        </div>

        <div className="sr-only" aria-hidden="true">
          {groups.map((group) => (
            <Tabs.Content key={group.category} value={group.category} />
          ))}
        </div>
      </Tabs.Root>
    </div>
  );
}
