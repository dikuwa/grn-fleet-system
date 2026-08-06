'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchWithRetry } from '@/lib/fetch-with-retry';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';

import { StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import {
  User,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Loader2,
  Search,
  Download,
  Clock,
  Shield,
  Bell,
  BellOff,
  Mail,
  Ban,
} from 'lucide-react';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExpiringLicence {
  licenceId: string;
  driverName: string;
  employeeNumber: string;
  employeeId: string;
  licenceClass: string;
  licenceNumber: string;
  expiryDate: string;
  verificationStatus: string;
  daysUntilExpiry: number;
  isExpired: boolean;
  department: string | null;
  notifiedToday: boolean;
  emailSent: boolean;
}

interface CronRunSummary {
  checked: number;
  notificationsCreated: number;
  alreadyNotified: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return new Intl.DateTimeFormat('en-NA', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(d);
}

function getStatusVariant(isExpired: boolean, days: number): 'error' | 'emergency' | 'success' {
  if (isExpired) return 'error';
  if (days <= 7) return 'error';
  if (days <= 14) return 'emergency';
  return 'success';
}

function getStatusLabel(isExpired: boolean, days: number): string {
  if (isExpired) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  return `${days} days remaining`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LicenceExpiryReportPage() {
  const [licences, setLicences] = useState<ExpiringLicence[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'expired' | 'expiring'>('all');
  const [cronRunning, setCronRunning] = useState(false);
  const [cronResult, setCronResult] = useState<CronRunSummary | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const mountedRef = useRef(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetchWithRetry('/api/reports/licence-expiry');
      if (!res.ok) throw new Error('Failed to load licence expiry data');
      const json = await res.json();
      setLicences(json.licences ?? []);
      setLastRun(json.lastCronRun ?? null);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      fetchData();
    }
  }, [fetchData]);

  const handleRunCron = useCallback(async () => {
    setCronRunning(true);
    setCronResult(null);
    try {
      const res = await fetch('/api/reports/licence-expiry/run-cron', {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Cron check failed');
      const json = await res.json();
      setCronResult({
        checked: json.checked ?? 0,
        notificationsCreated: json.notificationsCreated ?? 0,
        alreadyNotified: json.alreadyNotified ?? 0,
      });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cron check failed');
    } finally {
      setCronRunning(false);
    }
  }, [fetchData]);

  // Derived: filtered list (useMemo so it's available before callbacks)
  const filtered = useMemo(() => licences.filter((l) => {
    if (filter === 'expired' && !l.isExpired) return false;
    if (filter === 'expiring' && l.isExpired) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        l.driverName.toLowerCase().includes(q) ||
        l.licenceNumber.toLowerCase().includes(q) ||
        l.employeeNumber.toLowerCase().includes(q) ||
        (l.department ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  }), [licences, filter, search]);

  const handleExport = useCallback(() => {
    const rows = filtered.map((l) => ({
      Driver: l.driverName,
      'Employee No': l.employeeNumber,
      'Licence Class': l.licenceClass,
      'Licence Number': l.licenceNumber,
      'Expiry Date': formatDate(l.expiryDate),
      Status: l.isExpired ? 'Expired' : `${l.daysUntilExpiry} days`,
      'Verification': l.verificationStatus,
      'Department': l.department ?? '\u2014',
      'Notified': l.notifiedToday ? 'Yes' : 'No',
      'Email Sent': l.emailSent ? 'Yes' : 'No',
    }));
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map((r) => headers.map((h) => `"${String(r[h as keyof typeof r]).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `licence-expiry-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  const expiredCount = licences.filter((l) => l.isExpired).length;
  const expiringCount = licences.filter((l) => !l.isExpired).length;
  const notifiedCount = licences.filter((l) => l.notifiedToday).length;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Reports & Analytics', href: '/dashboard/reports' },
        { label: 'Licence Expiry Report' },
      ]} />
      <PageHeader
        title="Licence Expiry Report"
        description="Driver licence expiry monitoring, notifications, and automated alerts"
      >
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRunCron}
            loading={cronRunning}
          >
            <RefreshCw className={`h-4 w-4 ${cronRunning ? 'animate-spin' : ''}`} />
            {cronRunning ? 'Checking...' : 'Run Expiry Check'}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/expiry-alerts">
              <Shield className="h-4 w-4" />
              Full Alerts
            </Link>
          </Button>
        </div>
      </PageHeader>

      {/* Cron result banner */}
      {cronResult && (
        <div className="rounded-lg border border-status-success-border bg-status-success-bg px-4 py-3 text-sm flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success-text" />
          <span className="text-ink-700 font-medium">
            Expiry check completed &mdash; {cronResult.notificationsCreated} new notification{cronResult.notificationsCreated !== 1 ? 's' : ''} created,
            {' '}{cronResult.alreadyNotified} already notified today
          </span>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Expiring"
          value={String(licences.length)}
          description="Within 30 days"
          icon={<AlertTriangle className="h-5 w-5" />}
          trend={{ value: licences.length === 0 ? 'All clear' : `${expiredCount} expired`, positive: licences.length === 0 }}
        />
        <StatCard
          title="Expired"
          value={String(expiredCount)}
          description="Requires immediate action"
          icon={<Ban className="h-5 w-5" />}
          trend={{ value: expiredCount > 0 ? 'Action required' : 'None', positive: expiredCount === 0 }}
        />
        <StatCard
          title="Expiring Soon"
          value={String(expiringCount)}
          description="Within 30 days"
          icon={<Clock className="h-5 w-5" />}
          trend={{ value: expiringCount > 0 ? 'Reminder needed' : 'Up to date', positive: expiringCount === 0 }}
        />
        <StatCard
          title="Notified Today"
          value={String(notifiedCount)}
          description={`of ${licences.length} affected drivers`}
          icon={<Bell className="h-5 w-5" />}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
        <div className="relative max-w-xs flex-1">
          <Search className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search driver, licence, or department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          {(['all', 'expired', 'expiring'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-brand-800 text-white'
                  : 'text-ink-500 hover:text-ink-700 hover:bg-muted'
              }`}
            >
              {f === 'all' ? 'All' : f === 'expired' ? 'Expired' : 'Expiring'}
            </button>
          ))}
        </div>
        {lastRun && (
          <span className="ml-auto text-[11px] text-ink-400">
            Last cron run: {formatDate(lastRun)}
          </span>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-status-error-border bg-status-error-bg px-4 py-3 text-sm text-status-error-text">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p className="flex-1">{error}</p>
          <Button variant="secondary" size="compact" onClick={fetchData}>
            <RefreshCw className="h-3 w-3" /> Retry
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center py-12 text-center rounded-lg border border-dashed border-border">
          <Shield className="text-status-success-text mb-3 h-10 w-10" />
          <p className="text-ink-700 text-sm font-medium">No licences expiring</p>
          <p className="text-ink-500 mt-1 text-xs">
            All driver licences are valid for at least 30 days.
          </p>
        </div>
      )}

      {/* Licence list */}
      {!isLoading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((l) => (
            <Link
              key={l.licenceId}
              href={`/dashboard/drivers/${l.employeeId}`}
              className="block"
            >
              <div className="rounded-lg border border-border bg-card p-3 transition-colors hover:border-brand-100 hover:bg-brand-50/20">
                <div className="flex items-center justify-between gap-4">
                  {/* Left: driver info */}
                  <div className="flex min-w-0 items-center gap-3 flex-1">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      l.isExpired
                        ? 'bg-status-error-bg text-status-error-text'
                        : 'bg-status-emergency-bg text-status-emergency-text'
                    }`}>
                      <User className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-ink-950 truncate text-sm font-medium">
                          {l.driverName}
                        </p>
                        <StatusBadge
                          status={getStatusVariant(l.isExpired, l.daysUntilExpiry)}
                          label={getStatusLabel(l.isExpired, l.daysUntilExpiry)}
                        />
                      </div>
                      <div className="text-ink-500 mt-0.5 flex items-center gap-2 text-xs flex-wrap">
                        <span>{l.employeeNumber}</span>
                        <span className="text-ink-300">&middot;</span>
                        <span>Class {l.licenceClass}</span>
                        <span className="text-ink-300">&middot;</span>
                        <span>{l.licenceNumber}</span>
                        {l.department && (
                          <>
                            <span className="text-ink-300">&middot;</span>
                            <span>{l.department}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: expiry + notification status */}
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-ink-500">Expires</p>
                      <p className={`text-sm font-medium ${
                        l.isExpired ? 'text-status-error-text' : 'text-ink-950'
                      }`}>
                        {formatDate(l.expiryDate)}
                      </p>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      {l.notifiedToday ? (
                        <div className="flex items-center gap-1 text-status-success-text" title="Notified today">
                          <Bell className="h-3.5 w-3.5" />
                          <span className="text-[10px] font-medium">Sent</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-ink-300" title="Not yet notified">
                          <BellOff className="h-3.5 w-3.5" />
                        </div>
                      )}
                      {l.emailSent && (
                        <div className="flex items-center gap-1 text-status-success-text" title="Email sent">
                          <Mail className="h-3.5 w-3.5" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
