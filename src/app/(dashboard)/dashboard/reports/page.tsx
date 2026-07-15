'use client';

import { useState, useCallback, useEffect } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Fuel,
  Truck,
  TrendingUp,
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
} from 'lucide-react';

type ReportType =
  | 'fuel'
  | 'fleet'
  | 'trips'
  | 'maintenance'
  | 'requests'
  | 'approvals';

type TimeRange = '7d' | '30d' | '90d' | '1y' | 'custom';

const reportTypes: { value: ReportType; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'fuel', label: 'Fuel Consumption', icon: <Fuel className="h-4 w-4" />, description: 'Fuel usage, costs, and reimbursement tracking' },
  { value: 'fleet', label: 'Fleet Utilisation', icon: <Truck className="h-4 w-4" />, description: 'Vehicle availability, usage rates, and status distribution' },
  { value: 'trips', label: 'Trip Summary', icon: <Gauge className="h-4 w-4" />, description: 'Trip volumes, distances, durations, and completions' },
  { value: 'maintenance', label: 'Maintenance', icon: <Wrench className="h-4 w-4" />, description: 'Service costs, schedules, and backlog' },
  { value: 'requests', label: 'Transport Requests', icon: <FileText className="h-4 w-4" />, description: 'Request volumes, processing times, and status breakdown' },
  { value: 'approvals', label: 'Approvals', icon: <ClipboardList className="h-4 w-4" />, description: 'Approval turnaround times and workflow metrics' },
];

const timeRanges: { value: TimeRange; label: string }[] = [
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: '90d', label: 'Last Quarter' },
  { value: '1y', label: 'Year to Date' },
  { value: 'custom', label: 'Custom Range' },
];

// Mock report data for demonstration (fallback when DB not connected)
const mockFuelData = {
  summary: [
    { title: 'Total Fuel Used', value: '4,250 L', description: 'All vehicles', icon: <Fuel className="h-5 w-5" />, trend: { value: '+12% vs last period', positive: false } },
    { title: 'Total Cost', value: 'N$ 72,840', description: 'All payment methods', icon: <DollarSign className="h-5 w-5" />, trend: { value: '+8% vs last period', positive: false } },
    { title: 'Avg. Cost/Litre', value: 'N$ 17.14', description: 'Weighted average', icon: <TrendingUp className="h-5 w-5" />, trend: { value: '-3% vs last period', positive: true } },
    { title: 'Reimbursements', value: 'N$ 12,450', description: '12 pending claims', icon: <Clock className="h-5 w-5" />, trend: { value: '4 overdue', positive: false } },
  ],
  topConsumers: [
    { vehicle: 'GRN-005 (Toyota Hilux)', litres: 520, cost: 8900 },
    { vehicle: 'GRN-012 (Nissan NP300)', litres: 480, cost: 8220 },
    { vehicle: 'GRN-003 (Toyota Land Cruiser)', litres: 415, cost: 7110 },
    { vehicle: 'GRN-008 (Isuzu D-Max)', litres: 390, cost: 6680 },
    { vehicle: 'GRN-015 (Ford Ranger)', litres: 355, cost: 6080 },
  ],
  monthlyTrend: [
    { month: 'Feb', litres: 3850, cost: 65900 },
    { month: 'Mar', litres: 4020, cost: 68800 },
    { month: 'Apr', litres: 3780, cost: 64700 },
    { month: 'May', litres: 4100, cost: 70200 },
    { month: 'Jun', litres: 4250, cost: 72840 },
  ],
};

const mockFleetData = {
  summary: [
    { title: 'Total Vehicles', value: '31', description: 'All active fleet', icon: <Truck className="h-5 w-5" /> },
    { title: 'Available', value: '18', description: 'Ready for use', icon: <CheckCircle2 className="h-5 w-5" />, trend: { value: '58% availability', positive: true } },
    { title: 'On Trip', value: '8', description: 'Currently deployed', icon: <MapPin className="h-5 w-5" /> },
    { title: 'In Maintenance', value: '5', description: '3 scheduled, 2 repairs', icon: <Wrench className="h-5 w-5" />, trend: { value: '2 critical', positive: false } },
  ],
  statusDistribution: [
    { status: 'Available', count: 18, pct: 58 },
    { status: 'On Trip', count: 8, pct: 26 },
    { status: 'Maintenance', count: 3, pct: 10 },
    { status: 'Out of Service', count: 2, pct: 6 },
  ],
  utilisationRate: [
    { vehicle: 'GRN-005', rate: 92 },
    { vehicle: 'GRN-012', rate: 85 },
    { vehicle: 'GRN-003', rate: 78 },
    { vehicle: 'GRN-008', rate: 71 },
    { vehicle: 'GRN-015', rate: 65 },
  ],
};

