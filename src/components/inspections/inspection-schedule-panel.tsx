'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarClock, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { InspectionScheduleEvent } from '@/lib/inspection-schedule';

export function InspectionSchedulePanel({ events }: { events: InspectionScheduleEvent[] }) {
  const pathname = usePathname();
  if (pathname !== '/dashboard/inspections') return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-brand-700" aria-hidden="true" />
            Inspection Schedule
          </span>
          <Badge variant="info" size="sm">{events.length} pending</Badge>
        </CardTitle>
        <p className="text-xs text-ink-500">
          Planned departure and return inspections follow the vehicle allocation dates. Approved
          schedule corrections update these dates automatically.
        </p>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
            <p className="text-sm font-medium text-ink-950">No pending inspections</p>
            <p className="mt-1 text-xs text-ink-500">
              Active allocations will appear here with their departure and return inspection times.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-[8px] border border-border">
            {events.map((event) => {
              const href = event.tripId
                ? `/dashboard/trips/${event.tripId}`
                : `/dashboard/allocations/${event.allocationId}`;
              return (
                <Link
                  key={event.key}
                  href={href}
                  className="focus-ring group flex min-w-0 items-start gap-3 px-3 py-3 transition-colors hover:bg-muted/40 motion-reduce:transition-none sm:px-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold capitalize text-ink-950">
                        {event.type} inspection
                      </p>
                      <Badge variant={event.isOverdue ? 'error' : 'info'} size="sm">
                        {event.isOverdue ? 'Overdue' : 'Scheduled'}
                      </Badge>
                      {event.allocationState === 'provisional' && (
                        <Badge variant="pending" size="sm">Provisional allocation</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs font-medium tabular-nums text-ink-700">
                      {new Date(event.dueAt).toLocaleString('en-NA', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </p>
                    <p className="mt-1 break-words text-xs text-ink-500">
                      {event.make} {event.model} · {event.licenceNumber}
                      {event.requestReference ? ` · ${event.requestReference}` : ''}
                    </p>
                  </div>
                  <ChevronRight
                    className="mt-1 h-4 w-4 shrink-0 text-ink-300 group-hover:text-brand-700"
                    aria-hidden="true"
                  />
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
