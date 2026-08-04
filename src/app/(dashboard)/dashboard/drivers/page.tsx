'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { StyledSelect } from '@/components/ui/styled-select';
import { Search, Car, User, Loader2, AlertCircle, RefreshCw, CalendarClock, ShieldAlert, ShieldCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { ClientFilterReset } from '@/components/ui/client-filter-reset';

interface LicenceExpiry {
  id: string;
  licenceClass: string;
  expiryDate: string;
  daysUntil: number;
}

interface DriverListEntry {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  departmentName: string | null;
  officeName: string | null;
  driverStatus: string;
  licenceCount: number;
  activeLicenceCount: number;
  nextExpiry: LicenceExpiry | null;
  hasExpiredLicence: boolean;
  hasExpiringLicence: boolean;
  hasValidLicence: boolean;
  pendingVerification: boolean;
}

interface DriverStats {
  total: number;
  verifiedValid: number;
  expiring: number;
  expired: number;
  pendingVerification: number;
  ineligible: number;
  available: number;
}

type StatusFilter = 'all' | 'expired' | 'expiring' | 'valid' | 'pending' | 'no_licence';

function daysLabel(days: number): string {
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  return `${days}d remaining`;
}

function expiryBadgeVariant(days: number | null): 'success' | 'warning' | 'emergency' | 'error' | 'default' {
  if (days === null) return 'default';
  if (days < 0) return 'error';
  if (days <= 30) return 'emergency';
  if (days <= 60) return 'warning';
  return 'success';
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState<DriverListEntry[]>([]);
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const initialLoadRef = useRef(false);

  const fetchDrivers = useCallback(
    async (q?: string, status?: StatusFilter, nextPage?: number) => {
      const params = new URLSearchParams({
        status: status ?? filter,
        page: String(nextPage ?? page),
        limit: '25',
      });
      if ((q ?? search).trim()) params.set('q', (q ?? search).trim());
      try {
        const res = await fetch(`/api/drivers?${params}`);
        if (!res.ok) throw new Error('Failed to load drivers');
        const json = await res.json();
        setDrivers(json.data || []);
        setStats(json.stats || null);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 1);
        setError('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load drivers');
        setDrivers([]);
      } finally {
        setIsLoading(false);
      }
    },
    [filter, page, search],
  );

  useEffect(() => {
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      void fetchDrivers();
    }
  }, [fetchDrivers]);

  const handleSearch = useCallback(() => {
    setPage(1);
    void fetchDrivers(search || undefined, filter, 1);
  }, [search, filter, fetchDrivers]);

  const handleFilterChange = useCallback(
    (value: StatusFilter) => {
      setFilter(value);
      setPage(1);
      void fetchDrivers(search || undefined, value, 1);
    },
    [search, fetchDrivers],
  );

  const statsCards: Array<{ label: string; value: number | null; tone?: string }> = [
    { label: 'Total Drivers', value: stats?.total ?? null },
    { label: 'Verified Valid', value: stats?.verifiedValid ?? null, tone: 'text-status-success-text' },
    { label: 'Expiring ≤ 60d', value: stats?.expiring ?? null, tone: 'text-status-emergency-text' },
    { label: 'Expired', value: stats?.expired ?? null, tone: 'text-status-error-text' },
    { label: 'Pending Verification', value: stats?.pendingVerification ?? null, tone: 'text-status-pending-text' },
    { label: 'Ineligible', value: stats?.ineligible ?? null, tone: 'text-status-error-text' },
    { label: 'Available', value: stats?.available ?? null, tone: 'text-status-success-text' },
  ];

  const isFiltered = Boolean(search || filter !== 'all');

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Driver Management' }]}
      />
      <PageHeader title="Driver Management" description="Driver roster with licence expiry monitoring">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/drivers/licences">
              <ShieldCheck className="h-4 w-4" /> Licence Verification
            </Link>
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void fetchDrivers()} loading={isLoading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </PageHeader>

      {/* Server-side summary stats — real tenant values, never zeroed on error */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {statsCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="pt-3 pb-3 text-center">
              <p className={`text-2xl font-[650] tabular-nums ${card.tone ?? 'text-ink-950'}`}>
                {card.value ?? '—'}
              </p>
              <p className="text-[11px] text-ink-500">{card.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative max-w-md flex-1">
              <Search className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Search name, employee number, licence number or class..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch();
                }}
                className="pl-9"
              />
            </div>
            <Button variant="secondary" size="sm" onClick={handleSearch}>
              Search
            </Button>
            <StyledSelect
              value={filter}
              onChange={(e) => handleFilterChange(e.target.value as StatusFilter)}
              aria-label="Licence status filter"
              className="w-44"
            >
              <option value="all">All drivers</option>
              <option value="expired">Licence expired</option>
              <option value="expiring">Expiring ≤ 60 days</option>
              <option value="valid">Licence valid</option>
              <option value="pending">Pending verification</option>
              <option value="no_licence">No licence on file</option>
            </StyledSelect>
            <ClientFilterReset
              isFiltered={isFiltered}
              onClear={() => {
                setSearch('');
                setFilter('all');
                setPage(1);
                void fetchDrivers('', 'all', 1);
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
              <Button variant="secondary" size="sm" className="ml-auto" onClick={() => void fetchDrivers()}>
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

      {!isLoading && !error && drivers.length === 0 && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col items-center py-12 text-center">
              <Car className="text-ink-300 mb-3 h-10 w-10" />
              <p className="text-ink-700 text-sm font-medium">
                {stats?.total === 0 ? 'No drivers found' : 'No drivers match this filter'}
              </p>
              <p className="text-ink-500 mt-1 text-xs">
                {stats?.total === 0
                  ? 'Mark staff members as drivers in their employee profile.'
                  : 'Try adjusting your search or licence filter.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && drivers.length > 0 && (
        <div className="space-y-2">
          {drivers.map((d) => (
            <Link key={d.id} href={`/dashboard/drivers/${d.id}`} className="block">
              <Card hover>
                <CardContent className="py-3.5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="bg-brand-50 text-brand-700 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold">
                        {d.firstName.charAt(0)}
                        {d.lastName.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-ink-950 truncate text-sm font-medium">
                            {d.firstName} {d.lastName}
                          </p>
                          <StatusBadge
                            status={
                              d.driverStatus === 'authorised'
                                ? 'success'
                                : d.driverStatus === 'suspended'
                                  ? 'pending'
                                  : 'error'
                            }
                            label={d.driverStatus.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())}
                          />
                          {d.pendingVerification && (
                            <Badge variant="pending" size="sm">Licence pending review</Badge>
                          )}
                        </div>
                        <div className="text-ink-500 mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {d.employeeNumber}
                          </span>
                          {d.departmentName && <span className="max-w-full break-words sm:truncate">{d.departmentName}</span>}
                          {d.officeName && <span className="max-w-full break-words sm:truncate">{d.officeName}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-4">
                      {d.nextExpiry ? (
                        <Badge variant={expiryBadgeVariant(d.nextExpiry.daysUntil)} size="sm" className="gap-1">
                          {d.hasExpiredLicence ? <ShieldAlert className="h-3 w-3" /> : <CalendarClock className="h-3 w-3" />}
                          {d.nextExpiry.licenceClass}: {daysLabel(d.nextExpiry.daysUntil)}
                        </Badge>
                      ) : d.licenceCount === 0 ? (
                        <Badge variant="default" size="sm" className="gap-1">
                          <ShieldAlert className="h-3 w-3" />
                          No licence on file
                        </Badge>
                      ) : (
                        <Badge variant="default" size="sm" className="gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          Licence pending
                        </Badge>
                      )}
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p
                            className={`text-sm font-bold tabular-nums ${d.activeLicenceCount > 0 ? 'text-status-success-text' : 'text-status-error-text'}`}
                          >
                            {d.activeLicenceCount}
                          </p>
                          <p className="text-ink-400 text-[10px]">Active Licences</p>
                        </div>
                        <Badge variant="default" size="sm">
                          {d.licenceCount} total
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-ink-500 text-xs">
            {total} driver{total === 1 ? '' : 's'} · Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                const next = page - 1;
                setPage(next);
                void fetchDrivers(search || undefined, filter, next);
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
                void fetchDrivers(search || undefined, filter, next);
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