const mockTripData = {
  summary: [
    { title: 'Total Trips', value: '47', description: 'Current period', icon: <Gauge className="h-5 w-5" />, trend: { value: '+15% vs last period', positive: true } },
    { title: 'Total Distance', value: '18,420 km', description: 'All trips combined', icon: <MapPin className="h-5 w-5" /> },
    { title: 'Avg. Trip Duration', value: '2.4 days', description: 'Per trip average', icon: <Clock className="h-5 w-5" /> },
    { title: 'Completed', value: '41', description: '87% completion rate', icon: <CheckCircle2 className="h-5 w-5" />, trend: { value: '+5% vs last period', positive: true } },
  ],
  scopeBreakdown: [
    { scope: 'Regional', count: 38, pct: 81 },
    { scope: 'National', count: 9, pct: 19 },
  ],
  monthlyTrips: [
    { month: 'Feb', trips: 38, km: 15200 },
    { month: 'Mar', trips: 42, km: 16800 },
    { month: 'Apr', trips: 35, km: 14100 },
    { month: 'May', trips: 44, km: 17600 },
    { month: 'Jun', trips: 47, km: 18420 },
  ],
};

// Bar chart component (inline SVG)
function BarChart({ data, bars, height = 200 }: {
  data: Record<string, string | number>[];
  bars: { key: string; color: string; label: string }[];
  height?: number;
}) {
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
          <span className="text-[10px] text-ink-500 text-center mt-1">{d.month || ''}</span>
        </div>
      ))}
    </div>
  );
}

/** Fetch reports from API with fallback to mock data */
async function fetchReportData(type: ReportType, period: TimeRange) {
  try {
    const res = await fetch(`/api/reports?type=${type}&period=${period}`);
    if (!res.ok) throw new Error('API unavailable');
    const json = await res.json();
    if (json.success && json.data) return json.data;
    throw new Error('Invalid response');
  } catch {
    return null; // Signal to use mock data
  }
}

