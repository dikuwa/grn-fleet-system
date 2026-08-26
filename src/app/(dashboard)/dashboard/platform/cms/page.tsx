'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Input, Label, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTabs } from '@/components/ui/page-tabs';
import {
  Archive,
  Clock,
  Edit3,
  FileText,
  Globe,
  Loader2,
  MessagesSquare,
  Plus,
  RefreshCw,
  Search,
  Settings2,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { SiteSettingsTab } from './settings-tab';
import { FaqsTab } from './faqs-tab';

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

interface PageForm {
  pageType: string;
  slug: string;
  title: string;
  description: string;
  status: string;
  isListed: boolean;
  navOrder: string;
}

const EMPTY_PAGE_FORM: PageForm = {
  pageType: 'custom',
  slug: '',
  title: '',
  description: '',
  status: 'draft',
  isListed: true,
  navOrder: '0',
};

const STATUS_CONFIG: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
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

const TABS = [
  { id: 'pages', label: 'Pages', icon: FileText },
  { id: 'settings', label: 'Site Settings', icon: Settings2 },
  { id: 'faqs', label: 'FAQs', icon: MessagesSquare },
] as const;

type TabId = (typeof TABS)[number]['id'];

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);

export default function PlatformCMSPage() {
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [activeTab, setActiveTab] = useState<TabId>('pages');

  const [pages, setPages] = useState<CMSContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPage, setEditingPage] = useState<CMSContent | null>(null);
  const [pageForm, setPageForm] = useState<PageForm>({ ...EMPTY_PAGE_FORM });
  const [savingPage, setSavingPage] = useState(false);

  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsContent, setSettingsContent] = useState<Record<string, unknown> | null>(null);
  const [settingsBrand, setSettingsBrand] = useState<Record<string, unknown> | null>(null);
  const [settingsUpdatedAt, setSettingsUpdatedAt] = useState<string | null>(null);

  const fetchPages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('pageType', typeFilter);
      const res = await fetch(`/api/platform/cms/content?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load CMS pages');
      setPages(json.data?.content ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load CMS pages');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, typeFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchPages(), 250);
    return () => window.clearTimeout(timer);
  }, [fetchPages]);

  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const res = await fetch('/api/platform/cms/settings');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch settings');
      const { publicContent, settings } = json.data ?? {};
      setSettingsContent(publicContent ?? {});
      setSettingsBrand({
        siteName: settings?.siteName ?? 'GovFleet Namibia',
        siteTagline: settings?.siteTagline ?? '',
        logoUrl: settings?.logoUrl ?? '',
        faviconUrl: settings?.faviconUrl ?? '',
      });
      setSettingsUpdatedAt(settings?.updatedAt ?? null);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'settings' || settingsContent) return;
    void fetchSettings();
  }, [activeTab, fetchSettings, settingsContent]);

  const filteredCountLabel = useMemo(() => {
    const filtered = Boolean(searchQuery || statusFilter || typeFilter);
    return `${pages.length} ${filtered ? 'matching' : 'available'} page${pages.length === 1 ? '' : 's'}`;
  }, [pages.length, searchQuery, statusFilter, typeFilter]);

  const openCreate = () => {
    setEditingPage(null);
    setPageForm({ ...EMPTY_PAGE_FORM });
    setEditorOpen(true);
  };

  const openEdit = (page: CMSContent) => {
    setEditingPage(page);
    setPageForm({
      pageType: page.pageType,
      slug: page.slug,
      title: page.title,
      description: page.description ?? '',
      status: page.status,
      isListed: page.isListed,
      navOrder: String(page.navOrder ?? 0),
    });
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (savingPage) return;
    setEditorOpen(false);
    setEditingPage(null);
    setPageForm({ ...EMPTY_PAGE_FORM });
  };

  const savePage = async () => {
    const title = pageForm.title.trim();
    const slug = slugify(pageForm.slug || pageForm.title);
    if (!title || !slug || !pageForm.pageType) {
      toast({
        title: 'Missing page information',
        description: 'Title, slug and page type are required.',
        variant: 'error',
      });
      return;
    }

    setSavingPage(true);
    try {
      const payload = {
        pageType: pageForm.pageType,
        slug,
        title,
        description: pageForm.description.trim() || null,
        status: pageForm.status,
        isListed: pageForm.isListed,
        navOrder: Number.parseInt(pageForm.navOrder || '0', 10) || 0,
      };
      const res = await fetch(
        editingPage ? `/api/platform/cms/content/${editingPage.id}` : '/api/platform/cms/content',
        {
          method: editingPage ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save page');
      toast({
        title: editingPage ? 'Page updated' : 'Page created',
        description: `${title} is saved as ${payload.status}.`,
        variant: 'success',
      });
      closeEditor();
      await fetchPages();
    } catch (err) {
      toast({
        title: 'Could not save page',
        description: err instanceof Error ? err.message : 'Save failed',
        variant: 'error',
      });
    } finally {
      setSavingPage(false);
    }
  };

  const archivePage = (page: CMSContent) => {
    confirm({
      title: `Archive ${page.title}?`,
      description:
        'The page record will be archived and removed from normal public navigation. Its version history is preserved.',
      confirmLabel: 'Archive Page',
      variant: 'destructive',
      onConfirm: async () => {
        const res = await fetch(`/api/platform/cms/content/${page.id}`, { method: 'DELETE' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to archive page');
        toast({ title: 'Page archived', description: page.title, variant: 'success' });
        await fetchPages();
      },
    });
  };

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
          { label: 'Content Management' },
        ]}
      />
      <PageHeader
        title="Content Management"
        description="Manage public site settings, structured page records and frequently asked questions."
      >
        {activeTab === 'pages' && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" /> New Page
          </Button>
        )}
      </PageHeader>

      <PageTabs
        items={TABS.map((tab) => {
          const Icon = tab.icon;
          return {
            value: tab.id,
            label: tab.label,
            icon: <Icon className="h-4 w-4" aria-hidden="true" />,
          };
        })}
        value={activeTab}
        onValueChange={setActiveTab}
        label="Content management sections"
      />

      {activeTab === 'settings' && (
        <SettingsTabMount
          loading={settingsLoading}
          error={settingsError}
          content={settingsContent}
          brand={settingsBrand}
          updatedAt={settingsUpdatedAt}
          onRetry={fetchSettings}
          onSaved={setSettingsUpdatedAt}
        />
      )}

      {activeTab === 'faqs' && <FaqsTab />}

      {activeTab === 'pages' && (
        <div className="space-y-5">
          <div className="border-border grid gap-3 border-y py-4 sm:grid-cols-2 lg:grid-cols-[minmax(240px,1fr)_180px_190px_auto] lg:items-center">
            <div className="relative">
              <Search
                className="text-ink-400 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <Input
                type="search"
                aria-label="Search public pages"
                placeholder="Search pages by title or slug..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <StyledSelect
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter pages by status"
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="scheduled">Scheduled</option>
              <option value="archived">Archived</option>
            </StyledSelect>
            <StyledSelect
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Filter pages by type"
            >
              <option value="">All page types</option>
              {PAGE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </StyledSelect>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void fetchPages()}
              loading={loading}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-ink-500 text-xs">{filteredCountLabel}</p>
            {(searchQuery || statusFilter || typeFilter) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('');
                  setTypeFilter('');
                }}
              >
                Clear filters
              </Button>
            )}
          </div>

          {loading ? (
            <div className="text-ink-500 flex items-center justify-center gap-2 py-14 text-sm">
              <Loader2
                className="h-5 w-5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />{' '}
              Loading pages…
            </div>
          ) : error ? (
            <EmptyState
              icon={<FileText className="h-6 w-6" />}
              title="Could not load public pages"
              description={error}
              action={{ label: 'Retry', onClick: fetchPages }}
            />
          ) : pages.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-6 w-6" />}
              title="No public pages found"
              description={
                searchQuery || statusFilter || typeFilter
                  ? 'Adjust or clear the current filters.'
                  : 'Create a structured page record or manage the site through Site Settings.'
              }
              action={
                !searchQuery && !statusFilter && !typeFilter
                  ? { label: 'Create Page', onClick: openCreate }
                  : undefined
              }
            />
          ) : (
            <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
              <div className="border-border bg-muted/40 text-ink-500 hidden grid-cols-[minmax(0,1.4fr)_160px_120px_160px_auto] gap-4 border-b px-5 py-3 text-xs font-medium lg:grid">
                <span>Page</span>
                <span>Type</span>
                <span>Status</span>
                <span>Updated</span>
                <span className="text-right">Actions</span>
              </div>
              {pages.map((page) => {
                const statusConfig = STATUS_CONFIG[page.status] || {
                  label: page.status,
                  variant: 'default' as const,
                };
                return (
                  <div
                    key={page.id}
                    className="border-border grid gap-3 border-b px-4 py-4 last:border-b-0 sm:px-5 lg:grid-cols-[minmax(0,1.4fr)_160px_120px_160px_auto] lg:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Globe className="text-ink-400 h-4 w-4 shrink-0" aria-hidden="true" />
                        <h3 className="text-ink-950 truncate text-sm font-semibold">
                          {page.title}
                        </h3>
                        {page.version > 1 && (
                          <span className="text-ink-400 text-[10px]">v{page.version}</span>
                        )}
                      </div>
                      <p className="text-ink-500 mt-1 truncate font-mono text-xs">/{page.slug}</p>
                      {page.description && (
                        <p className="text-ink-500 mt-1 line-clamp-2 text-xs">{page.description}</p>
                      )}
                    </div>
                    <div className="text-ink-600 text-xs">
                      {PAGE_TYPE_LABELS[page.pageType] || page.pageType}
                    </div>
                    <div>
                      <Badge variant={statusConfig.variant} size="sm">
                        {statusConfig.label}
                      </Badge>
                    </div>
                    <div className="text-ink-500 text-xs">
                      <p>{formatDate(page.updatedAt)}</p>
                      {page.publishedAt && (
                        <p className="mt-0.5 flex items-center gap-1">
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          Published {formatDate(page.publishedAt)}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 lg:justify-end">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(page)}>
                        <Edit3 className="h-4 w-4" aria-hidden="true" /> Edit
                      </Button>
                      {page.status !== 'archived' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => archivePage(page)}
                          className="text-status-error-text"
                        >
                          <Archive className="h-4 w-4" aria-hidden="true" /> Archive
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => !savingPage && (open ? setEditorOpen(true) : closeEditor())}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingPage ? 'Edit public page' : 'Create public page'}</DialogTitle>
            <DialogDescription>
              Manage safe page metadata and publication state. Homepage messaging, contact details
              and structured marketing sections remain managed through Site Settings.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label required>Title</Label>
              <Input
                value={pageForm.title}
                onChange={(e) => {
                  const title = e.target.value;
                  setPageForm((current) => ({
                    ...current,
                    title,
                    slug: editingPage || current.slug ? current.slug : slugify(title),
                  }));
                }}
                placeholder="Public page title"
              />
            </div>
            <div className="space-y-1.5">
              <Label required>Slug</Label>
              <Input
                value={pageForm.slug}
                onChange={(e) =>
                  setPageForm((current) => ({ ...current, slug: slugify(e.target.value) }))
                }
                placeholder="page-slug"
              />
            </div>
            <div className="space-y-1.5">
              <Label required>Page type</Label>
              <StyledSelect
                value={pageForm.pageType}
                onChange={(e) =>
                  setPageForm((current) => ({ ...current, pageType: e.target.value }))
                }
              >
                {PAGE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </StyledSelect>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Description</Label>
              <Textarea
                value={pageForm.description}
                onChange={(e) =>
                  setPageForm((current) => ({ ...current, description: e.target.value }))
                }
                rows={3}
                placeholder="Short public-facing description"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <StyledSelect
                value={pageForm.status}
                onChange={(e) => setPageForm((current) => ({ ...current, status: e.target.value }))}
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="scheduled">Scheduled</option>
                <option value="archived">Archived</option>
              </StyledSelect>
            </div>
            <div className="space-y-1.5">
              <Label>Navigation order</Label>
              <Input
                inputMode="numeric"
                value={pageForm.navOrder}
                onChange={(e) =>
                  setPageForm((current) => ({
                    ...current,
                    navOrder: e.target.value.replace(/[^0-9-]/g, ''),
                  }))
                }
              />
            </div>
            <label className="border-border flex cursor-pointer items-start gap-3 rounded-[8px] border p-3 sm:col-span-2">
              <Checkbox
                checked={pageForm.isListed}
                onCheckedChange={(checked) =>
                  setPageForm((current) => ({ ...current, isListed: checked === true }))
                }
                aria-label="Show page in public navigation where supported"
              />
              <span>
                <span className="text-ink-900 block text-sm font-medium">List this page</span>
                <span className="text-ink-500 mt-0.5 block text-xs">
                  Allow the public navigation system to include this page where its page type is
                  supported.
                </span>
              </span>
            </label>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={closeEditor} disabled={savingPage}>
              Cancel
            </Button>
            <Button onClick={() => void savePage()} loading={savingPage}>
              {editingPage ? 'Save Changes' : 'Create Page'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}

function SettingsTabMount({
  loading,
  error,
  content,
  brand,
  updatedAt,
  onRetry,
  onSaved,
}: {
  loading: boolean;
  error: string | null;
  content: Record<string, unknown> | null;
  brand: Record<string, unknown> | null;
  updatedAt: string | null;
  onRetry: () => void;
  onSaved: (updatedAt: string) => void;
}) {
  if (loading) {
    return (
      <div className="text-ink-500 flex items-center justify-center gap-2 py-16 text-sm">
        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{' '}
        Loading site settings…
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<Settings2 className="h-6 w-6" />}
        title="Could not load site settings"
        description={error}
        action={{ label: 'Retry', onClick: onRetry }}
      />
    );
  }

  if (!content || !brand) {
    return <EmptyState icon={<Settings2 className="h-6 w-6" />} title="No settings available" />;
  }

  return (
    <SiteSettingsTab
      content={content as never}
      brand={brand as never}
      lastUpdatedAt={updatedAt}
      onSaved={onSaved}
    />
  );
}
