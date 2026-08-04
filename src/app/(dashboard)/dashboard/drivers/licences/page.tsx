'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { StyledSelect, StyledDateInput } from '@/components/ui/styled-select';
import {
  Search,
  Loader2,
  AlertCircle,
  RefreshCw,
  ShieldAlert,
  CalendarClock,
  FileSearch,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { ClientFilterReset } from '@/components/ui/client-filter-reset';

type QueueTab =
  | 'pending'
  | 'expiring'
  | 'expired'
  | 'changes_requested'
  | 'rejected'
  | 'approved'
  | 'all';

interface QueueRow {
  licenceId: string;
  version: number;
  isActive: boolean;
  licenceNumber: string;
  licenceClass: string;
  issueDate: string;
  expiryDate: string;
  verificationStatus: string;
  reviewStatus: string;
  daysUntil: number;
  confidence: number | null;
  qualityWarnings: string[];
  createdAt: string;
  employeeId: string;
  driverName: string;
  employeeNumber: string;
  jobTitle: string | null;
  departmentName: string | null;
  officeName: string | null;
  driverStatus: string;
}

interface QueueStats {
  pending: number;
  expiring: number;
  expired: number;
  changes_requested: number;
  rejected: number;
  approved: number;
  total: number;
}

const TABS: Array<{ key: QueueTab; label: string }> = [
  { key: 'pending', label: 'Pending Review' },
  { key: 'expiring', label: 'Expiring Soon' },
  { key: 'expired', label: 'Expired' },
  { key: 'changes_requested', label: 'Changes Requested' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'approved', label: 'Approved' },
  { key: 'all', label: 'All' },
];

function reviewBadge(status: string): { variant: 'success' | 'warning' | 'emergency' | 'error' | 'info' | 'default' | 'pending'; label: string } {
  switch (status) {
    case 'pending':
      return { variant: 'pending', label: 'Pending review' };
    case 'expiring':
      return { variant: 'warning', label: 'Expiring soon' };
    case 'expired':
      return { variant: 'error', label: 'Expired' };
    case 'changes_requested':
      return { variant: 'emergency', label: 'Changes requested' };
    case 'rejected':
      return { variant: 'error', label: 'Rejected' };
    case 'approved':
      return { variant: 'success', label: 'Approved' };
    default:
      return { variant: 'default', label: status.replace(/_/g, ' ') };
  }
}

export default function LicenceVerificationQueuePage() {
  const [tab, setTab] = useState<QueueTab>('pending');
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [licenceClass, setLicenceClass] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const initialLoadRef = useRef(false);

  const fetchQueue = useCallback(
    async (override?: { tab?: QueueTab; page?: number; search?: string }) => {
      const params = new URLSearchParams({
        status: override?.tab ?? tab,
        page: String(override?.page ?? page),
        limit: '15',
      });
      const q = override?.search !== undefined ? override.search : search;
      if (q.trim()) params.set('q', q.trim());
      if (licenceClass) params.set('class', licenceClass);
      if (from) params.set('from', from);
      if (to) params.set('to', to);

      setIsLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/drivers/licences/queue?${params}`, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load licence queue');
        setRows(json.data || []);
        setStats(json.stats || null);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load licence queue');
        setRows([]);
      } finally {
        setIsLoading(false);
      }
    },
    [tab, page, search, licenceClass, from, to],
  );

  useEffect(() => {
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      void fetchQueue();
    }
  }, [fetchQueue]);

  const switchTab = useCallback(
    (next: QueueTab) => {
      setTab(next);
      setPage(1);
      void fetchQueue({ tab: next, page: 1 });
    },
    [fetchQueue],
  );

  const runSearch = useCallback(() => {
    setPage(1);
    void fetchQueue({ page: 1 });
  }, [fetchQueue]);

  const isFiltered = Boolean(search || licenceClass || from || to || tab !== 'pending');

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Drivers', href: '/dashboard/drivers' },
          { label: 'Licence Verification' },
        ]}
      />
      <PageHeader
        title="Licence Verification"
        description="Review driver licence renewals, expiry risk and verification status"
      >
        <Button variant="secondary" size="sm" onClick={() => void fetchQueue()} loading={isLoading}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </PageHeader>

      {/* Summary stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Card>
            <CardContent className="pt-3 pb-3 text-center">
              <p className="text-xl font-[650] tabular-nums text-status-pending-text">{stats.pending}</p>
              <p className="text-[11px] text-ink-500">Pending review</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 text-center">
              <p className="text-xl font-[650] tabular-nums text-status-warning-text">{stats.expiring}</p>
              <p className="text-[11px] text-ink-500">Expiring ≤ 60d</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 text-center">
              <p className="text-xl font-[650] tabular-nums text-status-error-text">{stats.expired}</p>
              <p className="text-[11px] text-ink-500">Expired</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 text-center">
              <p className="text-xl font-[650] tabular-nums text-status-emergency-text">{stats.changes_requested}</p>
              <p className="text-[11px] text-ink-500">Changes requested</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 text-center">
              <p className="text-xl font-[650] tabular-nums text-status-error-text">{stats.rejected}</p>
              <p className="text-[11px] text-ink-500">Rejected</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 text-center">
              <p className="text-xl font-[650] tabular-nums text-status-success-text">{stats.approved}</p>
              <p className="text-[11px] text-ink-500">Approved</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Licence review queue">
        {TABS.map((item) => {
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => switchTab(item.key)}
              className={`focus-ring rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'bg-brand-600 text-white'
                  : 'border-border bg-surface text-ink-600 hover:border-brand-200 hover:text-ink-950'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Search driver, employee number, licence number…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch();
                }}
                className="pl-9"
              />
            </div>
            <div className="w-36">
              <StyledSelect
                value={licenceClass}
                onChange={(e) => setLicenceClass(e.target.value)}
                aria-label="Licence class filter"
              >
                <option value="">All classes</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="C1">C1</option>
                <option value="EB">EB</option>
                <option value="EC">EC</option>
                <option value="CE">CE</option>
                <option value="A">A</option>
              </StyledSelect>
            </div>
            <div className="w-40">
              <StyledDateInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Expiry from" />
            </div>
            <div className="w-40">
              <StyledDateInput type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Expiry to" />
            </div>
            <Button variant="secondary" size="sm" onClick={runSearch}>
              Apply filters
            </Button>
            <ClientFilterReset
              isFiltered={isFiltered}
              onClear={() => {
                setSearch('');
                setLicenceClass('');
                setFrom('');
                setTo('');
                setTab('pending');
                setPage(1);
                void fetchQueue({ tab: 'pending', page: 1 });
              }}
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="pt-4">
            <div className="text-status-error-text flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              <p className="text-sm">{error}</p>
              <Button variant="secondary" size="sm" className="ml-auto" onClick={() => void fetchQueue()}>
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="text-ink-400 h-6 w-6 animate-spin" />
        </div>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col items-center py-12 text-center">
              <FileSearch className="text-ink-300 mb-3 h-10 w-10" />
              <p className="text-ink-700 text-sm font-medium">No licence records match this view</p>
              <p className="text-ink-500 mt-1 text-xs">
                Renewals submitted by drivers appear here for Transport Administration review.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row) => {
            const badge = reviewBadge(row.reviewStatus);
            return (
              <Link key={row.licenceId} href={`/dashboard/drivers/licences/${row.licenceId}`} className="block">
                <Card hover>
                  <CardContent className="py-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="bg-brand-50 text-brand-700 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold">
                          {row.driverName.split(' ').map((part) => part.charAt(0)).join('').slice(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-ink-950 truncate text-sm font-medium">{row.driverName}</p>
                            <StatusBadge status={badge.variant} label={badge.label} />
                            {!row.isActive && <Badge variant="default" size="sm">Superseded</Badge>}
                          </div>
                          <div className="text-ink-500 mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                            <span>{row.employeeNumber}</span>
                            {row.departmentName && <span className="max-w-full truncate">{row.departmentName}</span>}
                            {row.officeName && <span className="max-w-full truncate">{row.officeName}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-4">
                        <div className="text-right">
                          <p className="text-sm font-semibold text-ink-950">
                            Class {row.licenceClass} <span className="font-normal text-ink-500">· v{row.version}</span>
                          </p>
                          <p className="text-ink-500 mt-0.5 text-xs">{row.licenceNumber}</p>
                        </div>
                        <div className="text-right">
                          <Badge
                            variant={row.daysUntil < 0 ? 'error' : row.daysUntil <= 60 ? 'warning' : 'success'}
                            size="sm"
                            className="gap-1"
                          >
                            {row.daysUntil < 0 ? <ShieldAlert className="h-3 w-3" /> : <CalendarClock className="h-3 w-3" />}
                            {row.daysUntil < 0
                              ? `Expired ${Math.abs(row.daysUntil)}d ago`
                              : row.daysUntil === 0
                                ? 'Expires today'
                                : `Expires in ${row.daysUntil}d`}
                          </Badge>
                          <p className="text-ink-400 mt-0.5 text-[10px]">{row.expiryDate}</p>
                        </div>
                        <div className="text-right">
                          {row.confidence !== null && (
                            <Badge variant="info" size="sm">
                              OCR {row.confidence}%
                            </Badge>
                          )}
                          {row.qualityWarnings.length > 0 && (
                            <p className="text-status-warning-text mt-0.5 text-[10px]">
                              {row.qualityWarnings.length} warning{row.qualityWarnings.length === 1 ? '' : 's'}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-ink-500 text-xs">
            {total} record{total === 1 ? '' : 's'} · Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                const next = page - 1;
                setPage(next);
                void fetchQueue({ page: next });
              }}
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => {
                const next = page + 1;
                setPage(next);
                void fetchQueue({ page: next });
              }}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