export default function ReportsPage() {
  const [selectedReport, setSelectedReport] = useState<ReportType>('fuel');
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [isLive, setIsLive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Attempt to fetch live data on mount and when report/period changes
  useEffect(() => {
    let cancelled = false;
    fetchReportData(selectedReport, timeRange).then((data) => {
      if (cancelled) return;
      setIsLive(data !== null);
      setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedReport, timeRange]);

  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    const data = await fetchReportData(selectedReport, timeRange);
    setIsLive(data !== null);
    setIsLoading(false);
  }, [selectedReport, timeRange]);

  const handleExport = useCallback(() => {
    console.log('Export requested for:', selectedReport);
  }, [selectedReport]);

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
            isLive ? 'bg-status-success-bg text-status-success-text' : 'bg-muted text-ink-500'
          }`}>
            {isLive ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {isLive ? 'Live Data' : 'Sample Data'}
          </div>
          <Button variant="secondary" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button variant="secondary" size="sm">
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
            Refresh Data
          </Button>
        </div>
      </div>

      {/* Report Content */}
      {selectedReport === 'fuel' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {mockFuelData.summary.map((stat, i) => (
              <StatCard key={i} {...stat} />
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Monthly Fuel Consumption</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-4 text-xs text-ink-500">
                    <span className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-[3px] bg-brand-600" />
                      Litres
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-[3px] bg-amber-500" />
                      Cost (N$)
                    </span>
                  </div>
                </div>
                <BarChart
                  data={mockFuelData.monthlyTrend}
                  bars={[
                    { key: 'litres', color: '#2563eb', label: 'Litres' },
                    { key: 'cost', color: '#f59e0b', label: 'Cost' },
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top Fuel Consumers</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {mockFuelData.topConsumers.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-[8px] border border-border p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink-950 truncate">
                          {item.vehicle}
                        </p>
                        <div className="flex gap-4 mt-1">
                          <span className="text-xs text-ink-500">{item.litres} L</span>
                          <span className="text-xs text-ink-500">N$ {item.cost.toLocaleString()}</span>
                        </div>
                      </div>
                      <div
                        className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                        style={{
                          backgroundColor: i === 0 ? '#dc2626' : i === 1 ? '#ea580c' : i === 2 ? '#ca8a04' : '#2563eb',
                        }}
                      >
                        {i + 1}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {selectedReport === 'fleet' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {mockFleetData.summary.map((stat, i) => (
              <StatCard key={i} {...stat} />
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Vehicle Status Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {mockFleetData.statusDistribution.map((item) => (
                    <div key={item.status} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-ink-700">{item.status}</span>
                        <span className="font-medium text-ink-950">{item.count} ({item.pct}%)</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${item.pct}%`,
                            backgroundColor:
                              item.status === 'Available'
                                ? '#16a34a'
                                : item.status === 'On Trip'
                                  ? '#2563eb'
                                  : item.status === 'Maintenance'
                                    ? '#ca8a04'
                                    : '#dc2626',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Vehicle Utilisation Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {mockFleetData.utilisationRate.map((item) => (
                    <div key={item.vehicle} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-ink-700">{item.vehicle}</span>
                        <span className="font-medium text-ink-950">{item.rate}%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-brand-600 transition-all"
                          style={{ width: `${item.rate}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {selectedReport === 'trips' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {mockTripData.summary.map((stat, i) => (
              <StatCard key={i} {...stat} />
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Monthly Trip Volume</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 mb-4 text-xs text-ink-500">
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-[3px] bg-brand-600" />
                    Number of Trips
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-[3px] bg-teal-500" />
                    Distance (km)
                  </span>
                </div>
                <BarChart
                  data={mockTripData.monthlyTrips}
                  bars={[
                    { key: 'trips', color: '#2563eb', label: 'Trips' },
                    { key: 'km', color: '#14b8a6', label: 'Distance (km)' },
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Trip Scope Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {mockTripData.scopeBreakdown.map((item) => (
                    <div key={item.scope} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-ink-700">{item.scope}</span>
                        <span className="font-medium text-ink-950">{item.count} ({item.pct}%)</span>
                      </div>
                      <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${item.pct}%`,
                            backgroundColor: item.scope === 'Regional' ? '#2563eb' : '#7c3aed',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 rounded-[8px] border border-border bg-muted p-3">
                  <p className="text-xs text-ink-500">
                    <strong>Insight:</strong> Regional trips dominate at 81% of all trips, 
                    consistent with the Kavango East operational focus. National trips 
                    (19%) primarily involve Windhoek for senior staff meetings and 
                    procurement.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {selectedReport === 'maintenance' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Maintenance Events" value="23" description="This period" icon={<Wrench className="h-5 w-5" />} />
            <StatCard title="Total Cost" value="N$ 45,200" description="Parts & labour" icon={<DollarSign className="h-5 w-5" />} />
            <StatCard title="Scheduled Services" value="8" description="Upcoming" icon={<Clock className="h-5 w-5" />} />
            <StatCard title="Critical Repairs" value="2" description="Requires attention" icon={<AlertTriangle className="h-5 w-5" />} trend={{ value: 'Both in progress', positive: false }} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Maintenance by Vehicle</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 text-xs font-medium text-ink-500 uppercase tracking-wider">Vehicle</th>
                      <th className="text-left py-2 px-2 text-xs font-medium text-ink-500 uppercase tracking-wider">Type</th>
                      <th className="text-left py-2 px-2 text-xs font-medium text-ink-500 uppercase tracking-wider">Date</th>
                      <th className="text-left py-2 px-2 text-xs font-medium text-ink-500 uppercase tracking-wider">Cost</th>
                      <th className="text-left py-2 px-2 text-xs font-medium text-ink-500 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { vehicle: 'GRN-003', type: 'Oil Change', date: '12 Jul 2026', cost: 'N$ 1,200', status: 'Completed' },
                      { vehicle: 'GRN-005', type: 'Brake Pads', date: '10 Jul 2026', cost: 'N$ 2,800', status: 'Completed' },
                      { vehicle: 'GRN-012', type: 'Tyre Replacement', date: '08 Jul 2026', cost: 'N$ 4,500', status: 'Completed' },
                      { vehicle: 'GRN-008', type: 'Engine Service', date: '05 Jul 2026', cost: 'N$ 3,200', status: 'Completed' },
                      { vehicle: 'GRN-015', type: 'Suspension Repair', date: '03 Jul 2026', cost: 'N$ 5,100', status: 'In Progress' },
                      { vehicle: 'GRN-020', type: 'AC Repair', date: '01 Jul 2026', cost: 'N$ 1,800', status: 'Scheduled' },
                    ].map((item, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                        <td className="py-2.5 px-2 font-medium text-ink-950">{item.vehicle}</td>
                        <td className="py-2.5 px-2 text-ink-700">{item.type}</td>
                        <td className="py-2.5 px-2 text-ink-700">{item.date}</td>
                        <td className="py-2.5 px-2 text-ink-700">{item.cost}</td>
                        <td className="py-2.5 px-2">
                          <Badge variant={item.status === 'Completed' ? 'success' : item.status === 'In Progress' ? 'info' : 'pending'}>{item.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {selectedReport === 'requests' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Total Requests" value="124" description="Current period" icon={<FileText className="h-5 w-5" />} trend={{ value: '+18% vs last period', positive: true }} />
            <StatCard title="Approved" value="89" description="72% approval rate" icon={<CheckCircle2 className="h-5 w-5" />} />
            <StatCard title="Pending" value="22" description="Awaiting action" icon={<Clock className="h-5 w-5" />} />
            <StatCard title="Rejected" value="13" description="10% rejection rate" icon={<XCircle className="h-5 w-5" />} trend={{ value: '2% above target', positive: false }} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Request Status Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-0 h-8 rounded-full overflow-hidden">
                <div className="h-full bg-status-success-text flex items-center justify-center text-xs font-medium text-white" style={{ width: '72%' }}>Approved (72%)</div>
                <div className="h-full bg-status-pending-text flex items-center justify-center text-xs font-medium text-white" style={{ width: '18%' }}>Pending (18%)</div>
                <div className="h-full bg-status-error-text flex items-center justify-center text-xs font-medium text-white" style={{ width: '10%' }}>Rejected (10%)</div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {selectedReport === 'approvals' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Awaiting Action" value="8" description="Your pending approvals" icon={<Clock className="h-5 w-5" />} trend={{ value: '3 are overdue', positive: false }} />
            <StatCard title="Avg. Turnaround" value="4.2 hrs" description="Time to decision" icon={<TrendingUp className="h-5 w-5" />} trend={{ value: '-30 min vs target', positive: true }} />
            <StatCard title="This Week" value="23" description="Actions taken" icon={<CheckCircle2 className="h-5 w-5" />} />
            <StatCard title="Escalations" value="2" description="Requires CRO intervention" icon={<AlertTriangle className="h-5 w-5" />} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Approval Queue Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 text-xs font-medium text-ink-500 uppercase tracking-wider">Request</th>
                      <th className="text-left py-2 px-2 text-xs font-medium text-ink-500 uppercase tracking-wider">Type</th>
                      <th className="text-left py-2 px-2 text-xs font-medium text-ink-500 uppercase tracking-wider">Submitted</th>
                      <th className="text-left py-2 px-2 text-xs font-medium text-ink-500 uppercase tracking-wider">Status</th>
                      <th className="text-left py-2 px-2 text-xs font-medium text-ink-500 uppercase tracking-wider">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { request: 'Field inspection — Divundu', type: 'Supervisor', date: '14 Jul 2026', status: 'Pending', action: 'Approve' },
                      { request: 'Workshop materials — Rundu', type: 'Transport', date: '14 Jul 2026', status: 'Overdue', action: 'Escalate' },
                      { request: 'Senior staff meeting — Windhoek', type: 'Director', date: '13 Jul 2026', status: 'Approved', action: 'View' },
                      { request: 'Community outreach — Nkurenkuru', type: 'Supervisor', date: '13 Jul 2026', status: 'Pending', action: 'Approve' },
                      { request: 'Water pump delivery — Mpungu', type: 'Transport', date: '12 Jul 2026', status: 'Approved', action: 'View' },
                    ].map((item, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                        <td className="py-2.5 px-2 font-medium text-ink-950">{item.request}</td>
                        <td className="py-2.5 px-2 text-ink-700">{item.type}</td>
                        <td className="py-2.5 px-2 text-ink-700">{item.date}</td>
                        <td className="py-2.5 px-2">
                          <Badge variant={item.status === 'Approved' ? 'success' : item.status === 'Overdue' ? 'error' : 'pending'}>{item.status}</Badge>
                        </td>
                        <td className="py-2.5 px-2">
                          <Button variant="secondary" size="compact">
                            {item.action}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
