import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/ui/card';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  FileText,
  Clock,
  Truck,
  AlertTriangle,
  Fuel,
  TrendingUp,
  Wrench,
} from 'lucide-react';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Kavango East Regional Council — Fleet Operations Overview"
      />

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Requests"
          value="12"
          description="Awaiting action"
          icon={<FileText className="h-5 w-5" />}
          trend={{ value: "+3 today", positive: false }}
        />
        <StatCard
          title="Active Trips"
          value="8"
          description="Vehicles on the road"
          icon={<Truck className="h-5 w-5" />}
        />
        <StatCard
          title="Pending Approvals"
          value="5"
          description="Awaiting your decision"
          icon={<Clock className="h-5 w-5" />}
          trend={{ value: "2 are overdue", positive: false }}
        />
        <StatCard
          title="Open Defects"
          value="3"
          description="2 critical, 1 minor"
          icon={<AlertTriangle className="h-5 w-5" />}
          trend={{ value: "-1 this week", positive: true }}
        />
      </div>

      {/* Recent Activity & Quick Actions */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Requests */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Transport Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentRequests.map((request, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-[8px] border border-border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-950 truncate">
                      {request.activity}
                    </p>
                    <p className="text-xs text-ink-500">
                      {request.requester} &middot; {request.date}
                    </p>
                  </div>
                  <span
                    className={`ml-3 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      request.status === 'Approved'
                        ? 'bg-status-success-bg text-status-success-text'
                        : request.status === 'Pending'
                          ? 'bg-status-pending-bg text-status-pending-text'
                          : 'bg-status-info-bg text-status-info-text'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        request.status === 'Approved'
                          ? 'bg-status-success-text'
                          : request.status === 'Pending'
                            ? 'bg-status-pending-text'
                            : 'bg-status-info-text'
                      }`}
                    />
                    {request.status}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quick Stats */}
        <Card>
          <CardHeader>
            <CardTitle>Fleet Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {fleetStats.map((stat, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-[6px] ${stat.bgColor}`}
                  >
                    <stat.icon className={`h-4 w-4 ${stat.iconColor}`} />
                  </div>
                  <span className="text-sm text-ink-700">{stat.label}</span>
                </div>
                <span className="text-sm font-semibold tabular-nums text-ink-950">
                  {stat.value}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const recentRequests = [
  {
    activity: 'Field inspection — Divundu Constituency',
    requester: 'M. Shikongo',
    date: '14 Jul 2026',
    status: 'Approved',
  },
  {
    activity: 'Workshop materials transport — Rundu',
    requester: 'P. Ndara',
    date: '14 Jul 2026',
    status: 'Pending',
  },
  {
    activity: 'Senior staff meeting — Windhoek',
    requester: 'E. Hausiku',
    date: '13 Jul 2026',
    status: 'In Progress',
  },
  {
    activity: 'Community outreach — Nkurenkuru',
    requester: 'R. Kasume',
    date: '13 Jul 2026',
    status: 'Pending',
  },
  {
    activity: 'Water pump delivery — Mpungu',
    requester: 'T. Sikongo',
    date: '12 Jul 2026',
    status: 'Approved',
  },
];

const fleetStats = [
  {
    label: 'Available',
    value: 18,
    icon: Truck,
    bgColor: 'bg-status-success-bg',
    iconColor: 'text-status-success-text',
  },
  {
    label: 'On Trip',
    value: 8,
    icon: TrendingUp,
    bgColor: 'bg-status-info-bg',
    iconColor: 'text-status-info-text',
  },
  {
    label: 'In Maintenance',
    value: 3,
    icon: Wrench,
    bgColor: 'bg-status-pending-bg',
    iconColor: 'text-status-pending-text',
  },
  {
    label: 'Out of Service',
    value: 2,
    icon: AlertTriangle,
    bgColor: 'bg-status-error-bg',
    iconColor: 'text-status-error-text',
  },
  {
    label: 'Fuel This Month',
    value: '4,250 L',
    icon: Fuel,
    bgColor: 'bg-brand-50',
    iconColor: 'text-brand-700',
  },
];


