'use client';

import * as Popover from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Loader2, Search, UserRound, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

export interface EmployeeSearchOption {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  email: string | null;
  jobTitle: string | null;
  departmentName: string | null;
  officeName: string | null;
  driverStatus: string | null;
  availabilityStatus: string | null;
}

interface EmployeeComboboxProps {
  kind?: 'employee' | 'driver';
  value: string;
  selectedOption?: EmployeeSearchOption | null;
  onSelect: (option: EmployeeSearchOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function EmployeeCombobox({
  kind = 'employee',
  value,
  selectedOption,
  onSelect,
  placeholder,
  disabled,
  className,
}: EmployeeComboboxProps) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useQuery<EmployeeSearchOption[]>({
    queryKey: ['people-search', kind, debouncedSearch],
    enabled: open,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ kind, limit: '20' });
      if (debouncedSearch) params.set('q', debouncedSearch);
      const response = await fetch(`/api/people-search?${params}`, { signal, cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Unable to search employees');
      return json.data as EmployeeSearchOption[];
    },
  });

  const options = useMemo(() => {
    if (!selectedOption || query.data?.some((option) => option.id === selectedOption.id)) {
      return query.data || [];
    }
    return [selectedOption, ...(query.data || [])];
  }, [query.data, selectedOption]);

  const emptyLabel = kind === 'driver'
    ? 'No authorised drivers match this search.'
    : 'No active employees match this search.';
  const resolvedPlaceholder = placeholder || (kind === 'driver' ? 'Search drivers by name…' : 'Search employees by name…');

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setSearch('');
          setDebouncedSearch('');
        }
      }}
    >
      <div className={cn('relative', className)}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="focus-ring flex min-h-10 w-full items-center gap-2 rounded-[8px] border border-border bg-surface px-3 py-2 text-left text-sm text-ink-950 disabled:cursor-not-allowed disabled:opacity-50"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-label={resolvedPlaceholder}
          >
            <UserRound className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
            <span className={cn('min-w-0 flex-1 truncate', !selectedOption && 'text-ink-500')}>
              {selectedOption ? `${selectedOption.fullName} · ${selectedOption.employeeNumber}` : resolvedPlaceholder}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
          </button>
        </Popover.Trigger>
        {value && !disabled && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect(null);
            }}
            className="focus-ring absolute right-8 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[6px] text-ink-400 hover:bg-muted hover:text-ink-950"
            aria-label="Clear selection"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-[90] w-[var(--radix-popover-trigger-width)] min-w-[280px] rounded-[10px] border border-border bg-surface p-1 shadow-lg outline-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="relative border-b border-border p-2">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              autoFocus
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={resolvedPlaceholder}
              className="h-10 w-full rounded-[8px] border border-border bg-canvas pl-9 pr-3 text-sm text-ink-950 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-brand-600"
              aria-controls={listboxId}
            />
          </div>
          <div id={listboxId} role="listbox" className="scrollbar-thin max-h-72 overflow-y-auto p-1">
            {query.isLoading || query.isFetching ? (
              <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-ink-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </div>
            ) : query.isError ? (
              <p className="px-3 py-6 text-center text-sm text-status-error-text">
                {query.error instanceof Error ? query.error.message : 'Unable to search employees.'}
              </p>
            ) : options.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-ink-500">{emptyLabel}</p>
            ) : (
              options.map((option) => {
                const isSelected = option.id === value;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onSelect(option);
                      setOpen(false);
                    }}
                    className="focus-ring flex w-full items-start gap-3 rounded-[7px] px-3 py-2.5 text-left hover:bg-muted"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                      {option.firstName[0]}{option.lastName[0]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-950">{option.fullName}</span>
                      <span className="block truncate text-xs text-ink-500">
                        {option.employeeNumber}{option.jobTitle ? ` · ${option.jobTitle}` : ''}
                      </span>
                      {kind === 'driver' && option.availabilityStatus && (
                        <span className="mt-0.5 block text-[11px] capitalize text-ink-500">
                          {option.availabilityStatus.replaceAll('_', ' ')}
                        </span>
                      )}
                    </span>
                    {isSelected && <Check className="mt-1 h-4 w-4 shrink-0 text-brand-700" />}
                  </button>
                );
              })
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
