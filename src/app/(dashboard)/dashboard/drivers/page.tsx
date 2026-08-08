'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { StyledSelect } from '@/components/ui/styled-select';
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  Car,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  User,
} from 'lucide-react';
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

function daysLabel(days: number) {
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
    async (query?: string, status?: StatusFilter, nextPage?: number) => {
      const params = new URLSearchParams({
        status: status ?? filter,
        page: String(nextPage ?? page),
        limit: '25',
      });
      if ((query ?? search).trim()) params.set('q', (query ?? search).trim());
      try {
        const response = await fetch(`/api/drivers?${params}`);
        if (!response.ok) throw new Error('Failed to load drivers');
        const json = await response.json();
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
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    void fetchDrivers();
  }, [fetchDrivers]);

  const handleSearch = useCallback(() => {
    setPage(1);
    void fetchDrivers(search || undefined, filter, 1);
  }, [fetchDrivers, filter, search]);

  const handleFilterChange = useCallback(
    (value: StatusFilter) => {
      setFilter(value);
      setPage(1);
      void fetchDrivers(search || undefined, value, 1);
    },
    [fetchDrivers, search],
  );

  const summary = [
    { label: 'Total', value: stats?.total ?? null, tone: 'text-ink-950' },
    { label: 'Verified Valid', value: stats?.verifiedValid ?? null, tone: 'text-status-success-text' },
    { label: 'Available', value: stats?.available ?? null, tone: 'text-status-success-text' },
    { label: 'Pending Review', value: stats?.pendingVerification ?? null, tone: 'text-status-pending-text', filter: 'pending' as StatusFilter },
    { label: 'Expiring ≤60d', value: stats?.expiring ?? null, tone: 'text-status-warning-text', filter: 'expiring' as StatusFilter },
    { label: 'Expired', value: stats?.expired ?? null, tone: 'text-status-error-text', filter: 'expired' as StatusFilter },
    { label: 'Ineligible', value: stats?.ineligible ?? null, tone: 'text-status-error-text' },
  ];

  const isFiltered = Boolean(search || filter !== 'all');
  const urgentCount = (stats?.expired ?? 0) + (stats?.expiring ?? 0);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Driver Management' }]} />
      <PageHeader title="Driver Management" description="Driver roster, licence verification and assignment eligibility">
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/drivers/licences"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Licence Verification</Link>
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void fetchDrivers()} loading={isLoading}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </Button>
      </PageHeader>

      {stats && urgentCount > 0 && (
        <div role="alert" className="border-status-warning-text/20 bg-status-warning-bg flex flex-col gap-3 rounded-[10px] border px-4 py-3 sm:flex-row sm:items-center">
          <ShieldAlert className="text-status-warning-text h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-ink-950 text-sm font-semibold">
              {stats.expired > 0 ? `${stats.expired} expired licence${stats.expired === 1 ? '' : 's'}` : 'No expired licences'}
              {stats.expiring > 0 ? ` · ${stats.expiring} expiring within 60 days` : ''}
            </p>
            <p className="text-ink-500 mt-0.5 text-xs">Expired or otherwise ineligible licences prevent trip assignment. Verify renewed documents from the licence queue.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {stats.expired > 0 && <Button variant="secondary" size="sm" onClick={() => handleFilterChange('expired')}>Expired</Button>}
            {stats.expiring > 0 && <Button variant="secondary" size="sm" onClick={() => handleFilterChange('expiring')}>Expiring</Button>}
            <Button variant="primary" size="sm" asChild><Link href="/dashboard/drivers/licences">Licence Queue <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link></Button>
          </div>
        </div>
      )}

      <section aria-label="Driver summary" className="border-border grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border bg-border sm:grid-cols-4 xl:grid-cols-7">
        {summary.map((item) => {
          const content = (
            <><p className={`text-xl font-semibold tabular-nums ${item.tone}`}>{item.value ?? '—'}</p><p className="text-ink-500 mt-0.5 text-[11px]">{item.label}</p></>
          );
          return item.filter ? (
            <button key={item.label} type="button" onClick={() => handleFilterChange(item.filter!)} className="focus-ring bg-surface hover:bg-muted/40 min-h-16 px-3 py-3 text-left transition-colors motion-reduce:transition-none" aria-label={`Filter drivers: ${item.label}`}>{content}</button>
          ) : (
            <div key={item.label} className="bg-surface min-h-16 px-3 py-3">{content}</div>
          );
        })}
      </section>

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="driver-search" className="text-ink-500 mb-1 block text-xs font-medium">Search</label>
              <div className="relative">
                <Search className="text-ink-400 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" aria-hidden="true" />
                <Input
                  id="driver-search"
                  placeholder="Name, employee number, licence number or class…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') handleSearch(); }}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="w-full lg:w-56">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Licence status</label>
              <StyledSelect value={filter} onChange={(event) => handleFilterChange(event.target.value as StatusFilter)} aria-label="Licence status filter">
                <option value="all">All drivers</option>
                <option value="expired">Licence expired</option>
                <option value="expiring">Expiring ≤ 60 days</option>
                <option value="valid">Licence valid</option>
                <option value="pending">Pending verification</option>
                <option value="no_licence">No licence on file</option>
              </StyledSelect>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={handleSearch}>Search</Button>
              <ClientFilterReset isFiltered={isFiltered} onClear={() => { setSearch(''); setFilter('all'); setPage(1); void fetchDrivers('', 'all', 1); }} />
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="border-status-error-border bg-status-error-bg text-status-error-text flex flex-wrap items-center gap-2 rounded-[8px] border px-4 py-3" role="alert">
          <AlertCircle className="h-4 w-4" aria-hidden="true" /><p className="text-sm">{error}</p><Button variant="secondary" size="sm" className="ml-auto" onClick={() => void fetchDrivers()}>Retry</Button>
        </div>
      )}

      {isLoading && (
        <div className="text-ink-500 flex items-center justify-center gap-2 py-16 text-sm" role="status"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />Loading drivers…</div>
      )}

      {!isLoading && !error && drivers.length === 0 && (
        <div className="border-border bg-surface rounded-[10px] border px-5 py-12 text-center">
          <Car className="text-ink-300 mx-auto mb-3 h-9 w-9" aria-hidden="true" />
          <p className="text-ink-800 text-sm font-medium">{stats?.total === 0 ? 'No drivers found' : 'No drivers match this filter'}</p>
          <p className="text-ink-500 mt-1 text-xs">{stats?.total === 0 ? 'Mark eligible staff members as drivers in their employee profile.' : 'Adjust or clear the current filters.'}</p>
        </div>
      )}

      {!isLoading && drivers.length > 0 && (
        <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
          {drivers.map((driver) => (
            <Link key={driver.id} href={`/dashboard/drivers/${driver.id}`} className="focus-ring border-border group block border-b p-4 transition-colors last:border-b-0 hover:bg-muted/40 motion-reduce:transition-none sm:p-5">
              <div className="flex items-start gap-3">
                <div className="bg-brand-50 text-brand-700 hidden h-10 w-10 shrink-0 items-center justify-center rounded-[8px] text-xs font-semibold sm:flex">{driver.firstName.charAt(0)}{driver.lastName.charAt(0)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-ink-950 text-sm font-semibold">{driver.firstName} {driver.lastName}</p>
                    <StatusBadge
                      status={driver.driverStatus === 'authorised' ? 'success' : driver.driverStatus === 'suspended' ? 'pending' : 'error'}
                      label={driver.driverStatus.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())}
                    />
                    {driver.pendingVerification && <Badge variant="pending" size="sm">Licence pending review</Badge>}
                  </div>
                  <div className="text-ink-500 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="flex items-center gap-1"><User className="h-3 w-3" aria-hidden="true" />{driver.employeeNumber}</span>
                    {driver.departmentName && <span>{driver.departmentName}</span>}
                    {driver.officeName && <span>{driver.officeName}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {driver.nextExpiry ? (
                      <Badge variant={expiryBadgeVariant(driver.nextExpiry.daysUntil)} size="sm" className="gap-1">
                        {driver.hasExpiredLicence ? <ShieldAlert className="h-3 w-3" aria-hidden="true" /> : <CalendarClock className="h-3 w-3" aria-hidden="true" />}
                        {driver.nextExpiry.licenceClass}: {daysLabel(driver.nextExpiry.daysUntil)}
                      </Badge>
                    ) : driver.licenceCount === 0 ? (
                      <Badge variant="default" size="sm" className="gap-1"><ShieldAlert className="h-3 w-3" aria-hidden="true" />No licence on file</Badge>
                    ) : (
                      <Badge variant="default" size="sm" className="gap-1"><ShieldCheck className="h-3 w-3" aria-hidden="true" />Licence pending</Badge>
                    )}
                    <span className="text-ink-500 text-xs">{driver.activeLicenceCount} active · {driver.licenceCount} total</span>
                  </div>
                </div>
                <ChevronRight className="text-ink-300 group-hover:text-brand-700 mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
              </div>
            </Link>
          ))}
        </div>
      )}

      {!isLoading && totalPages > 1 && (
        <div className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-ink-500 text-xs">{total} driver{total === 1 ? '' : 's'} · Page {page} of {totalPages}</p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => { const next = page - 1; setPage(next); void fetchDrivers(search || undefined, filter, next); }}><ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous</Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => { const next = page + 1; setPage(next); void fetchDrivers(search || undefined, filter, next); }}>Next <ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
