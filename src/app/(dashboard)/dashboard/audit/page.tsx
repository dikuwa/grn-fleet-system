'use client';

import { useState, useEffect, useRef } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Search,
  Download,
  Shield,
  UserCheck,
  FileText,
  Truck,
  CarFront,
  Fuel,
  Wrench,
  Users,
  CheckCircle2,
  Eye,
  Hash,
  History,
  Wifi,
  WifiOff,
  RefreshCw,
} from 'lucide-react';
import { ClientFilterReset } from '@/components/ui/client-filter-reset';

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
  | 'auth';

const eventTypes: { value: EventType; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'All Events', icon: <History className="h-4 w-4" /> },
  { value: 'request', label: 'Requests', icon: <FileText className="h-4 w-4" /> },
  { value: 'approval', label: 'Approvals', icon: <CheckCircle2 className="h-4 w-4" /> },
  { value: 'allocation', label: 'Allocations', icon: <Truck className="h-4 w-4" /> },
  { value: 'trip', label: 'Trips', icon: <CarFront className="h-4 w-4" /> },
  { value: 'fuel', label: 'Fuel', icon: <Fuel className="h-4 w-4" /> },
  { value: 'maintenance', label: 'Maintenance', icon: <Wrench className="h-4 w-4" /> },
  { value: 'inspection', label: 'Inspections', icon: <Eye className="h-4 w-4" /> },
  { value: 'vehicle', label: 'Fleet', icon: <Truck className="h-4 w-4" /> },
  { value: 'staff', label: 'Staff', icon: <Users className="h-4 w-4" /> },
  { value: 'auth', label: 'Auth', icon: <Shield className="h-4 w-4" /> },
];

type Severity = 'all' | 'info' | 'warning' | 'critical';

interface AuditEvent {
  id: string;
  timestamp: string;
  eventType: EventType;
  action: string;
  actor: string;
  entity: string;
  severity: 'info' | 'warning' | 'critical';
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

const severityConfig: Record<Severity, { label: string; variant: 'info' | 'error' | 'pending' }> = {
  all: { label: 'All', variant: 'info' },
  info: { label: 'Info', variant: 'info' },
  warning: { label: 'Warning', variant: 'pending' },
  critical: { label: 'Critical', variant: 'error' },
};

const eventIcons: Record<EventType, React.ReactNode> = {
  all: <History className="h-4 w-4" />,
  request: <FileText className="h-4 w-4" />,
  approval: <CheckCircle2 className="h-4 w-4" />,
  allocation: <Truck className="h-4 w-4" />,
  trip: <CarFront className="h-4 w-4" />,
  fuel: <Fuel className="h-4 w-4" />,
  maintenance: <Wrench className="h-4 w-4" />,
  inspection: <Eye className="h-4 w-4" />,
  vehicle: <Truck className="h-4 w-4" />,
  staff: <Users className="h-4 w-4" />,
  auth: <Shield className="h-4 w-4" />,
};

const eventBgColors: Record<EventType, string> = {
  all: 'bg-muted',
  request: 'bg-blue-50 dark:bg-blue-950/50',
  approval: 'bg-green-50 dark:bg-green-950/50',
  allocation: 'bg-purple-50 dark:bg-purple-950/50',
  trip: 'bg-cyan-50 dark:bg-cyan-950/50',
  fuel: 'bg-amber-50 dark:bg-amber-950/50',
  maintenance: 'bg-orange-50 dark:bg-orange-950/50',
  inspection: 'bg-teal-50 dark:bg-teal-950/50',
  vehicle: 'bg-indigo-50 dark:bg-indigo-950/50',
  staff: 'bg-rose-50 dark:bg-rose-950/50',
  auth: 'bg-muted',
};

const eventIconColors: Record<EventType, string> = {
  all: 'text-ink-500',
  request: 'text-blue-700 dark:text-blue-300',
  approval: 'text-green-700 dark:text-green-300',
  allocation: 'text-purple-700 dark:text-purple-300',
  trip: 'text-cyan-700 dark:text-cyan-300',
  fuel: 'text-amber-700 dark:text-amber-300',
  maintenance: 'text-orange-700 dark:text-orange-300',
  inspection: 'text-teal-700 dark:text-teal-300',
  vehicle: 'text-indigo-700 dark:text-indigo-300',
  staff: 'text-rose-700 dark:text-rose-300',
  auth: 'text-ink-700',
};

export default function AuditLogPage() {
  const [selectedType, setSelectedType] = useState<EventType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [showHashChain, setShowHashChain] = useState(false);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [connectionError, setConnectionError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const LIMIT = 50;

  // Debounce search — wait 300ms after last keystroke before fetching
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
  };

  const fetchEvents = async (opts: { append?: boolean; eventType?: string; search?: string }) => {
    const { append = false, eventType, search } = opts;
    const params = new URLSearchParams();
    params.set('limit', String(LIMIT));
    if (append) params.set('offset', String(offset));
    if (eventType && eventType !== 'all') params.set('eventType', eventType);
    if (search) params.set('search', search);

    const res = await fetch(`/api/audit?${params}`);
    if (!res.ok) throw new Error('Unable to load audit events');
    const json = await res.json();
    if (!json?.success) throw new Error('Unable to load audit events');

    const apiEvents = (json.data?.events || []).map((e: Record<string, unknown>) => ({
      id: e.id,
      timestamp: new Date(String(e.createdAt)).toLocaleString('en-NA', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      eventType: String(e.eventType || 'request').split('_')[0] as EventType,
      action: String(e.displayTitle || 'Event recorded'),
      actor: String(e.actorName || 'GovFleet'),
      entity: String(e.entityType || 'Record').replaceAll('_', ' '),
      severity: 'info' as const,
      details: String(e.displayDescription || 'Event recorded.'),
      technical: {
        eventKey: String(e.eventType || ''),
        actorId: String(e.actorUserId || ''),
        targetId: e.entityId ? String(e.entityId) : undefined,
        sourceChannel: e.sourceChannel ? String(e.sourceChannel) : undefined,
        correlationId: e.correlationId ? String(e.correlationId) : undefined,
        before: e.before,
        after: e.after,
      },
    }));

    if (append) {
      setEvents((prev) => [...prev, ...apiEvents]);
    } else {
      setEvents(apiEvents);
    }
    setConnectionError(false);
    setTotal(json.data?.total || 0);
    setOffset((prev) => (append ? prev + apiEvents.length : apiEvents.length));
  };

  // Fetch on mount and when event type / debounced search changes
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
  }, [selectedType, debouncedSearch]);

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

