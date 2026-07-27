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
  const firstRender = useRef(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setValue(defaultValue), 0);
    return () => window.clearTimeout(timer);
  }, [defaultValue]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const trimmed = value.trim();
      const current = params.get(name) || '';
      if (current === trimmed && !params.has('page')) return;
      if (trimmed) params.set(name, trimmed);
      else params.delete(name);
      params.delete('page');
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 300);
    return () => window.clearTimeout(timer);
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
