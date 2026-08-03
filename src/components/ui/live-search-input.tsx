'use client';

import { Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface LiveSearchInputProps {
  name?: string;
  defaultValue?: string;
  placeholder: string;
  className?: string;
}

/**
 * Debounced search input that syncs with the URL query string.
 *
 * Navigation only happens when the user actually types a different value.
 * External URL changes (filter reset, back/forward, toolbar submit) are
 * adopted into the field without re-navigating — this keeps the `page`
 * parameter intact when the user moves between pages, fixing the previous
 * "returns to page 1" bug caused by the effect stripping `page` on every
 * searchParams change.
 */
export function LiveSearchInput({
  name = 'search',
  defaultValue = '',
  placeholder,
  className,
}: LiveSearchInputProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(defaultValue);
  const committedRef = useRef(defaultValue);

  const pendingTimer = useRef<number | null>(null);

  // Adopt external URL changes (filter reset, back/forward, toolbar submit).
  // Skipped when the URL already matches both the committed value and what's
  // currently shown — this is what prevents our own navigation from
  // re-triggering this effect. When we DO adopt, cancel any in-flight debounce
  // so a pending typed value can't re-commit (undoing the reset).
  useEffect(() => {
    const urlValue = searchParams.get(name) || '';
    if (urlValue === committedRef.current && urlValue === value) return;
    if (pendingTimer.current) {
      window.clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    setValue(urlValue);
    committedRef.current = urlValue;
  }, [name, searchParams, value]);

  // Debounced navigation — only fires when the typed value differs from the
  // committed one. The search term changed, so we reset pagination to page 1;
  // pagination is left untouched for any other searchParams change.
  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed === committedRef.current) return;
    if (pendingTimer.current) window.clearTimeout(pendingTimer.current);
    pendingTimer.current = window.setTimeout(() => {
      pendingTimer.current = null;
      const params = new URLSearchParams(searchParams.toString());
      if (trimmed) params.set(name, trimmed);
      else params.delete(name);
      params.delete('page');
      committedRef.current = trimmed;
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 300);
    return () => {
      if (pendingTimer.current) window.clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    };
  }, [name, pathname, router, searchParams, value]);

  return (
    <div className={cn('relative min-w-[200px] flex-1', className)}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
      <input
        type="search"
        name={name}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-[8px] border border-border bg-canvas pl-9 pr-9 text-sm text-ink-950 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-brand-600"
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue('')}
          className="focus-ring absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[6px] text-ink-400 hover:bg-muted hover:text-ink-950"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
