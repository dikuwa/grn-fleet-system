'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Building2,
  Calendar,
  Car,
  CheckCircle,
  Mail,
  MonitorPlay,
  Phone,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/lib/use-toast';

interface DemoRequest {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string;
  jobTitle: string;
  role: string;
  industry: string | null;
  userCount: number | null;
  vehicleCount: number | null;
  preferredDate: string | null;
  preferredTime: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  contactMethod: string;
}

type BadgeVariant = NonNullable<BadgeProps['variant']>;

const STATUS_CONFIG: Record<string, { label: string; variant: BadgeVariant }> = {
  new: { label: 'New', variant: 'info' },
  qualified: { label: 'Qualified', variant: 'warning' },
  scheduled: { label: 'Scheduled', variant: 'success' },
  completed: { label: 'Completed', variant: 'default' },
  converted: { label: 'Converted', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'error' },
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'new', label: 'New' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'converted', label: 'Converted' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STAT_ITEMS = [
  ['total', 'Total'],
  ['new', 'New'],
  ['qualified', 'Qualified'],
  ['scheduled', 'Scheduled'],
  ['completed', 'Completed'],
  ['converted', 'Converted'],
] as const;

export default function PlatformDemoRequestsPage() {
  const { toast } = useToast();
  const [requests, setRequests] = useState<DemoRequest[]>([]);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DemoRequest | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const res = await fetch(`/api/platform/demo-requests?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch demo requests');
      setRequests(json.data.requests ?? []);
      setStats(json.data.stats ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load demo requests');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const updateStatus = useCallback(
    async (id: string, status: string) => {
      setUpdatingId(id);
      try {
        const res = await fetch('/api/platform/demo-requests', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to update request');
        toast({
          title: 'Request updated',
          description: `Demo request marked as ${status}.`,
          variant: 'success',
        });
        await fetchRequests();
      } catch (err) {
        toast({
          title: 'Update failed',
          description: err instanceof Error ? err.message : 'Could not update request',
          variant: 'error',
        });
        throw err;
      } finally {
        setUpdatingId(null);
      }
    },
    [toast, fetchRequests],
  );

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-NA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Platform', href: '/dashboard/platform' },
          { label: 'Demo Requests' },
        ]}
      />

      <PageHeader
        title="Demo Requests"
        description="Qualify and manage organisations evaluating the platform."
      />

      {stats && (
        <section aria-label="Demo request summary" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            {STAT_ITEMS.map(([key, label], index) => (
              <div
                key={key}
                className={`px-4 py-4 ${index % 2 ? 'border-l border-border' : ''} ${index >= 2 ? 'border-t border-border sm:border-t-0' : ''} ${index >= 3 ? 'sm:border-t sm:border-border lg:border-t-0' : ''} ${index > 0 ? 'lg:border-l lg:border-border' : ''}`}
              >
                <p className="text-xs font-medium text-ink-500">{label}</p>
                <p className="mt-1 text-2xl font-[650] tabular-nums text-ink-950">{stats[key] ?? 0}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-label="Demo request filters" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-md sm:flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Search demo requests"
            placeholder="Search name, email, or organisation..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Filter demo requests by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="secondary" size="icon" onClick={fetchRequests} loading={loading} aria-label="Refresh demo requests">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </Button>
      </section>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center" role="status">
          <span className="text-sm text-ink-500">Loading demo requests…</span>
        </div>
      ) : error ? (
        <EmptyState
          icon={<MonitorPlay className="h-6 w-6" />}
          title="Could not load demo requests"
          description={error}
          action={{ label: 'Retry', onClick: fetchRequests }}
        />
      ) : requests.length === 0 ? (
        <EmptyState
          icon={<MonitorPlay className="h-6 w-6" />}
          title="No demo requests found"
          description={debouncedSearch || statusFilter !== 'all' ? 'Adjust the current filters to see other requests.' : 'New demo requests will appear here when prospects submit the public form.'}
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          {requests.map((request) => {
            const config = STATUS_CONFIG[request.status] ?? { label: request.status, variant: 'default' as BadgeVariant };
            const isUpdating = updatingId === request.id;
            return (
              <article key={request.id} className="border-b border-border p-4 last:border-b-0 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Building2 className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
                      <h2 className="min-w-0 truncate text-sm font-semibold text-ink-950">{request.company}</h2>
                      <Badge variant={config.variant} size="sm">{config.label}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-ink-600">{request.name} · {request.jobTitle}</p>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-500">
                      <a href={`mailto:${request.email}`} className="flex min-w-0 items-center gap-1.5 hover:text-brand-700">
                        <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{request.email}</span>
                      </a>
                      {request.phone && (
                        <a href={`tel:${request.phone}`} className="flex items-center gap-1.5 hover:text-brand-700">
                          <Phone className="h-3.5 w-3.5" aria-hidden="true" /> {request.phone}
                        </a>
                      )}
                      {request.userCount ? (
                        <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" aria-hidden="true" /> {request.userCount} users</span>
                      ) : null}
                      {request.vehicleCount ? (
                        <span className="flex items-center gap-1.5"><Car className="h-3.5 w-3.5" aria-hidden="true" /> {request.vehicleCount} vehicles</span>
                      ) : null}
                    </div>
                    {(request.preferredDate || request.notes) && (
                      <div className="mt-3 space-y-1 text-xs text-ink-500">
                        {request.preferredDate && (
                          <p className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                            Preferred: {formatDate(request.preferredDate)}{request.preferredTime ? ` (${request.preferredTime})` : ''}
                          </p>
                        )}
                        {request.notes && <p className="max-w-3xl leading-relaxed">{request.notes}</p>}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-2 lg:items-end">
                    <div className="mobile-action-bar flex flex-wrap gap-2 lg:justify-end">
                      {request.status === 'new' && (
                        <Button variant="secondary" size="sm" onClick={() => updateStatus(request.id, 'qualified')} loading={isUpdating}>
                          <CheckCircle className="h-4 w-4" aria-hidden="true" /> Qualify
                        </Button>
                      )}
                      {request.status === 'qualified' && (
                        <Button size="sm" onClick={() => updateStatus(request.id, 'scheduled')} loading={isUpdating}>
                          <Calendar className="h-4 w-4" aria-hidden="true" /> Schedule
                        </Button>
                      )}
                      {request.status === 'scheduled' && (
                        <Button size="sm" onClick={() => updateStatus(request.id, 'completed')} loading={isUpdating}>
                          <CheckCircle className="h-4 w-4" aria-hidden="true" /> Complete
                        </Button>
                      )}
                      {request.status === 'completed' && (
                        <Button size="sm" onClick={() => updateStatus(request.id, 'converted')} loading={isUpdating}>
                          <ArrowRight className="h-4 w-4" aria-hidden="true" /> Convert
                        </Button>
                      )}
                      {!['completed', 'converted', 'cancelled'].includes(request.status) && (
                        <Button variant="ghost" size="sm" onClick={() => setCancelTarget(request)} disabled={isUpdating}>
                          Cancel
                        </Button>
                      )}
                    </div>
                    <span className="text-xs text-ink-400">Received {formatDate(request.createdAt)}</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        title="Cancel demo request?"
        description={cancelTarget ? `Mark the demo request from ${cancelTarget.company} as cancelled?` : 'Mark this demo request as cancelled?'}
        confirmLabel="Cancel Request"
        variant="destructive"
        onConfirm={async () => {
          if (!cancelTarget) return;
          const target = cancelTarget;
          await updateStatus(target.id, 'cancelled');
          setCancelTarget(null);
        }}
      />
    </div>
  );
}
