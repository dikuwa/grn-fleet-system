'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Fuel,
  Hash,
  History,
  RefreshCw,
  Shield,
  ShieldCheck,
  Truck,
  UserCheck,
  Users,
  Wifi,
  WifiOff,
  Wrench,
} from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ClientFilterReset } from '@/components/ui/client-filter-reset';
import { permissionLabel } from '@/lib/role-metadata';

type EventType =
  | 'all'
  | 'request'
  | 'approval'
  | 'allocation'
  | 'trip'
  | 'fuel'
  | 'maintenance'
  | 'inspection'
  | 'staff'
  | 'vehicle'
  | 'role'
  | 'auth';

interface AuditEvent {
  id: string;
  timestamp: string;
  eventType: EventType;
  action: string;
  actor: string;
  entity: string;
  details: string;
  technical: {
    eventKey: string;
    actorId: string;
    targetId?: string;
    sourceChannel?: string;
    correlationId?: string;
    before?: unknown;
    after?: unknown;
  };
}

const eventTypes: Array<{ value: EventType; label: string; icon: React.ReactNode }> = [
  { value: 'all', label: 'All Events', icon: <History className="h-4 w-4" aria-hidden="true" /> },
  {
    value: 'request',
    label: 'Requests',
    icon: <FileText className="h-4 w-4" aria-hidden="true" />,
  },
  {
    value: 'approval',
    label: 'Approvals',
    icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
  },
  {
    value: 'allocation',
    label: 'Allocations',
    icon: <Truck className="h-4 w-4" aria-hidden="true" />,
  },
  { value: 'trip', label: 'Trips', icon: <Truck className="h-4 w-4" aria-hidden="true" /> },
  { value: 'fuel', label: 'Fuel', icon: <Fuel className="h-4 w-4" aria-hidden="true" /> },
  {
    value: 'maintenance',
    label: 'Maintenance',
    icon: <Wrench className="h-4 w-4" aria-hidden="true" />,
  },
  {
    value: 'inspection',
    label: 'Inspections',
    icon: <Eye className="h-4 w-4" aria-hidden="true" />,
  },
  { value: 'vehicle', label: 'Fleet', icon: <Truck className="h-4 w-4" aria-hidden="true" /> },
  { value: 'staff', label: 'Staff', icon: <Users className="h-4 w-4" aria-hidden="true" /> },
  { value: 'role', label: 'Roles', icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" /> },
  { value: 'auth', label: 'Auth', icon: <Shield className="h-4 w-4" aria-hidden="true" /> },
];

const eventIcons: Record<EventType, React.ReactNode> = Object.fromEntries(
  eventTypes.map((item) => [item.value, item.icon]),
) as Record<EventType, React.ReactNode>;

/**
 * Render the enriched role-change audit metadata (permissions granted/removed)
 * as readable chips. Returns null for every non-role event.
 */
function PermissionChangeSummary({ event }: { event: AuditEvent }) {
  const after = (event.technical.after ?? {}) as {
    permissionAdded?: unknown;
    permissionRemoved?: unknown;
  };
  const added = Array.isArray(after.permissionAdded)
    ? after.permissionAdded.filter((code): code is string => typeof code === 'string')
    : [];
  const removed = Array.isArray(after.permissionRemoved)
    ? after.permissionRemoved.filter((code): code is string => typeof code === 'string')
    : [];
  if (added.length === 0 && removed.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2">
      {added.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-status-success-text text-xs font-semibold">Granted</span>
          {added.map((code) => (
            <Badge key={code} variant="success" size="sm">
              {permissionLabel(code)}
            </Badge>
          ))}
        </div>
      )}
      {removed.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-status-error-text text-xs font-semibold">Removed</span>
          {removed.map((code) => (
            <Badge key={code} variant="error" size="sm">
              {permissionLabel(code)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

const LIMIT = 50;

export default function AuditLogPage() {
  const [selectedType, setSelectedType] = useState<EventType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showHashChain, setShowHashChain] = useState(false);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [connectionError, setConnectionError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(value.trim()), 300);
  };

  const fetchEvents = async ({
    append = false,
    eventType,
    search,
  }: {
    append?: boolean;
    eventType?: string;
    search?: string;
  }) => {
    const params = new URLSearchParams({ limit: String(LIMIT) });
    if (append) params.set('offset', String(offset));
    if (eventType && eventType !== 'all') params.set('eventType', eventType);
    if (search) params.set('search', search);

    const response = await fetch(`/api/audit?${params}`);
    if (!response.ok) throw new Error('Unable to load audit events');
    const json = await response.json();
    if (!json?.success) throw new Error('Unable to load audit events');

    const apiEvents: AuditEvent[] = (json.data?.events || []).map(
      (event: Record<string, unknown>) => {
        const rawType = String(event.eventType || 'request').split('_')[0] as EventType;
        const eventTypeValue = eventIcons[rawType] ? rawType : 'all';
        return {
          id: String(event.id),
          timestamp: new Date(String(event.createdAt)).toLocaleString('en-NA', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
          eventType: eventTypeValue,
          action: String(event.displayTitle || 'Event recorded'),
          actor: String(event.actorName || 'GovFleet'),
          entity: String(event.entityType || 'Record').replaceAll('_', ' '),
          details: String(event.displayDescription || 'Event recorded.'),
          technical: {
            eventKey: String(event.eventType || ''),
            actorId: String(event.actorUserId || ''),
            targetId: event.entityId ? String(event.entityId) : undefined,
            sourceChannel: event.sourceChannel ? String(event.sourceChannel) : undefined,
            correlationId: event.correlationId ? String(event.correlationId) : undefined,
            before: event.before,
            after: event.after,
          },
        };
      },
    );

    if (append) setEvents((previous) => [...previous, ...apiEvents]);
    else setEvents(apiEvents);
    setConnectionError(false);
    setTotal(Number(json.data?.total || 0));
    setOffset((previous) => (append ? previous + apiEvents.length : apiEvents.length));
  };

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setIsLoading(true);
      setOffset(0);
      setEvents([]);
      void fetchEvents({ eventType: selectedType, search: debouncedSearch || undefined })
        .catch(() => {
          if (!cancelled) setConnectionError(true);
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // fetchEvents intentionally follows the active server-side filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType, debouncedSearch]);

  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  const exportHref = useMemo(() => {
    const params = new URLSearchParams({ export: 'csv' });
    if (selectedType !== 'all') params.set('eventType', selectedType);
    if (debouncedSearch) params.set('search', debouncedSearch);
    return `/api/audit?${params}`;
  }, [debouncedSearch, selectedType]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      await fetchEvents({
        append: true,
        eventType: selectedType,
        search: debouncedSearch || undefined,
      });
    } catch {
      setConnectionError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    setOffset(0);
    setEvents([]);
    try {
      await fetchEvents({ eventType: selectedType, search: debouncedSearch || undefined });
    } catch {
      setConnectionError(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Audit Log' }]} />
      <PageHeader
        title="Audit Log"
        description="Tenant-scoped event history with stored hash-chain metadata"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium ${connectionError ? 'bg-status-error-bg text-status-error-text' : 'bg-status-success-bg text-status-success-text'}`}
          >
            {connectionError ? (
              <WifiOff className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Wifi className="h-3 w-3" aria-hidden="true" />
            )}
            {connectionError ? 'Connection error' : 'Connected'}
          </span>
          <Button
            variant={showHashChain ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setShowHashChain((visible) => !visible)}
          >
            <Hash className="h-4 w-4" aria-hidden="true" /> Hash Metadata
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <a href={exportHref}>
              <Download className="h-4 w-4" aria-hidden="true" /> Export CSV
            </a>
          </Button>
        </div>
      </PageHeader>

      {showHashChain && (
        <div className="border-brand-200 bg-brand-50/40 dark:border-brand-800/50 dark:bg-brand-950/20 rounded-[10px] border p-4">
          <div className="flex items-start gap-3">
            <Shield className="text-brand-700 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-ink-950 text-sm font-semibold">
                Hash-chain metadata is recorded with audit events
              </p>
              <p className="text-ink-500 mt-1 text-xs">
                Technical details expose event and correlation identifiers required for audit
                review. This panel reports stored metadata; it does not claim that the browser
                independently re-verifies the full chain.
              </p>
              <p className="text-ink-500 mt-2 text-xs tabular-nums">Matching events: {total}</p>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="pt-4">
          <div className="space-y-4">
            <div
              className="flex gap-2 overflow-x-auto pb-1"
              role="tablist"
              aria-label="Audit event types"
            >
              {eventTypes.map((item) => {
                const selected = selectedType === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setSelectedType(item.value)}
                    className={`focus-ring inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-[7px] px-3 text-xs font-medium transition-colors motion-reduce:transition-none ${selected ? 'bg-brand-700 text-white' : 'text-ink-600 hover:bg-muted hover:text-ink-900'}`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  placeholder="Search action, actor ID or audit summary…"
                  aria-label="Search audit events"
                />
              </div>
              <ClientFilterReset
                isFiltered={selectedType !== 'all' || Boolean(searchQuery)}
                onClear={() => {
                  if (searchTimer.current) clearTimeout(searchTimer.current);
                  setSelectedType('all');
                  setSearchQuery('');
                  setDebouncedSearch('');
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div
          className="text-ink-500 flex items-center justify-center gap-2 py-16 text-sm"
          role="status"
        >
          <RefreshCw
            className="h-5 w-5 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />{' '}
          Loading audit events…
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          title="No events found"
          description={
            selectedType !== 'all' || searchQuery
              ? 'No matching records found. Clear filters to view all records.'
              : 'No audit events have been recorded yet.'
          }
          icon={<History className="h-6 w-6" />}
        />
      ) : (
        <>
          <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
            {events.map((event) => (
              <article key={event.id} className="border-border border-b p-4 last:border-b-0 sm:p-5">
                <div className="flex items-start gap-3">
                  <div
                    className="bg-brand-50 text-brand-700 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]"
                    aria-hidden="true"
                  >
                    {eventIcons[event.eventType] || eventIcons.all}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                      <div className="min-w-0">
                        <h2 className="text-ink-950 text-sm font-semibold">{event.action}</h2>
                        <p className="text-ink-500 mt-1 text-sm">{event.details}</p>
                        <PermissionChangeSummary event={event} />
                      </div>
                      <time className="text-ink-400 shrink-0 text-xs tabular-nums">
                        {event.timestamp}
                      </time>
                    </div>
                    <div className="text-ink-500 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="flex items-center gap-1">
                        <UserCheck className="h-3 w-3" aria-hidden="true" />
                        {event.actor}
                      </span>
                      <span className="flex items-center gap-1 capitalize">
                        <FileText className="h-3 w-3" aria-hidden="true" />
                        {event.entity}
                      </span>
                    </div>
                    <details className="border-border bg-muted/30 mt-3 rounded-[7px] border px-3 py-2">
                      <summary className="focus-ring text-ink-600 cursor-pointer rounded text-xs font-medium">
                        Technical details
                      </summary>
                      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                        {Object.entries(event.technical)
                          .filter(([, value]) => value !== undefined && value !== null)
                          .map(([key, value]) => (
                            <div key={key} className="min-w-0">
                              <dt className="text-ink-500 font-medium capitalize">
                                {key.replace(/([a-z])([A-Z])/g, '$1 $2')}
                              </dt>
                              <dd className="text-ink-700 mt-0.5 font-mono text-[11px] break-words">
                                {typeof value === 'object'
                                  ? `${Object.keys(value as Record<string, unknown>).length} changed field(s)`
                                  : String(value)}
                              </dd>
                            </div>
                          ))}
                      </dl>
                    </details>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-ink-500 text-xs tabular-nums">
              Showing {events.length} of {total} events
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleRefresh()}
                loading={isLoading}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleLoadMore()}
                loading={loadingMore}
                disabled={events.length >= total || loadingMore}
              >
                Load More
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
