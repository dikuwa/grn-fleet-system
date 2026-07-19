'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Search, Car, User, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import Link from 'next/link';

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
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState<DriverListEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

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

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Driver Management' },
      ]} />
      <PageHeader
        title="Driver Management"
        description="View and manage all registered drivers"
      >
        <Button variant="secondary" size="sm" onClick={() => fetchDrivers()} loading={isLoading}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
              <Input
                placeholder="Search drivers by name or number..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                className="pl-9"
              />
            </div>
            <Button variant="secondary" size="sm" onClick={handleSearch}>
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-status-error-text">
              <AlertCircle className="h-4 w-4" />
              <p className="text-sm">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
        </div>
      )}

      {!isLoading && !error && drivers.length === 0 && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col items-center py-12 text-center">
              <Car className="h-10 w-10 text-ink-300 mb-3" />
              <p className="text-sm font-medium text-ink-700">No drivers found</p>
              <p className="text-xs text-ink-500 mt-1">
                {search ? 'Try adjusting your search term.' : 'Mark staff members as drivers in their employee profile.'}
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
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
                        {d.firstName.charAt(0)}{d.lastName.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-ink-950 truncate">
                            {d.firstName} {d.lastName}
                          </p>
                          <StatusBadge
                            status={d.driverStatus === 'authorised' ? 'success' : d.driverStatus === 'suspended' ? 'pending' : 'error'}
                            label={d.driverStatus.charAt(0).toUpperCase() + d.driverStatus.slice(1)}
                          />
                        </div>
                        <div className="flex items-center gap-3 text-xs text-ink-500 mt-0.5">
                          <span className="flex items-center gap-1"><User className="h-3 w-3" />{d.employeeNumber}</span>
                          {d.departmentName && <span>{d.departmentName}</span>}
                          {d.officeName && <span>{d.officeName}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className={`text-sm font-bold tabular-nums ${d.activeLicenceCount > 0 ? 'text-status-success-text' : 'text-status-error-text'}`}>
                          {d.activeLicenceCount}
                        </p>
                        <p className="text-[10px] text-ink-400">Active Licences</p>
                      </div>
                      <Badge variant="default" size="sm">
                        {d.licenceCount} total
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
