'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Fuel,
  Truck,
  TrendingUp,
  BarChart3,
  Wrench,
  DollarSign,
  Clock,
  AlertTriangle,
  Download,
  FileText,
  CalendarRange,
  RefreshCw,
  Printer,
  CheckCircle2,
  XCircle,
  MapPin,
  Gauge,
  ClipboardList,
  Wifi,
  WifiOff,
  Loader2,
} from 'lucide-react';

type ReportType =
  | 'fuel'
  | 'fleet'
  | 'trips'
  | 'maintenance'
  | 'requests'
  | 'approvals'
  | 'enhanced';

type TimeRange = '7d' | '30d' | '90d' | '1y' | 'custom';

const reportTypes: { value: ReportType; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'fuel', label: 'Fuel Consumption', icon: <Fuel className="h-4 w-4" />, description: 'Fuel usage, costs, and reimbursement tracking' },
  { value: 'fleet', label: 'Fleet Utilisation', icon: <Truck className="h-4 w-4" />, description: 'Vehicle availability, usage rates, and status distribution' },
  { value: 'trips', label: 'Trip Summary', icon: <Gauge className="h-4 w-4" />, description: 'Trip volumes, distances, durations, and completions' },
  { value: 'maintenance', label: 'Maintenance', icon: <Wrench className="h-4 w-4" />, description: 'Service costs, schedules, and backlog' },
  { value: 'requests', label: 'Transport Requests', icon: <FileText className="h-4 w-4" />, description: 'Request volumes, processing times, and status breakdown' },
  { value: 'approvals', label: 'Approvals', icon: <ClipboardList className="h-4 w-4" />, description: 'Approval turnaround times and workflow metrics' },
  { value: 'enhanced', label: 'Enhanced Analytics', icon: <BarChart3 className="h-4 w-4" />, description: 'Approval detail, vehicle utilisation, fuel efficiency, late returns, rejection metrics' },
];

const timeRanges: { value: TimeRange; label: string }[] = [
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: '90d', label: 'Last Quarter' },
  { value: '1y', label: 'Year to Date' },
  { value: 'custom', label: 'Custom Range' },
];

