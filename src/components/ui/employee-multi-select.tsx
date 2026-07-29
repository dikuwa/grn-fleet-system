'use client';

import * as Popover from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Loader2, Search, UsersRound, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { EmployeeSearchOption } from './employee-combobox';

export function EmployeeMultiSelect({
  value,
  onChange,
  className,
}: {
  value: EmployeeSearchOption[];
  onChange: (employees: EmployeeSearchOption[]) => void;
  className?: string;
}) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useQuery<EmployeeSearchOption[]>({
    queryKey: ['people-search', 'employee-multi', debouncedSearch],
    enabled: open,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ kind: 'employee', limit: '30' });
      if (debouncedSearch) params.set('q', debouncedSearch);
      const response = await fetch(`/api/people-search?${params}`, {
        signal,
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to search employees');
      return result.data;
    },
  });
  const selectedIds = useMemo(() => new Set(value.map((employee) => employee.id)), [value]);
  const toggle = (employee: EmployeeSearchOption) => {
    onChange(
      selectedIds.has(employee.id)
        ? value.filter((selected) => selected.id !== employee.id)
        : [...value, employee],
    );
  };
  const visibleUnselected = (query.data || []).filter((employee) => !selectedIds.has(employee.id));

  return (
    <div className={cn('space-y-2', className)}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            className="focus-ring border-border bg-surface flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm"
          >
            <UsersRound className="text-ink-400 h-4 w-4" />
            <span className={cn('flex-1', value.length ? 'text-ink-950' : 'text-ink-500')}>
              {value.length
                ? `${value.length} employee${value.length === 1 ? '' : 's'} selected`
                : 'Search and select employees'}
            </span>
            <ChevronDown className="text-ink-400 h-4 w-4" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="border-border bg-surface z-[90] w-[min(var(--radix-popover-trigger-width),calc(100vw-2rem))] min-w-[300px] rounded-xl border p-2 shadow-xl"
          >
            <div className="relative">
              <Search className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <input
                autoFocus
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, employee number, department, office…"
                className="border-border bg-canvas text-ink-950 focus:ring-brand-600 h-10 w-full rounded-lg border pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
              />
            </div>
            {(query.data || []).length > 0 && (
              <button
                type="button"
                onClick={() => onChange([...value, ...visibleUnselected])}
                disabled={!visibleUnselected.length}
                className="focus-ring text-brand-700 hover:bg-brand-50 mt-2 w-full rounded-md px-3 py-2 text-left text-xs font-semibold disabled:opacity-50"
              >
                Select all {visibleUnselected.length} visible results
              </button>
            )}
            <div
              id={listboxId}
              role="listbox"
              aria-multiselectable
              className="mt-1 max-h-72 overflow-y-auto"
            >
              {query.isFetching ? (
                <p className="text-ink-500 flex items-center justify-center gap-2 py-8 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                </p>
              ) : query.isError ? (
                <p className="text-status-error-text py-8 text-center text-sm">
                  Unable to search employees.
                </p>
              ) : !(query.data || []).length ? (
                <p className="text-ink-500 py-8 text-center text-sm">No matching employees.</p>
              ) : (
                query.data!.map((employee) => {
                  const selected = selectedIds.has(employee.id);
                  return (
                    <button
                      key={employee.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => toggle(employee)}
                      className="focus-ring hover:bg-muted flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left"
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-5 w-5 items-center justify-center rounded border',
                          selected
                            ? 'border-brand-700 bg-brand-700 text-white'
                            : 'border-border bg-surface',
                        )}
                      >
                        {selected && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-ink-950 block truncate text-sm font-medium">
                          {employee.fullName}
                        </span>
                        <span className="text-ink-500 block truncate text-xs">
                          {employee.employeeNumber}
                          {employee.departmentName ? ` · ${employee.departmentName}` : ''}
                          {employee.officeName ? ` · ${employee.officeName}` : ''}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-live="polite">
          {value.map((employee) => (
            <span
              key={employee.id}
              className="bg-brand-50 text-brand-800 inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-xs"
            >
              <span className="truncate">{employee.fullName}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((item) => item.id !== employee.id))}
                aria-label={`Remove ${employee.fullName}`}
                className="focus-ring rounded-full"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
