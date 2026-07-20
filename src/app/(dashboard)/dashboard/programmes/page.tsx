'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  CalendarDays, MapPin, Gauge, Plus, Search, Loader2, XCircle,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';

interface ProgrammeActivity {
  id: string;
  title: string;
  description: string | null;
  venue: string | null;
  startDate: string;
  endDate: string;
  estimatedKilometres: number | null;
  requestId: string;
  requestReference: string;
  requestStatus: string;
  requestScope: string;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-NA', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function formatDateShort(d: string) {
  return new Date(d).toLocaleDateString('en-NA', {
    day: 'numeric', month: 'short',
  });
}

// -----------------------------------------------------------------------
// Create Programme Dialog
// -----------------------------------------------------------------------

function CreateProgrammeDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [venue, setVenue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [estimatedKm, setEstimatedKm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setVenue('');
      setStartDate('');
      setEndDate('');
      setEstimatedKm('');
      setError(null);
    }
  }, [open]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !startDate) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/programmes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          venue: venue.trim() || undefined,
          startDate,
          endDate: endDate || undefined,
          estimatedKilometres: estimatedKm ? Number(estimatedKm) : undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create programme');

      // Reset form
      setTitle('');
      setDescription('');
      setVenue('');
      setStartDate('');
      setEndDate('');
      setEstimatedKm('');
      onOpenChange(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create programme');
    } finally {
      setIsSubmitting(false);
    }
  }, [title, description, venue, startDate, endDate, estimatedKm, onOpenChange, onCreated]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Programme of Activities</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label required>Title</Label>
            <Input
              placeholder="e.g. Regional Development Workshop"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <textarea
              className="min-h-[80px] w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200 resize-y"
              placeholder="Describe the activity, objectives, and expected outcomes..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label required>Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label>End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-11"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Venue / Location</Label>
              <Input
                placeholder="e.g. Rundu Town Hall"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Est. Kilometres</Label>
              <Input
                type="number"
                placeholder="e.g. 200"
                value={estimatedKm}
                onChange={(e) => setEstimatedKm(e.target.value)}
                className="h-11"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-[8px] border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              loading={isSubmitting}
              disabled={!title.trim() || !startDate || isSubmitting}
            >
              <Plus className="h-4 w-4" /> Create Programme
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------
// Main Page
// -----------------------------------------------------------------------

export default function ProgrammesPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['programmes', search, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      params.set('page', String(page));
      params.set('limit', '25');

      const res = await fetch(`/api/programmes?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load programmes');
      return json;
    },
  });

  const programmes: ProgrammeActivity[] = data?.data || [];
  const total: number = data?.total || 0;
  const totalPages: number = data?.totalPages || 1;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Programmes of Activities' },
      ]} />
      <PageHeader
        title="Programmes of Activities"
        description={`${total} programme${total !== 1 ? 's' : ''} across all transport requests`}
      >
        <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> New Programme
        </Button>
      </PageHeader>

      <CreateProgrammeDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={() => { refetch(); setPage(1); }}
      />

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <Input
          placeholder="Search programmes..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-9 h-10"
        />
      </div>

      {/* Error state */}
      {error && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-status-error-text">{error instanceof Error ? error.message : 'Failed to load'}</p>
            <Button variant="secondary" size="sm" onClick={() => refetch()} className="mt-2">Retry</Button>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && programmes.length === 0 && (
        <EmptyState
          icon={<CalendarDays className="h-6 w-6" />}
          title={search ? 'No programmes match your search' : 'No programmes yet'}
          description={search ? 'Try a different search term.' : 'Create your first programme of activities to get started.'}
          action={search ? undefined : { label: 'New Programme', onClick: () => setShowCreate(true) }}
        />
      )}

      {/* Programme List */}
      {!isLoading && programmes.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {programmes.map((p) => (
            <Link
              href={`/dashboard/requests/${p.requestId}`}
              className="group rounded-[12px] border border-border bg-surface p-5 hover:border-brand-200 hover:shadow-sm transition-all"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-ink-950 group-hover:text-brand-700 transition-colors truncate">
                    {p.title}
                  </h3>
                  <p className="text-xs text-ink-500 mt-0.5">
                    {p.requestReference}
                  </p>
                </div>
                <Badge variant={
                  p.requestStatus === 'draft' ? 'pending' :
                  p.requestStatus === 'submitted' ? 'info' :
                  p.requestStatus === 'closed' ? 'success' : 'info'
                } size="sm" className="shrink-0">
                  {p.requestStatus.replace(/_/g, ' ')}
                </Badge>
              </div>

              {/* Description */}
              {p.description && (
                <p className="text-xs text-ink-500 line-clamp-2 mb-3">
                  {p.description}
                </p>
              )}

              {/* Details */}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-500">
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5 text-ink-400" />
                  {formatDateShort(p.startDate)}
                  {p.endDate !== p.startDate && (
                    <> — {formatDateShort(p.endDate)}</>
                  )}
                </span>
                {p.venue && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 text-ink-400" />
                    {p.venue}
                  </span>
                )}
                {p.estimatedKilometres && (
                  <span className="flex items-center gap-1">
                    <Gauge className="h-3.5 w-3.5 text-ink-400" />
                    {p.estimatedKilometres} km
                  </span>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                <span className="text-[11px] text-ink-400">
                  {p.requestScope === 'regional' ? 'Regional' : 'National'}
                </span>
                <span className="flex items-center gap-1 text-xs font-medium text-brand-700 opacity-0 group-hover:opacity-100 transition-opacity">
                  View Request <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-500">
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
