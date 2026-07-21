'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Link2, Search, ChevronLeft, ChevronRight, Eye, CalendarClock,
  Shield, CheckCircle2, XCircle, Clock, FileSpreadsheet,
  RefreshCcw, Trash2,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface ShareLinkRow {
  id: string;
  tokenHash: string;
  expiresAt: string;
  isRevoked: boolean;
  maxViews: number | null;
  currentViews: number;
  redactionProfile: string;
  lastAccessedAt: string | null;
  createdAt: string;
  documentId: string;
  documentType: string;
  documentVersion: number;
  documentStatus: string;
}

export default function ShareLinksDashboardPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('active');
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['share-links', statusFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('limit', '25');
      if (searchQuery) params.set('q', searchQuery);

      const res = await fetch(`/api/share-links?${params}`);
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Failed to load share links');
      }
      const json = await res.json();
      return json.data;
    },
  });

  const links: ShareLinkRow[] = data?.links ?? [];
  const total: number = data?.total ?? 0;
  const totalPages: number = data?.totalPages ?? 1;

  const handleRevoke = async (linkId: string) => {
    try {
      const res = await fetch(`/api/share-links?linkId=${linkId}`, { method: 'DELETE' });
      if (res.ok) refetch();
    } catch { /* silent */ }
  };

  const now = new Date();

  // Pre-compute summary
  const activeCount = links.filter((l) => !l.isRevoked && new Date(l.expiresAt) > now).length;
  const expiredCount = links.filter((l) => !l.isRevoked && new Date(l.expiresAt) <= now).length;
  const revokedCount = links.filter((l) => l.isRevoked).length;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Share Links' },
      ]} />
      <PageHeader
        title="Share Link Dashboard"
        description={`${total} share link${total !== 1 ? 's' : ''} tracked`}
      />

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-success-text">{activeCount}</p>
            <p className="text-xs text-ink-500 flex items-center justify-center gap-1"><CheckCircle2 className="h-3 w-3" /> Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-warning-text">{expiredCount}</p>
            <p className="text-xs text-ink-500 flex items-center justify-center gap-1"><Clock className="h-3 w-3" /> Expired</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-error-text">{revokedCount}</p>
            <p className="text-xs text-ink-500 flex items-center justify-center gap-1"><XCircle className="h-3 w-3" /> Revoked</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-ink-950">{links.reduce((s, l) => s + l.currentViews, 0)}</p>
            <p className="text-xs text-ink-500 flex items-center justify-center gap-1"><Eye className="h-3 w-3" /> Total Views</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            placeholder="Search by document type..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          {['active', 'expired', 'revoked', ''].map((s) => (
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
        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          <RefreshCcw className="h-3 w-3" /> Refresh
        </Button>
      </div>

      {/* Error */}
      {error && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-status-error-text">{error instanceof Error ? error.message : 'Failed to load share links'}</p>
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
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && links.length === 0 && (
        <EmptyState
          icon={<Link2 className="h-6 w-6" />}
          title="No share links found"
          description={statusFilter === 'active' ? 'No active share links. Share a document to create one.' : 'No share links match the current filter.'}
        />
      )}

      {/* Share Link List */}
      {!isLoading && links.length > 0 && (
        <div className="space-y-3">
          {links.map((link) => {
            const isExpired = new Date(link.expiresAt) <= now;
            const isActive = !link.isRevoked && !isExpired;
            const docLabel = link.documentType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

            return (
              <div
                key={link.id}
                className="rounded-[10px] border border-border bg-surface p-4 transition-all hover:border-brand-100 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] ${
                      isActive ? 'bg-status-success-bg text-status-success-text' :
                      link.isRevoked ? 'bg-status-error-bg text-status-error-text' :
                      'bg-status-warning-bg text-status-warning-text'
                    }`}>
                      <Link2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-[650] text-ink-950">{docLabel}</span>
                        <Badge variant={link.isRevoked ? 'error' : isExpired ? 'pending' : 'success'} size="sm">
                          {link.isRevoked ? 'Revoked' : isExpired ? 'Expired' : 'Active'}
                        </Badge>
                        <Badge variant="info" size="sm">v{link.documentVersion}</Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
                        <span className="tabular-nums"><Eye className="inline h-3 w-3 mr-1" />{link.currentViews}{link.maxViews ? ` / ${link.maxViews}` : ''} views</span>
                        <span><CalendarClock className="inline h-3 w-3 mr-1" />Expires {formatDate(link.expiresAt)}</span>
                        <span><Clock className="inline h-3 w-3 mr-1" />Created {formatDate(link.createdAt)}</span>
                        <span><Shield className="inline h-3 w-3 mr-1" />{link.redactionProfile.replace(/_/g, ' ')}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isActive && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleRevoke(link.id)}
                      >
                        <Trash2 className="h-3 w-3" /> Revoke
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-ink-500">Page {page} of {totalPages} ({total} total)</p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="h-3 w-3" /> Previous
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
