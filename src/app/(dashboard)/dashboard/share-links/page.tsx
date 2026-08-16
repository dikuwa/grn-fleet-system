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
  Link2,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  CalendarClock,
  Shield,
  CheckCircle2,
  XCircle,
  Clock,
  Copy,
  MessageCircle,
  RefreshCcw,
  Trash2,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { ClientFilterReset } from '@/components/ui/client-filter-reset';
import { useToast } from '@/lib/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface ShareLinkRow {
  id: string;
  shortSlug: string | null;
  expiresAt: string;
  isExpired: boolean;
  isExhausted: boolean;
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
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const { toast } = useToast();
  const [revokeLinkId, setRevokeLinkId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['share-links', statusFilter, searchQuery, page],
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
  const canRevoke = data?.capabilities?.canRevoke === true;
  const canDistribute = data?.capabilities?.canDistribute === true;

  const handleRevoke = async (linkId: string) => {
    try {
      const res = await fetch(`/api/share-links?linkId=${encodeURIComponent(linkId)}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not revoke the secure link');
      toast({ title: 'Share link revoked', variant: 'success' });
      setRevokeLinkId(null);
      await refetch();
    } catch (revokeError) {
      toast({
        title: 'Could not revoke share link',
        description:
          revokeError instanceof Error ? revokeError.message : 'Please refresh and try again.',
        variant: 'error',
      });
    }
  };

  const shareUrlFor = (link: ShareLinkRow) => {
    if (!link.shortSlug) return null;
    const baseUrl = window.location.origin;
    return `${baseUrl}/v/${encodeURIComponent(link.shortSlug)}`;
  };

  const copyLink = async (link: ShareLinkRow) => {
    const url = shareUrlFor(link);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Secure link copied', variant: 'success' });
    } catch {
      toast({
        title: 'Could not copy link',
        description: 'Copy the secure verification URL from the document page instead.',
        variant: 'pending',
      });
    }
  };

  const openWhatsApp = (link: ShareLinkRow) => {
    const url = shareUrlFor(link);
    if (!url) return;
    const docLabel = link.documentType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    const message = `${docLabel} (v${link.documentVersion}) — verified document link.\nVerify securely: ${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  };

  const summary = data?.summary ?? { active: 0, exhausted: 0, expired: 0, revoked: 0, views: 0 };

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={Boolean(revokeLinkId)}
        onOpenChange={(open) => !open && setRevokeLinkId(null)}
        title="Revoke secure share link"
        description="This link will stop working immediately. Anyone using it will no longer be able to open the shared document."
        confirmLabel="Revoke link"
        variant="destructive"
        onConfirm={() => revokeLinkId ? handleRevoke(revokeLinkId) : undefined}
      />
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Share Links' }]} />
      <PageHeader
        title="Share Link Dashboard"
        description={`${total} share link${total !== 1 ? 's' : ''} tracked`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-status-success-text text-2xl font-[650] tabular-nums">{summary.active}</p>
            <p className="text-ink-500 flex items-center justify-center gap-1 text-xs">
              <CheckCircle2 className="h-3 w-3" /> Active
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-status-warning-text text-2xl font-[650] tabular-nums">{summary.exhausted}</p>
            <p className="text-ink-500 flex items-center justify-center gap-1 text-xs">
              <Eye className="h-3 w-3" /> View Limit Reached
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-status-warning-text text-2xl font-[650] tabular-nums">{summary.expired}</p>
            <p className="text-ink-500 flex items-center justify-center gap-1 text-xs">
              <Clock className="h-3 w-3" /> Expired
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-status-error-text text-2xl font-[650] tabular-nums">{summary.revoked}</p>
            <p className="text-ink-500 flex items-center justify-center gap-1 text-xs">
              <XCircle className="h-3 w-3" /> Revoked
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-ink-950 text-2xl font-[650] tabular-nums">{summary.views}</p>
            <p className="text-ink-500 flex items-center justify-center gap-1 text-xs">
              <Eye className="h-3 w-3" /> Total Views
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search by document type..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {['active', 'exhausted', 'expired', 'revoked', ''].map((s) => (
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
              {s ? (s === 'exhausted' ? 'View Limit Reached' : s.charAt(0).toUpperCase() + s.slice(1)) : 'All'}
            </button>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          <RefreshCcw className="h-3 w-3" /> Refresh
        </Button>
        <ClientFilterReset
          isFiltered={Boolean(statusFilter || searchQuery)}
          onClear={() => {
            setStatusFilter('');
            setSearchQuery('');
            setPage(1);
          }}
        />
      </div>

      {error && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-status-error-text text-sm">
              {error instanceof Error ? error.message : 'Failed to load share links'}
            </p>
            <Button variant="secondary" size="sm" onClick={() => refetch()} className="mt-2">
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="border-border flex animate-pulse items-center gap-3 rounded-[8px] border p-4">
              <div className="bg-muted h-10 w-10 shrink-0 rounded-[8px]" />
              <div className="flex-1 space-y-2">
                <div className="bg-muted h-4 w-48 rounded" />
                <div className="bg-muted h-3 w-32 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && !error && links.length === 0 && (
        <EmptyState
          icon={<Link2 className="h-6 w-6" />}
          title="No share links found"
          description={
            statusFilter || searchQuery
              ? 'No matching records found. Clear filters to view all records.'
              : 'No share links have been created yet.'
          }
        />
      )}

      {!isLoading && links.length > 0 && (
        <div className="space-y-3">
          {links.map((link) => {
            const isExpired = link.isExpired;
            const isExhausted =
              link.isExhausted ||
              (link.maxViews !== null && link.currentViews >= link.maxViews);
            const isActive = !link.isRevoked && !isExpired && !isExhausted;
            const docLabel = link.documentType
              .replace(/_/g, ' ')
              .replace(/\b\w/g, (c: string) => c.toUpperCase());

            return (
              <div key={link.id} className="border-border bg-surface hover:border-brand-100 rounded-[10px] border p-4 transition-all hover:shadow-sm">
                <div className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-start">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] ${
                      isActive
                        ? 'bg-status-success-bg text-status-success-text'
                        : link.isRevoked
                          ? 'bg-status-error-bg text-status-error-text'
                          : 'bg-status-warning-bg text-status-warning-text'
                    }`}>
                      <Link2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-ink-950 text-sm font-[650]">{docLabel}</span>
                        <Badge
                          variant={link.isRevoked ? 'error' : isExpired || isExhausted ? 'pending' : 'success'}
                          size="sm"
                        >
                          {link.isRevoked
                            ? 'Revoked'
                            : isExpired
                              ? 'Expired'
                              : isExhausted
                                ? 'View Limit Reached'
                                : 'Active'}
                        </Badge>
                        <Badge variant="info" size="sm">v{link.documentVersion}</Badge>
                      </div>
                      <div className="text-ink-500 mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                        <span className="tabular-nums">
                          <Eye className="mr-1 inline h-3 w-3" />
                          {link.currentViews}{link.maxViews ? ` / ${link.maxViews}` : ''} views
                        </span>
                        <span>
                          <CalendarClock className="mr-1 inline h-3 w-3" />
                          Expires {formatDate(link.expiresAt)}
                        </span>
                        <span>
                          <Clock className="mr-1 inline h-3 w-3" />
                          Created {formatDate(link.createdAt)}
                        </span>
                        <span>
                          <Shield className="mr-1 inline h-3 w-3" />
                          {link.redactionProfile.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
                    {isActive && canDistribute && shareUrlFor(link) && (
                      <>
                        <Button variant="secondary" size="sm" onClick={() => openWhatsApp(link)} title="Share via WhatsApp">
                          <MessageCircle className="h-3 w-3" /> WhatsApp
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => copyLink(link)} title="Copy secure link">
                          <Copy className="h-3 w-3" /> Copy
                        </Button>
                      </>
                    )}
                    {isActive && canRevoke && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="border-status-error-bg/70 text-status-error-text hover:bg-status-error-bg/20 hover:text-status-error-text"
                        onClick={() => setRevokeLinkId(link.id)}
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

      {totalPages > 1 && (
        <div className="border-border flex items-center justify-between border-t pt-4">
          <p className="text-ink-500 text-xs">Page {page} of {totalPages} ({total} total)</p>
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
