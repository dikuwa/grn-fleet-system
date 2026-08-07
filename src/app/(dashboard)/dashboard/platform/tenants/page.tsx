'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { StyledSelect } from '@/components/ui/styled-select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Building2, Search, Plus, ChevronRight, Users, Clock } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { ClientFilterReset } from '@/components/ui/client-filter-reset';

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

export default function PlatformTenantsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState('');

  // Create tenant dialog
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
      refetch();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create tenant');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Platform', href: '/dashboard' },
          { label: 'Tenant Management' },
        ]}
      />
      <PageHeader
        title="Tenant Management"
        description={`${total} tenant${total !== 1 ? 's' : ''} on the platform`}
      >
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button variant="primary" size="sm">
              <Plus className="h-4 w-4" /> Add Tenant
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create New Tenant</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label required>Organisation Name</Label>
                <Input
                  placeholder="e.g. Kavango East Regional Council"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                <StyledSelect
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                >
                  <option value="regional_council">Regional Council</option>
                  <option value="ministry">Ministry / Department</option>
                  <option value="agency">Government Agency</option>
                  <option value="municipality">Municipality</option>
                </StyledSelect>
              </div>
              {createError && <p className="text-status-error-text text-xs">{createError}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setShowCreate(false)}>
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search by name, code, or slug..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          {['', 'ACTIVE', 'SUSPENDED', 'TRIAL'].map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
              }}
              className={`rounded-[6px] px-2.5 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-brand-800 text-white'
                  : 'text-ink-500 hover:text-ink-700 hover:bg-muted'
              }`}
            >
              {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {['', 'PENDING_INVITATION', 'SETUP_IN_PROGRESS', 'PENDING_PLATFORM_REVIEW', 'READY_FOR_ACTIVATION', 'ACTIVE', 'ONBOARDING_FAILED'].map((s) => (
            <button
              key={s}
              onClick={() => {
                setLifecycleFilter(s);
                setPage(1);
              }}
              className={`rounded-[6px] px-2.5 py-1.5 text-xs font-medium transition-colors ${
                lifecycleFilter === s
                  ? 'bg-amber-800 text-white'
                  : 'text-ink-500 hover:text-ink-700 hover:bg-muted'
              }`}
            >
              {s ? s.replace(/_/g, ' ') : 'All Lifecycle'}
            </button>
          ))}
        </div>
        <ClientFilterReset
          isFiltered={Boolean(searchQuery || statusFilter || lifecycleFilter)}
          onClear={() => {
            setSearchQuery('');
            setStatusFilter('');
            setLifecycleFilter('');
            setPage(1);
          }}
        />
      </div>

      {/* Error */}
      {error && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-status-error-text text-sm">
              {error instanceof Error ? error.message : 'Failed to load tenants'}
            </p>
            <Button variant="secondary" size="sm" onClick={() => refetch()} className="mt-2">
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="border-border flex animate-pulse items-center gap-3 rounded-[8px] border p-4"
            >
              <div className="bg-muted h-10 w-10 shrink-0 rounded-[8px]" />
              <div className="flex-1 space-y-2">
                <div className="bg-muted h-4 w-48 rounded" />
                <div className="bg-muted h-3 w-32 rounded" />
              </div>
              <div className="bg-muted h-3 w-20 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && tenants.length === 0 && (
        <EmptyState
          icon={<Building2 className="h-6 w-6" />}
          title="No tenants found"
          description={
            searchQuery ? 'Try a different search term.' : 'Add your first tenant to get started.'
          }
        />
      )}

      {/* Tenant List */}
      {!isLoading && tenants.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="divide-border divide-y">
              {tenants.map((t) => (
                <div
                  key={t.id}
                  className="hover:bg-muted/50 flex cursor-pointer items-center justify-between px-5 py-3.5 transition-colors"
                  onClick={() => router.push(`/dashboard/platform/tenants/${t.id}`)}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="bg-brand-50 text-brand-700 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-ink-950 truncate text-sm font-medium">{t.name}</span>
                        <Badge
                          variant={
                            t.status?.toUpperCase() === 'ACTIVE'
                              ? 'success'
                              : t.status?.toUpperCase() === 'SUSPENDED'
                                ? 'error'
                                : 'cancelled'
                          }
                          size="sm"
                        >
                          {t.status}
                        </Badge>
                        {t.lifecycleStatus && t.lifecycleStatus !== 'ACTIVE' && (
                          <Badge
                            variant={
                              t.lifecycleStatus === 'PENDING_PLATFORM_REVIEW'
                                ? 'warning'
                                : t.lifecycleStatus === 'ONBOARDING_FAILED'
                                  ? 'error'
                                  : 'default'
                            }
                            size="sm"
                          >
                            {t.lifecycleStatus.replace(/_/g, ' ')}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-3">
                        <span className="text-ink-400 font-mono text-xs">{t.code}</span>
                        <span className="text-ink-500 flex items-center gap-1 text-xs">
                          <Users className="h-3 w-3" />
                          {t.memberCount}
                        </span>
                        {t.contactEmail && (
                          <span className="text-ink-500 text-xs">{t.contactEmail}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-ink-500 hidden items-center gap-1 text-xs sm:flex">
                      <Clock className="h-3 w-3" />
                      {formatDate(t.createdAt)}
                    </span>
                    <ChevronRight className="text-ink-400 h-4 w-4" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-ink-500 text-xs">
            Page {page} of {totalPages} ({total} total)
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
