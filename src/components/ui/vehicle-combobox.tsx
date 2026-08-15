'use client';

import * as Popover from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Loader2, Search, Truck, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

export interface VehicleSearchOption {
  id: string;
  licenceNumber: string;
  vehicleRegisterNumber?: string | null;
  make: string;
  model: string;
  currentOdometer: number;
  status: string;
  fuelType?: string | null;
  categoryName?: string | null;
}

interface VehicleComboboxProps {
  value: string;
  selectedOption?: VehicleSearchOption | null;
  onSelect: (option: VehicleSearchOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
  status?: string;
  className?: string;
}

export function VehicleCombobox({
  value,
  selectedOption,
  onSelect,
  placeholder = 'Search vehicle by plate, register number, make or model…',
  disabled,
  status,
  className,
}: VehicleComboboxProps) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useQuery<VehicleSearchOption[]>({
    queryKey: ['vehicle-search', debouncedSearch, status || 'all'],
    enabled: open,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (status) params.set('status', status);
      const response = await fetch(`/api/fleet?${params}`, { signal, cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Unable to search vehicles');
      return (Array.isArray(json) ? json : json.rows || []) as VehicleSearchOption[];
    },
  });

  const options = useMemo(() => {
    if (!selectedOption || query.data?.some((option) => option.id === selectedOption.id)) {
      return query.data || [];
    }
    return [selectedOption, ...(query.data || [])];
  }, [query.data, selectedOption]);

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
            className="focus-ring border-border bg-surface text-ink-950 flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-[8px] border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-label={placeholder}
          >
            <Truck className="text-ink-400 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className={cn('min-w-0 flex-1 truncate', !selectedOption && 'text-ink-500')}>
              {selectedOption
                ? `${selectedOption.licenceNumber} · ${selectedOption.make} ${selectedOption.model}`
                : placeholder}
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
            className="focus-ring text-ink-400 hover:bg-muted hover:text-ink-950 absolute top-1/2 right-8 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[6px]"
            aria-label="Clear vehicle selection"
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
              placeholder={placeholder}
              className="border-border bg-canvas text-ink-950 placeholder:text-ink-500 focus:ring-brand-600 h-10 w-full rounded-[8px] border pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
              aria-controls={listboxId}
            />
          </div>
          <div id={listboxId} role="listbox" className="max-h-72 scrollbar-thin overflow-y-auto p-1">
            {query.isLoading || query.isFetching ? (
              <div className="text-ink-500 flex items-center justify-center gap-2 px-3 py-6 text-sm">
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> Searching…
              </div>
            ) : query.isError ? (
              <p className="text-status-error-text px-3 py-6 text-center text-sm">
                {query.error instanceof Error ? query.error.message : 'Unable to search vehicles.'}
              </p>
            ) : options.length === 0 ? (
              <p className="text-ink-500 px-3 py-6 text-center text-sm">No vehicles match this search.</p>
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
                    className="focus-ring hover:bg-muted flex w-full cursor-pointer items-start gap-3 rounded-[7px] px-3 py-2.5 text-left"
                  >
                    <span className="bg-brand-50 text-brand-700 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]">
                      <Truck className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-ink-950 block truncate text-sm font-medium">
                        {option.licenceNumber} · {option.make} {option.model}
                      </span>
                      <span className="text-ink-500 block truncate text-xs">
                        {option.vehicleRegisterNumber ? `${option.vehicleRegisterNumber} · ` : ''}
                        {option.currentOdometer.toLocaleString()} km · {option.status.replaceAll('_', ' ')}
                      </span>
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
