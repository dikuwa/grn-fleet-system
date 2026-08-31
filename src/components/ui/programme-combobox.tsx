'use client';

import * as Popover from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, FileText, Loader2, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

export interface ProgrammeSearchOption {
  id: string;
  reference: string;
  title: string;
  department: string | null;
  venue: string | null;
}

type ProgrammeSearchApiRow = ProgrammeSearchOption & {
  departmentName?: string | null;
};

interface ProgrammeComboboxProps {
  value: string;
  selectedOption?: ProgrammeSearchOption | null;
  onSelect: (option: ProgrammeSearchOption | null) => void;
  disabled?: boolean;
  className?: string;
}

export function ProgrammeCombobox({
  value,
  selectedOption,
  onSelect,
  disabled,
  className,
}: ProgrammeComboboxProps) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const selectedQuery = useQuery<ProgrammeSearchOption | null>({
    queryKey: ['programme-selected', value],
    enabled: Boolean(value && !selectedOption),
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/programmes/${encodeURIComponent(value)}`, {
        signal,
        cache: 'no-store',
      });
      const json = await response.json();
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(json.error || 'Unable to load the selected programme');
      const programme = json.data?.programme;
      const canCreateTransportRequest = json.data?.capabilities?.createTransportRequest === true;
      if (!programme || !canCreateTransportRequest) return null;
      return {
        id: programme.id,
        reference: programme.reference,
        title: programme.title,
        department: programme.departmentName || programme.department || null,
        venue: programme.venue || null,
      };
    },
  });

  useEffect(() => {
    if (value && !selectedOption && selectedQuery.isSuccess && selectedQuery.data === null) {
      onSelect(null);
    }
  }, [onSelect, selectedOption, selectedQuery.data, selectedQuery.isSuccess, value]);

  const query = useQuery<ProgrammeSearchOption[]>({
    queryKey: ['programme-search', debouncedSearch],
    enabled: open,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ selectable: '1', limit: '20' });
      if (debouncedSearch) params.set('q', debouncedSearch);
      const response = await fetch(`/api/programmes?${params}`, {
        signal,
        cache: 'no-store',
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Unable to search programmes');
      return ((json.data || []) as ProgrammeSearchApiRow[]).map((programme) => ({
        id: programme.id,
        reference: programme.reference,
        title: programme.title,
        department: programme.departmentName || programme.department || null,
        venue: programme.venue || null,
      }));
    },
  });

  const resolvedSelectedOption = selectedOption ?? selectedQuery.data ?? null;
  const options = useMemo(() => {
    if (!resolvedSelectedOption || query.data?.some((option) => option.id === resolvedSelectedOption.id)) {
      return query.data || [];
    }
    return [resolvedSelectedOption, ...(query.data || [])];
  }, [query.data, resolvedSelectedOption]);

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
            className="focus-ring border-border bg-surface text-ink-950 flex min-h-10 w-full items-center gap-2 rounded-[8px] border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-label="Search approved programmes"
          >
            <FileText className="text-ink-400 h-4 w-4 shrink-0" aria-hidden="true" />
            <span
              className={cn(
                'min-w-0 flex-1 truncate',
                !resolvedSelectedOption && 'text-ink-500',
              )}
            >
              {resolvedSelectedOption
                ? `${resolvedSelectedOption.reference} — ${resolvedSelectedOption.title}`
                : selectedQuery.isFetching
                  ? 'Loading selected programme…'
                  : 'Search approved programmes…'}
            </span>
            <ChevronDown className="text-ink-400 h-4 w-4 shrink-0" aria-hidden="true" />
          </button>
        </Popover.Trigger>
        {value && !disabled && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect(null);
            }}
            className="focus-ring text-ink-400 hover:bg-muted hover:text-ink-950 absolute top-1/2 right-8 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[6px]"
            aria-label="Clear programme selection"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={12}
          className="border-border bg-surface z-[90] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1.5rem)] rounded-[10px] border p-1 shadow-lg outline-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="border-border relative border-b p-2">
            <Search className="text-ink-400 absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2" />
            <input
              autoFocus
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by programme, reference, department or venue…"
              className="border-border bg-canvas text-ink-950 placeholder:text-ink-500 focus:ring-brand-600 h-10 w-full rounded-[8px] border pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
              aria-controls={listboxId}
            />
          </div>

          <div id={listboxId} role="listbox" className="max-h-72 scrollbar-thin overflow-y-auto p-1">
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
              className="focus-ring hover:bg-muted flex w-full items-center gap-3 rounded-[7px] px-3 py-2.5 text-left"
            >
              <X className="text-ink-400 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="text-ink-700 flex-1 text-sm">No programme link</span>
              {!value && <Check className="text-brand-700 h-4 w-4 shrink-0" aria-hidden="true" />}
            </button>
            <div className="border-border my-1 border-t" aria-hidden="true" />
            {query.isLoading || query.isFetching ? (
              <div className="text-ink-500 flex items-center justify-center gap-2 px-3 py-6 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </div>
            ) : query.isError ? (
              <p className="text-status-error-text px-3 py-6 text-center text-sm">
                {query.error instanceof Error ? query.error.message : 'Unable to search programmes.'}
              </p>
            ) : options.length === 0 ? (
              <p className="text-ink-500 px-3 py-6 text-center text-sm">
                No current approved or published programmes match this search.
              </p>
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
                    className="focus-ring hover:bg-muted flex w-full items-start gap-3 rounded-[7px] px-3 py-2.5 text-left"
                  >
                    <FileText className="text-brand-700 mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="text-ink-950 block truncate text-sm font-medium">
                        {option.reference} — {option.title}
                      </span>
                      {(option.department || option.venue) && (
                        <span className="text-ink-500 block truncate text-xs">
                          {[option.department, option.venue].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                    {isSelected && <Check className="text-brand-700 mt-1 h-4 w-4 shrink-0" />}
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
