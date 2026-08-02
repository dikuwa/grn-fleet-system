'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { StyledSelect } from '@/components/ui/styled-select';
import { Search, Car, User, Loader2, AlertCircle, RefreshCw, CalendarClock, ShieldAlert, ShieldCheck } from 'lucide-react';
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
}

type ExpiryFilter = 'all' | 'expired' | 'expiring' | 'valid';

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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ExpiryFilter>('all');

  const initialLoadRef = useRef(false);

  const fetchDrivers = useCallback(async (q?: string) => {
    const params = q ? `?q=${encodeURIComponent(q)}` : '';
    try {
      const res = await fetch(`/api/drivers${params}`);
      if (!res.ok) throw new Error('Failed to load drivers');
      const json = await res.json();
      setDrivers(json.success ? json.data : []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load drivers');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      fetchDrivers();
    }
  }, [fetchDrivers]);

  const handleSearch = useCallback(() => {
    fetchDrivers(search || undefined);
  }, [search, fetchDrivers]);

  const filtered = drivers.filter((d) => {
    if (filter === 'all') return true;
    if (filter === 'expired') return d.hasExpiredLicence;
    if (filter === 'expiring') return d.hasExpiringLicence;
    return d.hasValidLicence;
  });

  const expiredCount = drivers.filter((d) => d.hasExpiredLicence).length;
  const expiringCount = drivers.filter((d) => d.hasExpiringLicence).length;
  const validCount = drivers.filter((d) => d.hasValidLicence).length;
  const noLicenceCount = drivers.filter((d) => d.licenceCount === 0).length;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Driver Management' }]}
      />
      <PageHeader title="Driver Management" description="Driver roster with licence expiry monitoring">
        <Button variant="secondary" size="sm" onClick={() => fetchDrivers()} loading={isLoading}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </PageHeader>

      {/* Licence-expiry summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-ink-950">{drivers.length}</p>
            <p className="text-xs text-ink-500">Total Drivers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-error-text">{expiredCount}</p>
            <p className="text-xs text-ink-500">Licences Expired</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-emergency-text">{expiringCount}</p>
            <p className="text-xs text-ink-500">Expiring ≤ 60 days</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-success-text">{validCount}</p>
            <p className="text-xs text-ink-500">Licences Valid</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative max-w-md flex-1">
              <Search className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Search drivers by name or number..."
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
              onChange={(e) => setFilter(e.target.value as ExpiryFilter)}
              aria-label="Licence status filter"
              className="w-44"
            >
              <option value="all">All drivers</option>
              <option value="expired">Licence expired</option>
              <option value="expiring">Expiring ≤ 60 days</option>
              <option value="valid">Licence valid</option>
            </StyledSelect>
            <ClientFilterReset
              isFiltered={Boolean(search) || filter !== 'all'}
              onClear={() => {
                setSearch('');
                setFilter('all');
                fetchDrivers();
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
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="text-ink-400 h-6 w-6 animate-spin" />
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col items-center py-12 text-center">
              <Car className="text-ink-300 mb-3 h-10 w-10" />
              <p className="text-ink-700 text-sm font-medium">
                {drivers.length === 0 ? 'No drivers found' : 'No drivers match this filter'}
              </p>
              <p className="text-ink-500 mt-1 text-xs">
                {drivers.length === 0
                  ? 'Mark staff members as drivers in their employee profile.'
                  : 'Try adjusting your search or licence filter.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((d) => (
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

      {!isLoading && noLicenceCount > 0 && filter === 'all' && (
        <p className="text-ink-500 text-center text-xs">
          {noLicenceCount} driver{noLicenceCount === 1 ? '' : 's'} {noLicenceCount === 1 ? 'has' : 'have'} no licence on file yet.
        </p>
      )}
    </div>
  );
}
