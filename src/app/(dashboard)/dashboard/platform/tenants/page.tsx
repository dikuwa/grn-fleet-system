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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  Building2, Search, Plus, ChevronRight, Loader2, Globe, Users, Clock,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface TenantRow {
  id: string;
  name: string;
  code: string;
  slug: string;
  type: string;
  status: string;
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
    queryKey: ['platform-tenants', searchQuery, statusFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      if (statusFilter) params.set('status', statusFilter);
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
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Platform', href: '/dashboard' },
        { label: 'Tenant Management' },
      ]} />
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
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label required>URL Slug</Label>
                  <Input
                    placeholder="e.g. kavango-east"
                    value={formData.slug}
                    onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase() })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Tenant Type</Label>
                <select
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                >
                  <option value="regional_council">Regional Council</option>
                  <option value="ministry">Ministry / Department</option>
                  <option value="agency">Government Agency</option>
                  <option value="municipality">Municipality</option>
                </select>
              </div>
              {createError && (
                <p className="text-xs text-status-error-text">{createError}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
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
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            placeholder="Search by name, code, or slug..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          {['', 'active', 'suspended', 'inactive'].map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
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
      </div>

      {/* Error */}
      {error && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-status-error-text">{error instanceof Error ? error.message : 'Failed to load tenants'}</p>
            <Button variant="secondary" size="sm" onClick={() => refetch()} className="mt-2">Retry</Button>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-[8px] border border-border p-4 animate-pulse">
              <div className="h-10 w-10 rounded-[8px] bg-muted shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-48 rounded bg-muted" />
                <div className="h-3 w-32 rounded bg-muted" />
              </div>
              <div className="h-3 w-20 rounded bg-muted" />
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && tenants.length === 0 && (
        <EmptyState
          icon={<Building2 className="h-6 w-6" />}
          title="No tenants found"
          description={searchQuery ? 'Try a different search term.' : 'Add your first tenant to get started.'}
        />
      )}

      {/* Tenant List */}
      {!isLoading && tenants.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {tenants.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => router.push(`/dashboard/platform/tenants/${t.id}`)}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink-950 truncate">{t.name}</span>
                        <Badge variant={
                          t.status === 'active' ? 'success' :
                          t.status === 'suspended' ? 'error' : 'cancelled'
                        } size="sm">{t.status}</Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs font-mono text-ink-400">{t.code}</span>
                        <span className="flex items-center gap-1 text-xs text-ink-500">
                          <Users className="h-3 w-3" />
                          {t.memberCount}
                        </span>
                        {t.contactEmail && (
                          <span className="text-xs text-ink-500">{t.contactEmail}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="hidden sm:flex items-center gap-1 text-xs text-ink-500">
                      <Clock className="h-3 w-3" />
                      {formatDate(t.createdAt)}
                    </span>
                    <ChevronRight className="h-4 w-4 text-ink-400" />
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
          <p className="text-xs text-ink-500">Page {page} of {totalPages} ({total} total)</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
