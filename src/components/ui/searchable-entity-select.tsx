'use client';

import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

export type SearchableEntityOption = {
  id: string;
  label: string;
  description?: string | null;
  searchText?: string;
  status?: string;
  disabled?: boolean;
  disabledReason?: string;
};

export function SearchableEntitySelect({
  options,
  value,
  onChange,
  placeholder = 'Search and select…',
  emptyLabel = 'No matching records.',
  ariaLabel,
  disabled,
  className,
}: {
  options: readonly SearchableEntityOption[];
  value: string;
  onChange: (option: SearchableEntityOption | null) => void;
  placeholder?: string;
  emptyLabel?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find((option) => option.id === value) ?? null;
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      `${option.label} ${option.description ?? ''} ${option.searchText ?? ''} ${option.status ?? ''}`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [options, search]);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
    >
      <div className={cn('relative min-w-0', className)}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            role="combobox"
            aria-label={ariaLabel ?? placeholder}
            aria-expanded={open}
            aria-controls={listboxId}
            className="focus-ring border-border bg-surface text-ink-950 flex min-h-11 w-full items-center gap-2 rounded-[8px] border px-3 py-2 text-left text-sm disabled:opacity-50"
          >
            <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-ink-500')}>
              {selected?.label ?? placeholder}
            </span>
            <ChevronDown className="text-ink-400 h-4 w-4 shrink-0" aria-hidden="true" />
          </button>
        </Popover.Trigger>
        {selected && !disabled && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onChange(null);
            }}
            aria-label={`Clear ${selected.label}`}
            className="focus-ring text-ink-400 hover:bg-muted absolute top-1/2 right-8 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[6px]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={12}
          className="border-border bg-surface z-[100] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1.5rem)] rounded-[10px] border p-2 shadow-xl"
        >
          <div className="relative">
            <Search
              className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              autoFocus
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={placeholder}
              aria-label={ariaLabel ?? placeholder}
              className="border-border bg-canvas text-ink-950 focus:ring-brand-600 h-11 w-full rounded-[8px] border pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
              aria-controls={listboxId}
            />
          </div>
          <div
            id={listboxId}
            role="listbox"
            className="mt-2 max-h-[min(20rem,55dvh)] scrollbar-thin overflow-y-auto"
          >
            {!filtered.length ? (
              <p className="text-ink-500 px-3 py-8 text-center text-sm">{emptyLabel}</p>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={option.id === value}
                  aria-disabled={option.disabled || undefined}
                  disabled={option.disabled}
                  onClick={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  className="focus-ring hover:bg-muted flex min-h-11 w-full items-start gap-3 rounded-[8px] px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="overflow-wrap-anywhere text-ink-950 block text-sm font-medium">
                      {option.label}
                    </span>
                    {(option.description || option.disabledReason) && (
                      <span className="overflow-wrap-anywhere text-ink-500 mt-0.5 block text-xs">
                        {option.disabledReason ?? option.description}
                      </span>
                    )}
                    {option.status && (
                      <span className="bg-muted text-ink-600 mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px]">
                        {option.status}
                      </span>
                    )}
                  </span>
                  {option.id === value && (
                    <Check className="text-brand-700 mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                </button>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