  // Client-side filtering is no longer needed — API does it
  const filteredEvents = events;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Audit Log' }]} />
      <PageHeader
        title="Audit Log"
        description="Immutable event trail with cryptographic hash-chain verification"
      >
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
              connectionError
                ? 'bg-status-error-bg text-status-error-text'
                : 'bg-status-success-bg text-status-success-text'
            }`}
          >
            {connectionError ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
            {connectionError ? 'Connection error' : 'Live Data'}
          </div>
          <Button
            variant={showHashChain ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setShowHashChain(!showHashChain)}
          >
            <Hash className="h-4 w-4" />
            Hash Chain
          </Button>
          <Button variant="secondary" size="sm">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </PageHeader>

      {/* Hash Chain Status */}
      {showHashChain && (
        <Card className="border-brand-200 bg-brand-50/50">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <div className="bg-brand-100 text-brand-700 flex h-10 w-10 items-center justify-center rounded-lg">
                <Shield className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-brand-900 dark:text-brand-700 text-sm font-semibold">
                  Hash-chain metadata
                </h3>
                <p className="text-brand-700 mt-1 text-xs">
                  Audit records include the stored previous and event hashes needed for independent
                  integrity verification.
                </p>
                <div className="mt-3 flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1.5 text-green-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Metadata recorded
                  </span>
                  <span className="text-brand-600">Total events: {total}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-1.5">
              {eventTypes.map((et) => (
                <button
                  key={et.value}
                  onClick={() => setSelectedType(et.value)}
                  className={`inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    selectedType === et.value
                      ? 'bg-brand-800 text-white'
                      : 'text-ink-500 hover:text-ink-700 hover:bg-muted'
                  }`}
                >
                  {et.icon}
                  {et.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search className="text-ink-500 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <Input
                  placeholder="Search events by action, actor, entity, or details..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-9"
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

      {/* Event Timeline */}
      {filteredEvents.length === 0 ? (
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
        <div className="space-y-2">
          {filteredEvents.map((event, i) => {
            const sevLabel = event.severity as Severity;
            return (
              <Card key={event.id} hover>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full ${eventBgColors[event.eventType]} ${eventIconColors[event.eventType]}`}
                      >
                        {eventIcons[event.eventType]}
                      </div>
                      {i < filteredEvents.length - 1 && (
                        <div className="bg-border mt-1 h-full w-px" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1 pb-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-ink-950 text-sm font-medium">{event.action}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-ink-500 text-xs">{event.timestamp}</span>
                          <Badge
                            variant={
                              sevLabel === 'critical'
                                ? 'error'
                                : sevLabel === 'warning'
                                  ? 'pending'
                                  : 'info'
                            }
                            size="sm"
                          >
                            {severityConfig[sevLabel].label}
                          </Badge>
                        </div>
                      </div>

                      <p className="text-ink-500 mt-1 text-xs">{event.details}</p>

                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                        <span className="text-ink-500 flex items-center gap-1">
                          <UserCheck className="h-3 w-3" />
                          {event.actor}
                        </span>
                        <span className="text-ink-500 flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {event.entity}
                        </span>
                        {showHashChain && (
                          <span className="text-ink-400 flex items-center gap-1 font-mono text-[10px]">
                            <Hash className="h-3 w-3" />
                            {`evt_${event.id.slice(0, 8)}...`}
                          </span>
                        )}
                      </div>
                      <details className="border-border bg-muted/40 mt-3 rounded-md border px-3 py-2">
                        <summary className="focus-ring text-ink-600 cursor-pointer text-xs font-medium">
                          Technical details
                        </summary>
                        <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
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
                </CardContent>
              </Card>
            );
          })}

          <div className="flex items-center justify-center pt-2">
            <div className="text-ink-400 mr-3 text-xs">
              Showing {events.length} of {total} events
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleLoadMore}
              loading={loadingMore}
              disabled={events.length >= total || loadingMore}
            >
              Load More Events
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRefresh}
              loading={isLoading}
              className="ml-2"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
