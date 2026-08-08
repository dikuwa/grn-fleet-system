'use client';

import { Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

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
 * parameter intact when the user moves between pages.
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

  useEffect(() => {
    const urlValue = searchParams.get(name) || '';
    if (value !== committedRef.current) return;
    if (urlValue === committedRef.current && urlValue === value) return;
    if (pendingTimer.current) {
      window.clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    setValue(urlValue);
    committedRef.current = urlValue;
  }, [name, searchParams, value]);

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
      <Search
        className="text-ink-500 pointer-events-none absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <Input
        type="search"
        name={name}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        className="pr-9 pl-9"
        autoComplete="off"
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue('')}
          className="focus-ring text-ink-400 hover:bg-muted hover:text-ink-950 absolute top-1/2 right-1.5 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[6px] transition-colors motion-reduce:transition-none"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
