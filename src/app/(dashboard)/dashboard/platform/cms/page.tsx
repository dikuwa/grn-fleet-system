'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import {
  FileText,
  Plus,
  Search,
  RefreshCw,
  Loader2,
  Eye,
  Edit3,
  Archive,
  Clock,
  Globe,
  ChevronRight,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CMSContent {
  id: string;
  pageType: string;
  slug: string;
  title: string;
  description: string | null;
  status: string;
  version: number;
  isListed: boolean;
  navOrder: number;
  publishedAt: string | null;
  updatedAt: string;
  createdByUserId: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; variant: string }> = {
  draft: { label: 'Draft', variant: 'default' },
  published: { label: 'Published', variant: 'success' },
  archived: { label: 'Archived', variant: 'error' },
  scheduled: { label: 'Scheduled', variant: 'info' },
};

const PAGE_TYPE_LABELS: Record<string, string> = {
  homepage: 'Homepage',
  about: 'About',
  services: 'Services',
  how_it_works: 'How It Works',
  pricing: 'Pricing',
  faqs: 'FAQs',
  contact: 'Contact',
  legal: 'Legal',
  announcements: 'Announcements',
  media_library: 'Media Library',
  custom: 'Custom',
};

const PAGE_TYPE_OPTIONS = Object.entries(PAGE_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PlatformCMSPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [pages, setPages] = useState<CMSContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const fetchPages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('pageType', typeFilter);

      const res = await fetch(`/api/platform/cms/content?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch');
      setPages(json.data.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, typeFilter]);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  const archivePage = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/platform/cms/content/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to archive');
      toast({ title: 'Archived', description: 'Page archived', variant: 'success' });
      fetchPages();
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed', variant: 'error' });
    }
  }, [toast, fetchPages]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-NA', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Platform', href: '/dashboard/platform' },
        { label: 'CMS Pages' },
      ]} />

      <PageHeader
        title="Content Management"
        description="Manage public website pages, content blocks, and publishing"
        actions={
          <Button size="sm" onClick={() => toast({ title: 'Coming Soon', description: 'CMS editor is under development' })}>
            <Plus className="h-4 w-4 mr-1" />
            New Page
          </Button>
        }
      />

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
              <input
                type="text"
                placeholder="Search pages..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 h-10 text-sm border border-border rounded-[8px] bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              />
            </div>
            <StyledSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="scheduled">Scheduled</option>
              <option value="archived">Archived</option>
            </StyledSelect>
            <StyledSelect value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-44">
              <option value="">All Types</option>
              {PAGE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </StyledSelect>
            <Button variant="secondary" size="compact" onClick={fetchPages}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Content List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
          <span className="ml-2 text-sm text-ink-500">Loading pages...</span>
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-sm text-status-error-text">{error}</p>
          <Button variant="secondary" size="compact" onClick={fetchPages} className="mt-3">Retry</Button>
        </div>
      ) : pages.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="h-12 w-12 text-ink-300 mx-auto mb-3" />
            <p className="text-sm text-ink-500 mb-4">No content pages found</p>
            <p className="text-xs text-ink-400">CMS pages will appear here once created</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {pages.map((page) => {
            const statusConfig = STATUS_CONFIG[page.status] || { label: page.status, variant: 'default' };
            return (
              <Card key={page.id} className="hover:border-brand-300 transition-colors">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <Globe className="h-4 w-4 text-ink-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-ink-900 truncate">{page.title}</h3>
                          <Badge variant={statusConfig.variant as any} size="sm">{statusConfig.label}</Badge>
                          {page.version > 1 && (
                            <span className="text-[10px] text-ink-400">v{page.version}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-ink-500 mt-0.5">
                          <span className="font-mono">/{page.slug}</span>
                          <span>·</span>
                          <span>{PAGE_TYPE_LABELS[page.pageType] || page.pageType}</span>
                          {!page.isListed && <span className="text-ink-400 italic">(unlisted)</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-ink-400 shrink-0">
                      {page.publishedAt && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(page.publishedAt)}
                        </span>
                      )}
                      <span className="text-ink-300">·</span>
                      <span>Updated {formatDate(page.updatedAt)}</span>
                      <Button variant="ghost" size="compact" onClick={() => toast({ title: 'Coming Soon', description: 'CMS editor is under development' })}>
                        <Edit3 className="h-4 w-4" />
                      </Button>
                      {page.status !== 'archived' && (
                        <Button variant="ghost" size="compact" onClick={() => archivePage(page.id)} className="text-status-error-text">
                          <Archive className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
