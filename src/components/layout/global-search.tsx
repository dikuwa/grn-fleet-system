'use client';

import { useQuery } from '@tanstack/react-query';
import { FileText, Loader2, Search, Truck, UserRound, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { GlobalSearchResult } from '@/app/api/search/route';

const resultIcons = {
  request: FileText,
  vehicle: Truck,
  employee: UserRound,
};

export function GlobalSearch() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  const searchQuery = useQuery<GlobalSearchResult[]>({
    queryKey: ['global-search', debouncedQuery],
    enabled: open && debouncedQuery.length >= 2,
    staleTime: 20_000,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}`, {
        signal,
        cache: 'no-store',
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Search failed');
      return json.data as GlobalSearchResult[];
    },
  });

  const choose = (result: GlobalSearchResult) => {
    setOpen(false);
    setQuery('');
    router.push(result.href);
  };

  const input = (mobile = false) => (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
      <input
        ref={mobile ? mobileInputRef : undefined}
        type="search"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        placeholder="Search requests, vehicles, staff…"
        className="h-10 w-full rounded-[8px] border border-border bg-muted pl-9 pr-9 text-sm text-ink-950 placeholder:text-ink-500 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand-600"
        aria-label="Search requests, vehicles, and staff"
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery('')}
          className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[6px] text-ink-400 hover:bg-surface hover:text-ink-950"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <div ref={rootRef} className="relative flex-1 md:max-w-md">
      <div className="hidden md:block">{input()}</div>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          window.setTimeout(() => mobileInputRef.current?.focus(), 0);
        }}
        className="focus-ring flex h-10 w-10 items-center justify-center rounded-[8px] text-ink-500 hover:bg-muted md:hidden"
        aria-label="Open search"
      >
        <Search className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed left-4 right-4 top-[68px] z-[80] overflow-hidden rounded-[10px] border border-border bg-surface shadow-lg md:absolute md:left-0 md:right-auto md:top-12 md:w-[480px]">
          <div className="border-b border-border p-2 md:hidden">{input(true)}</div>
          <div className="scrollbar-thin max-h-[min(420px,70vh)] overflow-y-auto p-2">
            {query.trim().length < 2 ? (
              <p className="px-3 py-8 text-center text-sm text-ink-500">
                Type at least two characters to search.
              </p>
            ) : searchQuery.isLoading || searchQuery.isFetching ? (
              <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-ink-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </div>
            ) : searchQuery.isError ? (
              <p className="px-3 py-8 text-center text-sm text-status-error-text">
                {searchQuery.error instanceof Error ? searchQuery.error.message : 'Search failed.'}
              </p>
            ) : searchQuery.data?.length ? (
              searchQuery.data.map((result) => {
                const Icon = resultIcons[result.type];
                return (
                  <button
                    key={`${result.type}-${result.id}`}
                    type="button"
                    onClick={() => choose(result)}
                    className="focus-ring flex w-full items-start gap-3 rounded-[7px] px-3 py-2.5 text-left hover:bg-muted"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-brand-50 text-brand-700">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-950">{result.title}</span>
                      <span className="block truncate text-xs capitalize text-ink-500">{result.subtitle}</span>
                    </span>
                    <span className="mt-1 text-[10px] uppercase tracking-wide text-ink-400">{result.type}</span>
                  </button>
                );
              })
            ) : (
              <p className="px-3 py-8 text-center text-sm text-ink-500">
                No accessible records match “{debouncedQuery}”.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
