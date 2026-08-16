'use client';

import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, MapPin, Search } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

export type InspectionTripOption = {
  id: string;
  requestReference: string;
  authorityNumber: string | null;
  licenceNumber: string;
  make: string;
  model: string;
  driverName: string | null;
  driverKind: 'internal' | 'external';
  originName: string | null;
  destinationName: string | null;
  departureAt: string;
  returnAt: string;
};

function routeLabel(trip: InspectionTripOption) {
  return [trip.originName, trip.destinationName].filter(Boolean).join(' → ') || 'Route not recorded';
}

export function InspectionTripCombobox({
  trips,
  value,
  onChange,
}: {
  trips: InspectionTripOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = trips.find((trip) => trip.id === value) ?? null;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return trips;
    return trips.filter((trip) => [
      trip.authorityNumber,
      trip.requestReference,
      trip.licenceNumber,
      trip.make,
      trip.model,
      trip.driverName,
      trip.originName,
      trip.destinationName,
      trip.departureAt,
    ].some((field) => String(field || '').toLowerCase().includes(query)));
  }, [search, trips]);

  return (
    <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearch(''); }}>
      <Popover.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          className="focus-ring border-border bg-surface flex min-h-11 w-full min-w-0 items-center gap-2 rounded-[8px] border px-3 py-2 text-left"
        >
          <span className={cn('min-w-0 flex-1', !selected && 'text-ink-500')}>
            {selected ? (
              <>
                <span className="text-ink-950 block truncate text-sm font-medium">
                  {selected.authorityNumber || selected.requestReference} · {selected.licenceNumber}
                </span>
                <span className="text-ink-500 block truncate text-xs">{routeLabel(selected)}</span>
              </>
            ) : <span className="text-sm">Select an eligible trip…</span>}
          </span>
          <ChevronDown className="text-ink-400 h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={12}
          className="border-border bg-surface z-[90] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1.5rem)] rounded-[10px] border p-1 shadow-lg"
        >
          <div className="border-border relative border-b p-2">
            <Search className="text-ink-400 absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2" />
            <input
              autoFocus
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Trip, vehicle, driver or route…"
              className="focus-ring border-border bg-canvas text-ink-950 h-10 w-full rounded-[8px] border pr-3 pl-9 text-sm"
            />
          </div>
          <div id={listboxId} role="listbox" className="max-h-80 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="text-ink-500 px-3 py-6 text-center text-sm">No eligible trips match this search.</p>
            ) : filtered.map((trip) => {
              const active = trip.id === value;
              return (
                <button
                  key={trip.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => { onChange(trip.id); setOpen(false); }}
                  className="focus-ring hover:bg-muted flex w-full min-w-0 items-start gap-3 rounded-[7px] px-3 py-2.5 text-left"
                >
                  <MapPin className="text-brand-700 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="text-ink-950 block break-words text-sm font-medium">
                      {trip.authorityNumber || trip.requestReference} · {trip.make} {trip.model} · {trip.licenceNumber}
                    </span>
                    <span className="text-ink-500 mt-0.5 block break-words text-xs">
                      {routeLabel(trip)} · {trip.driverName || (trip.driverKind === 'external' ? 'External driver' : 'Driver not recorded')}
                    </span>
                  </span>
                  {active && <Check className="text-brand-700 mt-0.5 h-4 w-4 shrink-0" />}
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
