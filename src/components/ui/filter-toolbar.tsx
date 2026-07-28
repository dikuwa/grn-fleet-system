'use client';

import type { ReactNode } from 'react';
import { useTransition, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RotateCcw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FilterToolbarProps {
  children: ReactNode;
  resetHref: string;
  isFiltered: boolean;
  className?: string;
  submitLabel?: string;
  action?: string;
}

export function FilterToolbar({
  children,
  resetHref,
  isFiltered,
  className,
  submitLabel = 'Filter',
  action,
}: FilterToolbarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    const formData = new FormData(event.currentTarget);

    for (const [key, value] of formData.entries()) {
      const normalized = String(value).trim();
      if (
        key === 'page' ||
        !normalized ||
        normalized.toLowerCase() === 'all' ||
        normalized === '__all_filters__'
      ) {
        continue;
      }
      params.set(key, normalized);
    }

    const basePath = (action || resetHref).split('?')[0];
    const query = params.toString();
    startTransition(() => router.push(query ? `${basePath}?${query}` : basePath));
  };

  return (
    <form
      method="GET"
      action={action}
      onSubmit={handleSubmit}
      className={cn('filter-bar-mobile flex flex-wrap items-end gap-4', className)}
    >
      {children}
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <Button
          variant="primary"
          size="sm"
          type="submit"
          loading={isPending}
          disabled={isPending}
          className="flex-1 sm:flex-none"
        >
          <Search className="h-4 w-4" />
          {submitLabel}
        </Button>
        {isFiltered && (
          <Button variant="tertiary" size="sm" asChild className="flex-1 sm:flex-none">
            <Link href={resetHref}>
              <RotateCcw className="h-4 w-4" />
              Clear filters
            </Link>
          </Button>
        )}
      </div>
    </form>
  );
}
