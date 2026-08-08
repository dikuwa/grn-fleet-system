'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Building2, ChevronRight, Clock, Plus, Search, Users } from 'lucide-react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ClientFilterReset } from '@/components/ui/client-filter-reset';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/lib/use-toast';

interface TenantRow {
  id: string;
  name: string;
  code: string;
  slug: string;
  type: string;
  status: string;
  lifecycleStatus: string | null;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  contactEmail: string | null;
  contactPhone: string | null;
  memberCount: number;
}

const STATUS_FILTERS = ['', 'ACTIVE', 'SUSPENDED', 'TRIAL'] as const;
const LIFECYCLE_FILTERS = [
  '',
  'PENDING_INVITATION',
  'SETUP_IN_PROGRESS',
  'PENDING_PLATFORM_REVIEW',
  'READY_FOR_ACTIVATION',
  'ACTIVE',
  'ONBOARDING_FAILED',
] as const;

export default function PlatformTenantsPage() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    slug: '',
    type: 'regional_council',
  });
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['platform-tenants', searchQuery, statusFilter, lifecycleFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      if (statusFilter) params.set('status', statusFilter);
      if (lifecycleFilter) params.set('lifecycle', lifecycleFilter);
      params.set('page', String(page));
      params.set('limit', '25');

      const res = await fetch(`/api/platform/tenants?${params}`);
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Failed to load tenants');
      }
      const json = await res.json();
      return json.data;
    },
  });

  const tenants: TenantRow[] = data?.tenants ?? [];
  const total: number = data?.total ?? 0;
  const totalPages: number = data?.totalPages ?? 1;

  const handleCreate = async () => {
    if (!formData.name.trim() || !formData.code.trim() || !formData.slug.trim()) return;

    setIsCreating(true);
    setCreateError(null);

    try {
      const res = await fetch('/api/platform/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create tenant');

      setShowCreate(false);
      setFormData({ name: '', code: '', slug: '', type: 'regional_council' });
      toast({
        title: 'Tenant created',
        description: `${formData.name.trim()} is ready for platform onboarding.`,
        variant: 'success',
      });
      await refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create tenant';
      setCreateError(message);
      toast({ title: 'Could not create tenant', description: message, variant: 'error' });
    } finally {
      setIsCreating(false);
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('');
    setLifecycleFilter('');
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Platform', href: '/dashboard/platform' },
          { label: 'Tenant Management' },
        ]}
      />
      <PageHeader
        title="Tenant Management"
        description={`${total} tenant${total !== 1 ? 's' : ''} on the platform`}
      >
        <Dialog
          open={showCreate}
          onOpenChange={(open) => {
            if (isCreating) return;
            setShowCreate(open);
            if (!open) setCreateError(null);
          }}
        >
          <DialogTrigger asChild>
            <Button variant="primary" size="sm">
              <Plus className="h-4 w-4" aria-hidden="true" /> Add Tenant
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[min(90dvh,44rem)] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create New Tenant</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label required>Organisation Name</Label>
                <Input
                  autoFocus
                  placeholder="e.g. Kavango East Regional Council"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label required>Tenant Code</Label>
                  <Input
                    placeholder="e.g. KAV-EAST"
                    value={formData.code}
                    onChange={(e) =>
                      setFormData({ ...formData, code: e.target.value.toUpperCase() })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label required>URL Slug</Label>
                  <Input
                    placeholder="e.g. kavango-east"
                    value={formData.slug}
                    onChange={(e) =>
                      setFormData({ ...formData, slug: e.target.value.toLowerCase() })
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Tenant Type</Label>
                <Select
                  value={formData.type}
                  onValueChange={(type) => setFormData((current) => ({ ...current, type }))}
                >
                  <SelectTrigger aria-label="Tenant type">
                    <SelectValue placeholder="Select tenant type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regional_council">Regional Council</SelectItem>
                    <SelectItem value="ministry">Ministry / Department</SelectItem>
                    <SelectItem value="agency">Government Agency</SelectItem>
                    <SelectItem value="municipality">Municipality</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {createError && (
                <p className="text-xs font-medium text-status-error-text" role="alert">
                  {createError}
                </p>
              )}
              <div className="mobile-action-bar flex flex-wrap justify-end gap-2 pt-1">
                <Button variant="secondary" size="sm" onClick={() => setShowCreate(false)} disabled={isCreating}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCreate}
                  loading={isCreating}
                  disabled={!formData.name.trim() || !formData.code.trim() || !formData.slug.trim()}
                >
                  Create Tenant
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <section aria-label="Tenant filters" className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative w-full lg:max-w-sm lg:flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search tenants"
              placeholder="Search by name, code, or slug..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <ClientFilterReset
            isFiltered={Boolean(searchQuery || statusFilter || lifecycleFilter)}
            onClear={clearFilters}
          />
        </div>

        <div className="scrollbar-thin flex max-w-full gap-2 overflow-x-auto pb-1" aria-label="Tenant status filters">
          {STATUS_FILTERS.map((status) => (
            <button
              key={status || 'all-status'}
              type="button"
              aria-pressed={statusFilter === status}
              onClick={() => {
                setStatusFilter(status);
                setPage(1);
              }}
              className={`focus-ring min-h-9 shrink-0 rounded-[8px] border px-3 py-1.5 text-xs font-medium transition-colors motion-reduce:transition-none ${
                statusFilter === status
                  ? 'border-brand-800 bg-brand-800 text-white'
                  : 'border-border bg-surface text-ink-500 hover:bg-muted hover:text-ink-800'
              }`}
            >
              {status ? status.charAt(0) + status.slice(1).toLowerCase() : 'All statuses'}
            </button>
          ))}
        </div>

        <div className="scrollbar-thin flex max-w-full gap-2 overflow-x-auto pb-1" aria-label="Tenant lifecycle filters">
          {LIFECYCLE_FILTERS.map((lifecycle) => (
            <button
              key={lifecycle || 'all-lifecycle'}
              type="button"
              aria-pressed={lifecycleFilter === lifecycle}
              onClick={() => {
                setLifecycleFilter(lifecycle);
                setPage(1);
              }}
              className={`focus-ring min-h-9 shrink-0 rounded-[8px] border px-3 py-1.5 text-xs font-medium transition-colors motion-reduce:transition-none ${
                lifecycleFilter === lifecycle
                  ? 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-600'
                  : 'border-border bg-surface text-ink-500 hover:bg-muted hover:text-ink-800'
              }`}
            >
              {lifecycle ? lifecycle.replace(/_/g, ' ') : 'All lifecycle stages'}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-status-error-text" role="alert">
              {error instanceof Error ? error.message : 'Failed to load tenants'}
            </p>
            <Button variant="secondary" size="sm" onClick={() => refetch()} className="mt-2">
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="space-y-3" aria-label="Loading tenants" role="status">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex animate-pulse items-center gap-3 rounded-[8px] border border-border p-4 motion-reduce:animate-none"
            >
              <div className="h-10 w-10 shrink-0 rounded-[8px] bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-48 max-w-[70%] rounded bg-muted" />
                <div className="h-3 w-32 max-w-[45%] rounded bg-muted" />
              </div>
              <div className="hidden h-3 w-20 rounded bg-muted sm:block" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && !error && tenants.length === 0 && (
        <EmptyState
          icon={<Building2 className="h-6 w-6" />}
          title="No tenants found"
          description={
            searchQuery || statusFilter || lifecycleFilter
              ? 'Clear or adjust the filters to see other tenants.'
              : 'Add your first tenant to get started.'
          }
          action={
            searchQuery || statusFilter || lifecycleFilter
              ? { label: 'Clear filters', onClick: clearFilters }
              : undefined
          }
        />
      )}

      {!isLoading && tenants.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {tenants.map((tenant) => (
                <Link
                  key={tenant.id}
                  href={`/dashboard/platform/tenants/${tenant.id}`}
                  className="focus-ring group flex min-w-0 items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50 sm:px-5 motion-reduce:transition-none"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-600">
                      <Building2 className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink-950">{tenant.name}</span>
                        <Badge
                          variant={
                            tenant.status?.toUpperCase() === 'ACTIVE'
                              ? 'success'
                              : tenant.status?.toUpperCase() === 'SUSPENDED'
                                ? 'error'
                                : 'cancelled'
                          }
                          size="sm"
                        >
                          {tenant.status}
                        </Badge>
                        {tenant.lifecycleStatus && tenant.lifecycleStatus !== 'ACTIVE' && (
                          <Badge
                            variant={
                              tenant.lifecycleStatus === 'PENDING_PLATFORM_REVIEW'
                                ? 'warning'
                                : tenant.lifecycleStatus === 'ONBOARDING_FAILED'
                                  ? 'error'
                                  : 'default'
                            }
                            size="sm"
                          >
                            {tenant.lifecycleStatus.replace(/_/g, ' ')}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono text-xs text-ink-400">{tenant.code}</span>
                        <span className="flex items-center gap-1 text-xs text-ink-500">
                          <Users className="h-3 w-3" aria-hidden="true" />
                          {tenant.memberCount}
                        </span>
                        {tenant.contactEmail && (
                          <span className="max-w-full truncate text-xs text-ink-500">{tenant.contactEmail}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="hidden items-center gap-1 text-xs text-ink-500 md:flex">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {formatDate(tenant.createdAt)}
                    </span>
                    <ChevronRight className="h-4 w-4 text-ink-400 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {totalPages > 1 && (
        <nav className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Tenant pagination">
          <p className="text-xs text-ink-500">
            Page {page} of {totalPages} · {total} total
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
