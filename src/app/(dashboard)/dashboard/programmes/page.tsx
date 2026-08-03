'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ClientFilterReset } from '@/components/ui/client-filter-reset';
import {
  CalendarDays,
  MapPin,
  Gauge,
  Plus,
  Search,
  Loader2,
  ArrowRight,
  Users,
} from 'lucide-react';
import Link from 'next/link';

interface Programme {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  purpose: string | null;
  department: string | null;
  status: string;
  venue: string | null;
  region: string | null;
  startDate: string | null;
  endDate: string | null;
  expectedParticipants: number | null;
  estimatedKilometres: number | null;
  ownerName: string | null;
  departmentName: string | null;
  officeName: string | null;
  regionName: string | null;
  createdAt: string;
}

const STATUS_TABS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'changes_requested', label: 'Changes Requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'published', label: 'Published' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'archived', label: 'Archived' },
  { value: 'completed', label: 'Completed' },
];

const STATUS_VARIANT: Record<string, 'success' | 'pending' | 'info' | 'error' | 'cancelled'> = {
  draft: 'pending',
  submitted: 'info',
  changes_requested: 'pending',
  approved: 'success',
  published: 'success',
  rejected: 'error',
  archived: 'cancelled',
  completed: 'success',
};

function formatDateShort(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-NA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function ProgrammesPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['programmes', search, status, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (status) params.set('status', status);
      params.set('page', String(page));
      params.set('limit', '25');

      const res = await fetch(`/api/programmes?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load programmes');
      return json;
    },
  });

  const programmes: Programme[] = data?.data || [];
  const total: number = data?.total || 0;
  const totalPages: number = data?.totalPages || 1;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Programmes' }]} />
      <PageHeader
        title="Programmes"
        description={`${total} programme${total !== 1 ? 's' : ''} · reusable activities that can be linked to transport requests`}
      >
        <Button variant="primary" size="sm" asChild>
          <Link href="/dashboard/programmes/new">
            <Plus className="h-4 w-4" /> New Programme
          </Link>
        </Button>
      </PageHeader>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_TABS.map((tab) => {
          const active = status === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => {
                setStatus(tab.value);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'bg-brand-800 text-white'
                  : 'bg-muted text-ink-700 hover:bg-border'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search by title, reference, venue, department…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="h-10 pl-9"
          />
        </div>
        <ClientFilterReset
          isFiltered={Boolean(search || status)}
          onClear={() => {
            setSearch('');
            setStatus('');
            setPage(1);
          }}
        />
      </div>

      {/* Error state */}
      {error && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-status-error-text text-sm">
              {error instanceof Error ? error.message : 'Failed to load'}
            </p>
            <Button variant="secondary" size="sm" onClick={() => refetch()} className="mt-2">
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-ink-400 h-6 w-6 animate-spin" />
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && programmes.length === 0 && (
        <EmptyState
          icon={<CalendarDays className="h-6 w-6" />}
          title={search || status ? 'No programmes match your filters' : 'No programmes yet'}
          description={
            search || status
              ? 'No matching records found. Clear filters to view all records.'
              : 'Create a programme of activities, submit it for review, and publish it so it can be linked to transport requests.'
          }
          action={
            search || status ? undefined : { label: 'New Programme', href: '/dashboard/programmes/new' }
          }
        />
      )}

      {/* List */}
      {!isLoading && programmes.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {programmes.map((p) => (
            <Link
              key={p.id}
              href={`/dashboard/programmes/${p.id}`}
              className="group border-border bg-surface hover:border-brand-200 rounded-[12px] border p-5 transition-all hover:shadow-sm"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-ink-950 group-hover:text-brand-700 truncate text-sm font-semibold transition-colors">
                    {p.title}
                  </h3>
                  <p className="text-ink-500 mt-0.5 text-xs">{p.reference}</p>
                </div>
                <Badge
                  variant={STATUS_VARIANT[p.status] ?? 'info'}
                  size="sm"
                  className="shrink-0"
                >
                  {p.status.replace(/_/g, ' ')}
                </Badge>
              </div>

              {p.description && (
                <p className="text-ink-500 mb-3 line-clamp-2 text-xs">{p.description}</p>
              )}

              <div className="text-ink-500 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                <span className="flex items-center gap-1">
                  <CalendarDays className="text-ink-400 h-3.5 w-3.5" />
                  {formatDateShort(p.startDate)}
                  {p.endDate && p.endDate !== p.startDate && (
                    <> — {formatDateShort(p.endDate)}</>
                  )}
                </span>
                {p.venue && (
                  <span className="flex items-center gap-1">
                    <MapPin className="text-ink-400 h-3.5 w-3.5" />
                    {p.venue}
                  </span>
                )}
                {p.expectedParticipants && (
                  <span className="flex items-center gap-1">
                    <Users className="text-ink-400 h-3.5 w-3.5" />
                    {p.expectedParticipants}
                  </span>
                )}
                {p.estimatedKilometres && (
                  <span className="flex items-center gap-1">
                    <Gauge className="text-ink-400 h-3.5 w-3.5" />
                    {p.estimatedKilometres} km
                  </span>
                )}
              </div>

              <div className="border-border mt-4 flex items-center justify-between border-t pt-3">
                <span className="text-ink-400 text-[11px]">
                  {p.ownerName || '—'}
                  {p.departmentName ? ` · ${p.departmentName}` : ''}
                </span>
                <span className="text-brand-700 flex items-center gap-1 text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100">
                  Open <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </Link>
          ))}
        </div>
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
