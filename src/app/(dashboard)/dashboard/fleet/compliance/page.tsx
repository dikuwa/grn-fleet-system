'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ShieldCheck, AlertTriangle, Clock, CalendarClock,
  Car, ChevronRight, Loader2, RefreshCw, Search,
} from 'lucide-react';
import Link from 'next/link';

interface ComplianceVehicle {
  vehicleId: string;
  licenceNumber: string;
  make: string;
  model: string;
  status: string;
  overallStatus: 'compliant' | 'attention_needed' | 'non_compliant' | 'incomplete';
  expiredCount: number;
  expiringCount: number;
  unknownCount: number;
  items: Array<{
    type: string;
    name: string;
    expiryDate: string | null;
    status: 'valid' | 'expiring_soon' | 'expired' | 'unknown';
    daysRemaining: number | null;
  }>;
}

interface UpcomingExpiry {
  vehicleId: string;
  licenceNumber: string;
  type: string;
  name: string;
  expiryDate: string | null;
  daysRemaining: number | null;
  status: string;
}

export default function CompliancePage() {
  const [vehicles, setVehicles] = useState<ComplianceVehicle[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingExpiry[]>([]);
  const [summary, setSummary] = useState({ total: 0, compliant: 0, attentionNeeded: 0, nonCompliant: 0, incomplete: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const fetched = useRef(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/fleet/compliance');
      if (!res.ok) throw new Error('Failed to load compliance data');
      const json = await res.json();
      setVehicles(json.vehicles || []);
      setUpcoming(json.upcomingExpiries || []);
      setSummary(json.summary || { total: 0, compliant: 0, attentionNeeded: 0, nonCompliant: 0, incomplete: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    fetchData();
  }, [fetchData]);

  const filtered = vehicles.filter((v) => {
    if (filterStatus !== 'all' && v.overallStatus !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      return v.licenceNumber.toLowerCase().includes(q) ||
        v.make.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q);
    }
    return true;
  });

  const overallVariant = (status: string): 'success' | 'error' | 'pending' | 'info' => {
    switch (status) {
      case 'compliant': return 'success';
      case 'non_compliant': return 'error';
      case 'attention_needed': return 'pending';
      default: return 'info';
    }
  };

  const overallLabel = (status: string): string => {
    switch (status) {
      case 'compliant': return 'Compliant';
      case 'non_compliant': return 'Non-Compliant';
      case 'attention_needed': return 'Attention Needed';
      default: return 'Incomplete';
    }
  };

  const statusDot = (itemStatus: string): string => {
    switch (itemStatus) {
      case 'valid': return 'bg-green-500';
      case 'expiring_soon': return 'bg-amber-500';
      case 'expired': return 'bg-red-500';
      default: return 'bg-gray-300';
    }
  };

  const daysLabel = (days: number | null): string => {
    if (days === null) return '—';
    if (days < 0) return `${Math.abs(days)} days overdue`;
    if (days === 0) return 'Expires today';
    return `${days} days remaining`;
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Fleet', href: '/dashboard/fleet' },
        { label: 'Compliance' },
      ]} />
      <PageHeader
        title="Vehicle Compliance"
        description="Track vehicle licences, roadworthy tests, insurance, and expiry status"
      >
        <Button variant="secondary" size="sm" onClick={fetchData} loading={loading}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </PageHeader>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-ink-400" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <AlertTriangle className="h-8 w-8 text-status-error-text" />
          <p className="text-sm text-ink-500">{error}</p>
          <Button variant="secondary" size="sm" onClick={fetchData}>Retry</Button>
        </div>
      ) : vehicles.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8" />}
          title="No compliance data"
          description="No vehicles found. Add vehicles to track their compliance status."
        />
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-4">
            <Card><CardContent className="pt-4">
              <div className="text-center">
                <p className="text-2xl font-[650] tabular-nums text-green-600">{summary.compliant}</p>
                <p className="text-xs text-ink-500">Compliant</p>
              </div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-center">
                <p className="text-2xl font-[650] tabular-nums text-amber-600">{summary.attentionNeeded}</p>
                <p className="text-xs text-ink-500">Attention Needed</p>
              </div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-center">
                <p className="text-2xl font-[650] tabular-nums text-red-600">{summary.nonCompliant}</p>
                <p className="text-xs text-ink-500">Non-Compliant</p>
              </div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-center">
                <p className="text-2xl font-[650] tabular-nums text-gray-500">{summary.incomplete}</p>
                <p className="text-xs text-ink-500">Incomplete</p>
              </div>
            </CardContent></Card>
          </div>

          {/* Upcoming Expiries Alert */}
          {upcoming.filter((u) => u.status === 'expired' || u.status === 'expiring_soon').length > 0 && (
            <Card className="border-amber-200 bg-amber-50/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-800">
                  <Clock className="h-4 w-4" />
                  Upcoming Expiries
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {upcoming.filter((u) => u.status === 'expired' || u.status === 'expiring_soon').slice(0, 10).map((u) => (
                    <div key={`${u.vehicleId}-${u.type}`} className="flex items-center justify-between rounded-lg bg-white px-4 py-2 text-sm">
                      <div className="flex items-center gap-3">
                        <div className={`h-2 w-2 rounded-full ${u.status === 'expired' ? 'bg-red-500' : 'bg-amber-500'}`} />
                        <span className="font-medium text-ink-950">{u.licenceNumber}</span>
                        <span className="text-ink-500">{u.name}</span>
                      </div>
                      <span className={`text-xs font-medium ${u.status === 'expired' ? 'text-red-600' : 'text-amber-600'}`}>
                        {daysLabel(u.daysRemaining)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Filters */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search vehicles..."
                className="h-10 w-full rounded-[8px] border border-border bg-surface pl-9 pr-3 text-sm"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="h-10 rounded-[8px] border border-border bg-surface px-3 text-sm"
            >
              <option value="all">All Status</option>
              <option value="compliant">Compliant</option>
              <option value="attention_needed">Attention Needed</option>
              <option value="non_compliant">Non-Compliant</option>
              <option value="incomplete">Incomplete</option>
            </select>
          </div>

          {/* Vehicle Compliance Cards */}
          <div className="space-y-3">
            {filtered.length === 0 ? (
              <EmptyState icon={<Car className="h-8 w-8" />} title="No matching vehicles" description="Try adjusting your search or filter." />
            ) : (
              filtered.map((v) => (
                <Link key={v.vehicleId} href={`/dashboard/fleet/${v.vehicleId}`} className="block rounded-[10px] border border-border bg-surface p-4 transition-all hover:border-brand-100 hover:shadow-sm">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] ${
                        v.overallStatus === 'compliant' ? 'bg-green-50 text-green-700' :
                        v.overallStatus === 'non_compliant' ? 'bg-red-50 text-red-700' :
                        v.overallStatus === 'attention_needed' ? 'bg-amber-50 text-amber-700' :
                        'bg-gray-50 text-gray-500'
                      }`}>
                        <ShieldCheck className="h-6 w-6" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-[650] text-ink-950">{v.make} {v.model}</p>
                          <Badge variant={overallVariant(v.overallStatus)} size="sm">{overallLabel(v.overallStatus)}</Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-ink-500">{v.licenceNumber}</p>
                        <div className="mt-1.5 flex items-center gap-3">
                          {v.items.map((item) => (
                            <span key={item.type} className="flex items-center gap-1 text-xs" title={daysLabel(item.daysRemaining)}>
                              <span className={`h-1.5 w-1.5 rounded-full ${statusDot(item.status)}`} />
                              <span className="text-ink-500 capitalize">{item.type}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-ink-300 shrink-0" />
                  </div>
                </Link>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