// ---------------------------------------------------------------------------
// Bar chart component
// ---------------------------------------------------------------------------
function BarChart({ data, bars, height = 200 }: {
  data: Record<string, string | number>[];
  bars: { key: string; color: string; label: string }[];
  height?: number;
}) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-xs text-ink-400">No data available for this period.</p>;
  }

  const maxVal = Math.max(
    ...data.flatMap((d) => bars.map((b) => Number(d[b.key]) || 0)),
  );

  return (
    <div className="flex items-end gap-3" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col items-center justify-end h-full gap-1">
          <div className="flex flex-col items-center gap-0.5 w-full" style={{ minHeight: 0 }}>
            {bars.map((b) => {
              const val = Number(d[b.key]) || 0;
              const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
              return (
                <div
                  key={b.key}
                  className="w-full rounded-t-[3px] transition-all hover:opacity-80"
                  style={{
                    height: `${Math.max(pct * 0.75, bars.length > 1 ? 12 : 20)}px`,
                    backgroundColor: b.color,
                    minHeight: bars.length > 1 ? 10 : 20,
                  }}
                  title={`${b.label}: ${val}`}
                />
              );
            })}
          </div>
          <span className="text-[10px] text-ink-500 text-center mt-1">{d.label || d.month || ''}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(n: number | string): string {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(v)) return 'N$ 0';
  return `N$ ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatLitres(n: number | string): string {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(v)) return '0 L';
  return `${v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L`;
}

/** Fetch report data from API */
async function fetchReportData(type: ReportType, period: TimeRange) {
  const url = type === 'enhanced'
    ? `/api/reports/enhanced?period=${period}`
    : `/api/reports?type=${type}&period=${period}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  if (json.success && json.data) return json.data;
  return null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReportsPage() {
  const [selectedReport, setSelectedReport] = useState<ReportType>('fuel');
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [reportData, setReportData] = useState<Record<string, unknown> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const fetchedRef = useRef<{ type: ReportType; range: TimeRange } | null>(null);

  // Fetch data when report type or time range changes
  useEffect(() => {
    const key = { type: selectedReport, range: timeRange };
    if (
      fetchedRef.current &&
      fetchedRef.current.type === key.type &&
      fetchedRef.current.range === key.range
    ) {
      return; // Already fetched for this combo
    }

    setIsLoading(true);
    fetchedRef.current = key;

    fetchReportData(selectedReport, timeRange).then((data) => {
      // Only apply if this is still the active request
      if (fetchedRef.current?.type === selectedReport && fetchedRef.current?.range === timeRange) {
        setReportData(data);
        setIsLoading(false);
      }
    });
  }, [selectedReport, timeRange]);

  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    fetchedRef.current = { type: selectedReport, range: timeRange };
    const data = await fetchReportData(selectedReport, timeRange);
    setReportData(data);
    setIsLoading(false);
  }, [selectedReport, timeRange]);

  const handleExport = useCallback(() => {
    // Navigate to the report data as CSV by calling the API with ?export=csv
    window.open(`/api/reports?type=${selectedReport}&period=${timeRange}&export=csv`, '_blank');
  }, [selectedReport, timeRange]);

  const activeReport = reportTypes.find((r) => r.value === selectedReport);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Reports & Analytics' },
      ]} />
      <PageHeader
        title="Reports & Analytics"
        description="KPI dashboards, operational reports, and data exports"
      >
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            reportData ? 'bg-status-success-bg text-status-success-text' : 'bg-muted text-ink-500'
          }`}>
            {reportData ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {reportData ? 'Live Data' : 'No Data'}
          </div>
          <Button variant="secondary" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.open(`/api/reports?type=${selectedReport}&period=${timeRange}&export=excel`, '_blank')}>
            <Download className="h-4 w-4" />
            Export Excel
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.open(`/api/reports?type=${selectedReport}&period=${timeRange}&export=pdf`, '_blank')}>
            <FileText className="h-4 w-4" />
            Export PDF
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
      </PageHeader>

      {/* Report Type Selector */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-2">
            {reportTypes.map((r) => (
              <button
                key={r.value}
                onClick={() => setSelectedReport(r.value)}
                className={`inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-sm font-medium transition-colors ${
                  selectedReport === r.value
                    ? 'bg-brand-800 text-white'
                    : 'bg-muted text-ink-700 hover:bg-border'
                }`}
              >
                {r.icon}
                {r.label}
              </button>
            ))}
          </div>
          {activeReport && (
            <p className="mt-2 text-xs text-ink-500">{activeReport.description}</p>
          )}
        </CardContent>
      </Card>

      {/* Time Range & Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-ink-500" />
          <div className="flex gap-1">
            {timeRanges.map((tr) => (
              <button
                key={tr.value}
                onClick={() => setTimeRange(tr.value)}
                className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${
                  timeRange === tr.value
                    ? 'bg-brand-800 text-white'
                    : 'text-ink-500 hover:text-ink-700 hover:bg-muted'
                }`}
              >
                {tr.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="compact" onClick={handleRefresh} loading={isLoading}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
        </div>
      )}

      {/* ============================== FUEL ============================== */}
      {!isLoading && selectedReport === 'fuel' && (
        <ReportFuel data={reportData as Record<string, unknown> | null} />
      )}

      {/* ============================== FLEET ============================== */}
      {!isLoading && selectedReport === 'fleet' && (
        <ReportFleet data={reportData as Record<string, unknown> | null} />
      )}

      {/* ============================== TRIPS ============================== */}
      {!isLoading && selectedReport === 'trips' && (
        <ReportTrips data={reportData as Record<string, unknown> | null} />
      )}

      {/* ============================== MAINTENANCE ============================== */}
      {!isLoading && selectedReport === 'maintenance' && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Maintenance History</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 text-xs font-medium text-ink-500 uppercase tracking-wider">Service Type</th>
                      <th className="text-right py-2 px-2 text-xs font-medium text-ink-500 uppercase tracking-wider">Events</th>
                      <th className="text-right py-2 px-2 text-xs font-medium text-ink-500 uppercase tracking-wider">Total Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const d = reportData as { maintenanceStats?: Array<{ totalEvents: number; totalCost: string; serviceType: string }> } | null;
                      const stats = d?.maintenanceStats;
                      if (!stats || stats.length === 0) {
                        return (
                          <tr><td colSpan={3} className="py-8 text-center text-xs text-ink-400">No maintenance data for this period.</td></tr>
                        );
                      }
                      return stats.map((item, i) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-muted/50">
                          <td className="py-2.5 px-2 font-medium text-ink-950 capitalize">{item.serviceType}</td>
                          <td className="py-2.5 px-2 text-right text-ink-700">{item.totalEvents}</td>
                          <td className="py-2.5 px-2 text-right text-ink-700">{formatCurrency(item.totalCost)}</td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ============================== REQUESTS ============================== */}
      {!isLoading && selectedReport === 'requests' && (
        <ReportRequests data={reportData as Record<string, unknown> | null} />
      )}

      {/* ============================== APPROVALS ============================== */}
      {!isLoading && selectedReport === 'approvals' && (
        <ReportApprovals data={reportData as Record<string, unknown> | null} />
      )}

      {/* ============================== ENHANCED ANALYTICS ============================== */}
      {!isLoading && selectedReport === 'enhanced' && (
        <ReportEnhanced data={reportData as Record<string, unknown> | null} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fuel Report Section
// ---------------------------------------------------------------------------
function ReportFuel({ data }: { data: Record<string, unknown> | null }) {
  const summary = data?.summary as { totalLitres: string; totalAmount: string; transactionCount: number; avgCostPerLitre: string } | undefined;
  const topConsumers = data?.topConsumers as Array<{ vehicleId: string; licenceNumber: string; litres: string; amount: string }> | undefined;
  const reimbursements = data?.reimbursements as { totalPending: number; totalAmount: string } | undefined;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Fuel Used" value={summary ? formatLitres(summary.totalLitres) : '—'} description="All vehicles" icon={<Fuel className="h-5 w-5" />} />
        <StatCard title="Total Cost" value={summary ? formatCurrency(summary.totalAmount) : '—'} description="All payment methods" icon={<DollarSign className="h-5 w-5" />} />
        <StatCard title="Avg. Cost/Litre" value={summary ? formatCurrency(summary.avgCostPerLitre) : '—'} description="Weighted average" icon={<TrendingUp className="h-5 w-5" />} />
        <StatCard title="Pending Reimbursements" value={reimbursements ? String(reimbursements.totalPending) : '0'} description={reimbursements ? formatCurrency(reimbursements.totalAmount) : '—'} icon={<Clock className="h-5 w-5" />} />
      </div>

      <Card>
        <CardHeader><CardTitle>Top Fuel Consumers</CardTitle></CardHeader>
        <CardContent>
          {!topConsumers || topConsumers.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-400">No fuel transactions for this period.</p>
          ) : (
            <div className="space-y-3">
              {topConsumers.map((item, i) => (
                <div key={item.vehicleId} className="flex items-center justify-between rounded-[8px] border border-border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-950 truncate">{item.licenceNumber}</p>
                    <div className="flex gap-4 mt-1">
                      <span className="text-xs text-ink-500">{formatLitres(item.litres)}</span>
                      <span className="text-xs text-ink-500">{formatCurrency(item.amount)}</span>
                    </div>
                  </div>
                  <div className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: i === 0 ? '#dc2626' : i === 1 ? '#ea580c' : i === 2 ? '#ca8a04' : '#2563eb' }}>
                    {i + 1}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fleet Report Section
// ---------------------------------------------------------------------------
function ReportFleet({ data }: { data: Record<string, unknown> | null }) {
  const statusDistribution = data?.statusDistribution as Array<{ status: string; count: number }> | undefined;
  const totalVehicles = (data?.totalVehicles as number) ?? 0;

  if (!totalVehicles) {
    return (
      <Card>
        <CardContent><p className="py-8 text-center text-xs text-ink-400">No fleet data available.</p></CardContent>
      </Card>
    );
  }

  const distribution = statusDistribution ?? [];
  const available = distribution.find((d) => d.status === 'available')?.count ?? 0;
  const onTrip = distribution.find((d) => d.status === 'allocated' || d.status === 'issued')?.count ?? 0;
  const maintenance = distribution.find((d) => d.status === 'maintenance')?.count ?? 0;
  const outOfService = distribution.find((d) => d.status === 'out_of_service')?.count ?? 0;

  const barItems = [
    { status: 'Available', count: available, pct: totalVehicles > 0 ? Math.round((available / totalVehicles) * 100) : 0, color: '#16a34a' },
    { status: 'On Trip', count: onTrip, pct: totalVehicles > 0 ? Math.round((onTrip / totalVehicles) * 100) : 0, color: '#2563eb' },
    { status: 'Maintenance', count: maintenance, pct: totalVehicles > 0 ? Math.round((maintenance / totalVehicles) * 100) : 0, color: '#ca8a04' },
    { status: 'Out of Service', count: outOfService, pct: totalVehicles > 0 ? Math.round((outOfService / totalVehicles) * 100) : 0, color: '#dc2626' },
  ].filter((b) => b.count > 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Vehicles" value={String(totalVehicles)} description="All active fleet" icon={<Truck className="h-5 w-5" />} />
        <StatCard title="Available" value={String(available)} description={`${totalVehicles > 0 ? Math.round((available / totalVehicles) * 100) : 0}% of fleet`} icon={<CheckCircle2 className="h-5 w-5" />} trend={{ value: available > 0 ? `${Math.round((available / totalVehicles) * 100)}% availability` : 'No available vehicles', positive: available > 0 }} />
        <StatCard title="On Trip" value={String(onTrip)} description="Currently deployed" icon={<MapPin className="h-5 w-5" />} />
        <StatCard title="In Maintenance" value={String(maintenance + outOfService)} description={`${maintenance} scheduled, ${outOfService} out of service`} icon={<Wrench className="h-5 w-5" />} trend={{ value: maintenance > 0 ? 'Requires attention' : 'All vehicles operational', positive: maintenance === 0 }} />
      </div>

      <Card>
        <CardHeader><CardTitle>Status Distribution</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {barItems.map((item) => (
              <div key={item.status} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-700">{item.status}</span>
                  <span className="font-medium text-ink-950">{item.count} ({item.pct}%)</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${item.pct}%`, backgroundColor: item.color }} />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trips Report Section
// ---------------------------------------------------------------------------
function ReportTrips({ data }: { data: Record<string, unknown> | null }) {
  const tripStats = data?.tripStats as Array<{ totalTrips: number; status: string }> | undefined;

  const stats = tripStats ?? [];
  const total = stats.reduce((s, t) => s + t.totalTrips, 0);
  const pending = stats.find((s) => s.status === 'pending')?.totalTrips ?? 0;
  const inProgress = stats.find((s) => s.status === 'in_progress')?.totalTrips ?? 0;
  const closed = stats.find((s) => s.status === 'closed')?.totalTrips ?? 0;
  const other = total - pending - inProgress - closed;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Trips" value={String(total)} description="Current period" icon={<Gauge className="h-5 w-5" />} />
        <StatCard title="In Progress" value={String(inProgress)} description="Active right now" icon={<Clock className="h-5 w-5" />} />
        <StatCard title="Completed" value={String(closed)} description={total > 0 ? `${Math.round((closed / total) * 100)}% completion` : '—'} icon={<CheckCircle2 className="h-5 w-5" />} />
        <StatCard title="Pending / Other" value={String(pending + other)} description="Awaiting action" icon={<AlertTriangle className="h-5 w-5" />} />
      </div>

      <Card>
        <CardHeader><CardTitle>Status Breakdown</CardTitle></CardHeader>
        <CardContent>
          {stats.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-400">No trips for this period.</p>
          ) : (
            <div className="space-y-3">
              {stats.map((s) => (
                <div key={s.status} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-700 capitalize">{s.status.replace(/_/g, ' ')}</span>
                    <span className="font-medium text-ink-950">{s.totalTrips} ({total > 0 ? Math.round((s.totalTrips / total) * 100) : 0}%)</span>
                  </div>                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full transition-all bg-brand-600"                    style={{ width: `${total > 0 ? (s.totalTrips / total) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approval Analytics Section
// ---------------------------------------------------------------------------
function ReportApprovals({ data }: { data: Record<string, unknown> | null }) {
  const avgApprovalTime = (data?.avgApprovalTime as number) ?? 0;
  const totalActions = (data?.totalActions as number) ?? 0;
  const totalWorkflows = (data?.totalWorkflows as number) ?? 0;
  const approvalRate = (data?.approvalRate as Array<{ result: string; count: number }>) ?? [];
  const stepsHistogram = (data?.stepsHistogram as Array<{ stepOrder: number; count: number }>) ?? [];

  const approved = approvalRate.find((r) => r.result === 'approved')?.count ?? 0;
  const rejected = approvalRate.find((r) => r.result === 'rejected')?.count ?? 0;
  const returned = approvalRate.find((r) => r.result === 'returned')?.count ?? 0;
  const totalApprovalRate = totalActions > 0 ? Math.round((approved / totalActions) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Avg. Approval Time" value={avgApprovalTime > 0 ? `${Math.round(avgApprovalTime)} hrs` : '—'} description="Across all workflows" icon={<Clock className="h-5 w-5" />} />
        <StatCard title="Total Actions" value={String(totalActions)} description="All action types" icon={<ClipboardList className="h-5 w-5" />} />
        <StatCard title="Workflows" value={String(totalWorkflows)} description="Affected workflows" icon={<FileText className="h-5 w-5" />} />
        <StatCard title="Approval Rate" value={`${totalApprovalRate}%`} description={`${approved} approved, ${rejected} rejected, ${returned} returned`} icon={<TrendingUp className="h-5 w-5" />} trend={{ value: totalApprovalRate >= 60 ? 'Above target (60%)' : 'Below target (60%)', positive: totalApprovalRate >= 60 }} />
      </div>

      {/* Approval Rate Breakdown */}
      {approvalRate.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Action Breakdown</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {approvalRate.map((r) => {
                const pct = totalActions > 0 ? Math.round((r.count / totalActions) * 100) : 0;
                const color =
                  r.result === 'approved' ? '#16a34a' :
                  r.result === 'rejected' ? '#dc2626' :
                  r.result === 'returned' ? '#ca8a04' :
                  '#2563eb';
                return (
                  <div key={r.result} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-ink-700 capitalize">{r.result}</span>
                      <span className="font-medium text-ink-950">{r.count} ({pct}%)</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Steps Histogram */}
      {stepsHistogram.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Actions per Step</CardTitle></CardHeader>
          <CardContent>
            <BarChart
              data={stepsHistogram.map((s) => ({ step: `Step ${s.stepOrder}`, count: s.count }))}
              bars={[{ key: 'count', color: '#2563eb', label: 'Actions' }]}
              height={180}
            />
          </CardContent>
        </Card>
      )}

      {totalActions === 0 && (
        <Card>
          <CardContent>
            <p className="py-8 text-center text-xs text-ink-400">
              No approval actions recorded for this period. Workflow actions appear once approvals are processed.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enhanced Analytics Section
// ---------------------------------------------------------------------------
function ReportEnhanced({ data }: { data: Record<string, unknown> | null }) {
  const enhanced = data as Record<string, unknown> | null;
  const approvalTurnaround = enhanced?.approvalTurnaround as
    | { avgTotalHours: number; totalActions: number; completedWorkflows: number; stepDurations: Array<{ stepOrder: number; avgHours: number }>; monthlyTrend: Array<{ month: string; avgHours: number; actionCount: number }> }
    | undefined;
  const vehicleUtilisation = enhanced?.vehicleUtilisation as
    | { totalVehicles: number; avgUtilisation: number; totalUtilisedHours: number; underUtilisedCount: number; underUtilisedVehicles: Array<{ licenceNumber: string; totalTrips: number; totalTripHours: number; utilisationPct: number }>; vehicleBreakdown: Array<{ licenceNumber: string; totalTrips: number; totalTripHours: number; utilisationPct: number }> }
    | undefined;
  const fuelEfficiency = enhanced?.fuelEfficiency as
    | { fleetAvgKmPerLitre: number | null; totalLitres: number; totalDistance: number; totalFuelCost: number; perVehicle: Array<{ licenceNumber: string; totalLitres: number; kmPerLitre: number | null; avgCostPerLitre: number }> }
    | undefined;
  const lateReturns = enhanced?.lateReturns as
    | { lateCount: number; totalTrips: number; lateRate: number; avgDelayHours: number; lateTrips: Array<{ vehicleLicence: string; actualHours: number; delayHours: number }>; monthlyLateTrend: Array<{ month: string; totalTrips: number; lateTrips: number }> }
    | undefined;
  const rejectionMetrics = enhanced?.rejectionMetrics as
    | { totalRequests: number; rejected: number; approved: number; rejectionRate: number; approvalRate: number; rejectionReasons: Array<{ reason: string; date: string }>; monthlyTrend: Array<{ month: string; total: number; rejected: number; approved: number }> }
    | undefined;

  if (!enhanced) {
    return (
      <Card>
        <CardContent>
          <p className="py-8 text-center text-xs text-ink-400">No enhanced analytics data available. This report requires trip and approval data to be present.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Avg. Approval Time"
          value={approvalTurnaround?.avgTotalHours != null ? `${approvalTurnaround.avgTotalHours} hrs` : '—'}
          description={`${approvalTurnaround?.completedWorkflows ?? 0} workflows`}
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          title="Fleet Utilisation"
          value={vehicleUtilisation?.avgUtilisation != null ? `${vehicleUtilisation.avgUtilisation}%` : '—'}
          description={`${vehicleUtilisation?.underUtilisedCount ?? 0} under-utilised`}
          icon={<Truck className="h-5 w-5" />}
          trend={{ value: (vehicleUtilisation?.avgUtilisation ?? 0) >= 50 ? 'Good utilisation' : 'Low utilisation', positive: (vehicleUtilisation?.avgUtilisation ?? 0) >= 50 }}
        />
        <StatCard
          title="Fuel Efficiency"
          value={fuelEfficiency?.fleetAvgKmPerLitre != null ? `${fuelEfficiency.fleetAvgKmPerLitre} km/L` : '—'}
          description={`${fuelEfficiency?.totalLitres ?? 0} L consumed`}
          icon={<Fuel className="h-5 w-5" />}
        />
        <StatCard
          title="Late Return Rate"
          value={lateReturns?.lateRate != null ? `${lateReturns.lateRate}%` : '—'}
          description={`${lateReturns?.lateCount ?? 0} of ${lateReturns?.totalTrips ?? 0} trips late`}
          icon={<AlertTriangle className="h-5 w-5" />}
          trend={{ value: (lateReturns?.lateRate ?? 0) <= 10 ? 'Within tolerance' : 'High late rate', positive: (lateReturns?.lateRate ?? 0) <= 10 }}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Approval Detail */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-4 w-4" /> Approval Turnover Detail</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[8px] bg-muted p-3">
                <p className="text-[11px] text-ink-500 uppercase tracking-wider">Avg Hours</p>
                <p className="text-xl font-bold text-ink-950">{approvalTurnaround?.avgTotalHours ?? '—'}</p>
              </div>
              <div className="rounded-[8px] bg-muted p-3">
                <p className="text-[11px] text-ink-500 uppercase tracking-wider">Total Actions</p>
                <p className="text-xl font-bold text-ink-950">{approvalTurnaround?.totalActions ?? 0}</p>
              </div>
            </div>

            {approvalTurnaround?.stepDurations && approvalTurnaround.stepDurations.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-ink-700">Durations by Step</p>
                <div className="space-y-1.5">
                  {approvalTurnaround.stepDurations.map((s) => (
                    <div key={s.stepOrder} className="flex items-center justify-between text-sm">
                      <span className="text-ink-600">Step {s.stepOrder}</span>
                      <span className="font-medium text-ink-950">{Math.round(s.avgHours * 10) / 10} hrs</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {approvalTurnaround?.monthlyTrend && approvalTurnaround.monthlyTrend.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-ink-700">Monthly Trend</p>
                <BarChart
                  data={approvalTurnaround.monthlyTrend.map((m) => ({ label: m.month, hours: Math.round(m.avgHours * 10) / 10 }))}
                  bars={[{ key: 'hours', color: '#2563eb', label: 'Avg Hours' }]}
                  height={120}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Vehicle Utilisation */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Truck className="h-4 w-4" /> Vehicle Utilisation</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[8px] bg-muted p-3">
                <p className="text-[11px] text-ink-500 uppercase tracking-wider">Fleet Avg</p>
                <p className="text-xl font-bold text-ink-950">{vehicleUtilisation?.avgUtilisation != null ? `${vehicleUtilisation.avgUtilisation}%` : '—'}</p>
              </div>
              <div className="rounded-[8px] bg-muted p-3">
                <p className="text-[11px] text-ink-500 uppercase tracking-wider">Under-Utilised</p>
                <p className="text-xl font-bold text-ink-950">{vehicleUtilisation?.underUtilisedCount ?? 0}</p>
              </div>
            </div>

            {vehicleUtilisation?.underUtilisedVehicles && vehicleUtilisation.underUtilisedVehicles.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-ink-700">Low-Utilisation Vehicles</p>
                <div className="space-y-1.5">
                  {vehicleUtilisation.underUtilisedVehicles.slice(0, 5).map((v) => (
                    <div key={v.licenceNumber} className="flex items-center justify-between text-sm">
                      <span className="text-ink-600">{v.licenceNumber}</span>
                      <span className="font-medium text-ink-950">{v.utilisationPct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Fuel Efficiency */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Fuel className="h-4 w-4" /> Fuel Efficiency</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-[8px] bg-muted p-3">
                <p className="text-[11px] text-ink-500 uppercase tracking-wider">Fleet Avg</p>
                <p className="text-xl font-bold text-ink-950">{fuelEfficiency?.fleetAvgKmPerLitre != null ? `${fuelEfficiency.fleetAvgKmPerLitre} km/L` : '—'}</p>
              </div>
              <div className="rounded-[8px] bg-muted p-3">
                <p className="text-[11px] text-ink-500 uppercase tracking-wider">Total Distance</p>
                <p className="text-xl font-bold text-ink-950">{fuelEfficiency?.totalDistance != null ? `${(fuelEfficiency.totalDistance / 1000).toFixed(1)}k km` : '—'}</p>
              </div>
              <div className="rounded-[8px] bg-muted p-3">
                <p className="text-[11px] text-ink-500 uppercase tracking-wider">Total Cost</p>
                <p className="text-xl font-bold text-ink-950">{fuelEfficiency?.totalFuelCost != null ? formatCurrency(fuelEfficiency.totalFuelCost) : '—'}</p>
              </div>
            </div>

            {fuelEfficiency?.perVehicle && fuelEfficiency.perVehicle.length > 0 && (
              <BarChart
                data={fuelEfficiency.perVehicle.slice(0, 8).map((v) => ({ label: v.licenceNumber, kmpl: v.kmPerLitre ?? 0 }))}
                bars={[{ key: 'kmpl', color: '#16a34a', label: 'km/L' }]}
                height={120}
              />
            )}
          </CardContent>
        </Card>

        {/* Late Returns */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-4 w-4" /> Late Returns</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-[8px] bg-muted p-3">
                <p className="text-[11px] text-ink-500 uppercase tracking-wider">Late Rate</p>
                <p className="text-xl font-bold text-ink-950">{lateReturns?.lateRate ?? 0}%</p>
              </div>
              <div className="rounded-[8px] bg-muted p-3">
                <p className="text-[11px] text-ink-500 uppercase tracking-wider">Late Count</p>
                <p className="text-xl font-bold text-ink-950">{lateReturns?.lateCount ?? 0}</p>
              </div>
              <div className="rounded-[8px] bg-muted p-3">
                <p className="text-[11px] text-ink-500 uppercase tracking-wider">Avg Delay</p>
                <p className="text-xl font-bold text-ink-950">{lateReturns?.avgDelayHours ?? 0} hrs</p>
              </div>
            </div>

            {lateReturns?.lateTrips && lateReturns.lateTrips.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-ink-700">Recent Late Trips</p>
                <div className="space-y-1.5">
                  {lateReturns.lateTrips.slice(0, 5).map((t, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-ink-600">{t.vehicleLicence}</span>
                      <span className="font-medium text-ink-950">{Math.round(t.delayHours * 10) / 10} hrs late</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rejection Metrics */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><XCircle className="h-4 w-4" /> Rejection Metrics</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-[8px] bg-muted p-3">
                <p className="text-[11px] text-ink-500 uppercase tracking-wider">Rejection Rate</p>
                <p className="text-xl font-bold text-ink-950">{rejectionMetrics?.rejectionRate ?? 0}%</p>
              </div>
              <div className="rounded-[8px] bg-muted p-3">
                <p className="text-[11px] text-ink-500 uppercase tracking-wider">Approval Rate</p>
                <p className="text-xl font-bold text-ink-950">{rejectionMetrics?.approvalRate ?? 0}%</p>
              </div>
              <div className="rounded-[8px] bg-muted p-3">
                <p className="text-[11px] text-ink-500 uppercase tracking-wider">Rejected</p>
                <p className="text-xl font-bold text-ink-950">{rejectionMetrics?.rejected ?? 0}</p>
              </div>
            </div>

            {rejectionMetrics?.rejectionReasons && rejectionMetrics.rejectionReasons.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-ink-700">Recent Rejection Reasons</p>
                <div className="space-y-1.5">
                  {rejectionMetrics.rejectionReasons.slice(0, 5).map((r, i) => (
                    <div key={i} className="flex items-start justify-between gap-2 text-sm">
                      <span className="text-ink-600 flex-1 line-clamp-1">{r.reason}</span>
                      <span className="shrink-0 text-[11px] text-ink-400">{r.date}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rejectionMetrics?.monthlyTrend && rejectionMetrics.monthlyTrend.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-ink-700">Monthly Trend</p>
                <BarChart
                  data={rejectionMetrics.monthlyTrend.map((m) => ({ label: m.month, Total: m.total, Rejected: m.rejected, Approved: m.approved }))}
                  bars={[
                    { key: 'Approved', color: '#16a34a', label: 'Approved' },
                    { key: 'Rejected', color: '#dc2626', label: 'Rejected' },
                  ]}
                  height={120}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Monthly Late Trend */}
        {lateReturns?.monthlyLateTrend && lateReturns.monthlyLateTrend.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Late Return Trend (Monthly)</CardTitle></CardHeader>
            <CardContent>
              <BarChart
                data={lateReturns.monthlyLateTrend.map((m) => ({ label: m.month, Total: m.totalTrips, Late: m.lateTrips }))}
                bars={[
                  { key: 'Total', color: '#6b7280', label: 'Total' },
                  { key: 'Late', color: '#dc2626', label: 'Late' },
                ]}
                height={140}
              />
            </CardContent>
          </Card>
        )}

        {/* Approval Monthly Trend */}
        {approvalTurnaround?.monthlyTrend && approvalTurnaround.monthlyTrend.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Approval Duration Trend</CardTitle></CardHeader>
            <CardContent>
              <BarChart
                data={approvalTurnaround.monthlyTrend.map((m) => ({ label: m.month, hours: Math.round(m.avgHours * 10) / 10 }))}
                bars={[{ key: 'hours', color: '#2563eb', label: 'Avg Hours' }]}
                height={140}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Requests Report Section
// ---------------------------------------------------------------------------
function ReportRequests({ data }: { data: Record<string, unknown> | null }) {
  const requestStats = data?.requestStats as Array<{ totalRequests: number; status: string }> | undefined;

  const stats = requestStats ?? [];
  const total = stats.reduce((s, t) => s + t.totalRequests, 0);
  const approved = stats.find((s) => s.status === 'approved')?.totalRequests ?? 0;
  const pending = stats.find((s) => s.status === 'submitted' || s.status === 'pending')?.totalRequests ?? 0;
  const rejected = stats.find((s) => s.status === 'rejected')?.totalRequests ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Requests" value={String(total)} description="Current period" icon={<FileText className="h-5 w-5" />} />
        <StatCard title="Approved" value={String(approved)} description={total > 0 ? `${Math.round((approved / total) * 100)}% approval rate` : '—'} icon={<CheckCircle2 className="h-5 w-5" />} />
        <StatCard title="Pending" value={String(pending)} description="Awaiting action" icon={<Clock className="h-5 w-5" />} />
        <StatCard title="Rejected" value={String(rejected)} description={total > 0 ? `${Math.round((rejected / total) * 100)}% rejection rate` : '—'} icon={<XCircle className="h-5 w-5" />} />
      </div>

      <Card>
        <CardHeader><CardTitle>Status Breakdown</CardTitle></CardHeader>
        <CardContent>
          {stats.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-400">No requests for this period.</p>
          ) : (
            <div className="space-y-3">
              {stats.map((s) => (
                <div key={s.status} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-700 capitalize">{s.status.replace(/_/g, ' ')}</span>
                    <span className="font-medium text-ink-950">{s.totalRequests} ({total > 0 ? Math.round((s.totalRequests / total) * 100) : 0}%)</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full transition-all bg-brand-600"                    style={{ width: `${total > 0 ? (s.totalRequests / total) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
