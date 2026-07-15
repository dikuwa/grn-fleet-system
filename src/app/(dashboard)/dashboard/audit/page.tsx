'use client';

import { useState } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Search,
  Download,
  Shield,
  UserCheck,
  FileText,
  Truck,
  CarFront,
  Fuel,
  Wrench,
  Users,
  CheckCircle2,
  Eye,
  Hash,
  History,
} from 'lucide-react';

type EventType =
  | 'all'
  | 'request'
  | 'approval'
  | 'allocation'
  | 'trip'
  | 'fuel'
  | 'maintenance'
  | 'inspection'
  | 'staff'
  | 'vehicle'
  | 'auth';

const eventTypes: { value: EventType; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'All Events', icon: <History className="h-4 w-4" /> },
  { value: 'request', label: 'Requests', icon: <FileText className="h-4 w-4" /> },
  { value: 'approval', label: 'Approvals', icon: <CheckCircle2 className="h-4 w-4" /> },
  { value: 'allocation', label: 'Allocations', icon: <Truck className="h-4 w-4" /> },
  { value: 'trip', label: 'Trips', icon: <CarFront className="h-4 w-4" /> },
  { value: 'fuel', label: 'Fuel', icon: <Fuel className="h-4 w-4" /> },
  { value: 'maintenance', label: 'Maintenance', icon: <Wrench className="h-4 w-4" /> },
  { value: 'inspection', label: 'Inspections', icon: <Eye className="h-4 w-4" /> },
  { value: 'vehicle', label: 'Fleet', icon: <Truck className="h-4 w-4" /> },
  { value: 'staff', label: 'Staff', icon: <Users className="h-4 w-4" /> },
  { value: 'auth', label: 'Auth', icon: <Shield className="h-4 w-4" /> },
];

type Severity = 'all' | 'info' | 'warning' | 'critical';

const mockEvents: {
  id: string;
  timestamp: string;
  eventType: EventType;
  action: string;
  actor: string;
  entity: string;
  severity: 'info' | 'warning' | 'critical';
  details: string;
}[] = [
  {
    id: '1',
    timestamp: '14 Jul 2026, 14:32',
    eventType: 'request',
    action: 'Transport request submitted',
    actor: 'M. Shikongo',
    entity: 'TR-2026-0142',
    severity: 'info' as const,
    details: 'Field inspection — Divundu Constituency. 3 passengers, 1 driver, estimated 180 km.',
  },
  {
    id: '2',
    timestamp: '14 Jul 2026, 13:15',
    eventType: 'approval',
    action: 'Request approved by supervisor',
    actor: 'E. Hausiku',
    entity: 'TR-2026-0141',
    severity: 'info' as const,
    details: 'Workshop materials transport — Rundu. Approved with comment: "Essential supplies."',
  },
  {
    id: '3',
    timestamp: '14 Jul 2026, 11:50',
    eventType: 'fuel',
    action: 'Fuel transaction recorded',
    actor: 'System',
    entity: 'GRN-005',
    severity: 'info' as const,
    details: '45.5 L diesel at Total Energies Rundu. N$ 780.00. Fuel card payment.',
  },
  {
    id: '4',
    timestamp: '14 Jul 2026, 10:22',
    eventType: 'allocation',
    action: 'Vehicle allocated to trip',
    actor: 'P. Ndara',
    entity: 'TR-2026-0140',
    severity: 'info' as const,
    details: 'GRN-012 (Nissan NP300) allocated for community outreach — Nkurenkuru.',
  },
  {
    id: '5',
    timestamp: '13 Jul 2026, 16:45',
    eventType: 'maintenance',
    action: 'Maintenance event recorded',
    actor: 'T. Sikongo',
    entity: 'GRN-003',
    severity: 'warning' as const,
    details: 'Brake replacement completed at Rundu Gvt Garage. Cost: N$ 2,800.',
  },
  {
    id: '6',
    timestamp: '13 Jul 2026, 14:00',
    eventType: 'auth',
    action: 'User login',
    actor: 'R. Kasume',
    entity: 'rkassume@gov.na',
    severity: 'info' as const,
    details: 'Successful login from IP 192.168.1.45. Session started.',
  },
  {
    id: '7',
    timestamp: '13 Jul 2026, 11:30',
    eventType: 'trip',
    action: 'Trip closed',
    actor: 'System',
    entity: 'TRIP-2026-0089',
    severity: 'info' as const,
    details: 'Trip completed. 245 km travelled, 32 L fuel used. Variance: +5 km.',
  },
  {
    id: '8',
    timestamp: '13 Jul 2026, 09:15',
    eventType: 'approval',
    action: 'Approval rejected',
    actor: 'E. Hausiku',
    entity: 'TR-2026-0138',
    severity: 'warning' as const,
    details: 'Rejected: Insufficient justification for national travel. Requires CRO endorsement.',
  },
  {
    id: '9',
    timestamp: '12 Jul 2026, 15:00',
    eventType: 'inspection',
    action: 'Departure inspection completed',
    actor: 'J. Namwandi',
    entity: 'GRN-008',
    severity: 'info' as const,
    details: 'All items passed. Odometer: 45,230 km. Fuel level: Full.',
  },
  {
    id: '10',
    timestamp: '12 Jul 2026, 08:30',
    eventType: 'maintenance',
    action: 'Critical defect reported',
    actor: 'P. Ndara',
    entity: 'GRN-020',
    severity: 'critical' as const,
    details: 'Engine overheating reported. Vehicle taken out of service. Immediate repair required.',
  },
  {
    id: '11',
    timestamp: '11 Jul 2026, 14:22',
    eventType: 'staff',
    action: 'Employee record updated',
    actor: 'System',
    entity: 'EMP-0045',
    severity: 'info' as const,
    details: 'Employment status changed: active → suspended. Reason: Disciplinary pending.',
  },
  {
    id: '12',
    timestamp: '11 Jul 2026, 10:00',
    eventType: 'vehicle',
    action: 'Vehicle status changed',
    actor: 'T. Sikongo',
    entity: 'GRN-015',
    severity: 'warning' as const,
    details: 'Status changed: available → maintenance. Reason: Scheduled 15,000 km service.',
  },
];

const severityConfig: Record<Severity, { label: string; variant: 'info' | 'error' | 'pending' }> = {
  all: { label: 'All', variant: 'info' },
  info: { label: 'Info', variant: 'info' },
  warning: { label: 'Warning', variant: 'pending' },
  critical: { label: 'Critical', variant: 'error' },
};

const eventIcons: Record<EventType, React.ReactNode> = {
  all: <History className="h-4 w-4" />,
  request: <FileText className="h-4 w-4" />,
  approval: <CheckCircle2 className="h-4 w-4" />,
  allocation: <Truck className="h-4 w-4" />,
  trip: <CarFront className="h-4 w-4" />,
  fuel: <Fuel className="h-4 w-4" />,
  maintenance: <Wrench className="h-4 w-4" />,
  inspection: <Eye className="h-4 w-4" />,
  vehicle: <Truck className="h-4 w-4" />,
  staff: <Users className="h-4 w-4" />,
  auth: <Shield className="h-4 w-4" />,
};

const eventBgColors: Record<EventType, string> = {
  all: 'bg-muted',
  request: 'bg-blue-50',
  approval: 'bg-green-50',
  allocation: 'bg-purple-50',
  trip: 'bg-cyan-50',
  fuel: 'bg-amber-50',
  maintenance: 'bg-orange-50',
  inspection: 'bg-teal-50',
  vehicle: 'bg-indigo-50',
  staff: 'bg-rose-50',
  auth: 'bg-slate-50',
};

const eventIconColors: Record<EventType, string> = {
  all: 'text-ink-500',
  request: 'text-blue-700',
  approval: 'text-green-700',
  allocation: 'text-purple-700',
  trip: 'text-cyan-700',
  fuel: 'text-amber-700',
  maintenance: 'text-orange-700',
  inspection: 'text-teal-700',
  vehicle: 'text-indigo-700',
  staff: 'text-rose-700',
  auth: 'text-slate-700',
};

export default function AuditLogPage() {
  const [selectedType, setSelectedType] = useState<EventType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showHashChain, setShowHashChain] = useState(false);

  const filteredEvents = mockEvents.filter((event) => {
    const typeMatch = selectedType === 'all' || event.eventType === selectedType;
    const searchMatch =
      !searchQuery ||
      event.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      event.actor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      event.entity.toLowerCase().includes(searchQuery.toLowerCase()) ||
      event.details.toLowerCase().includes(searchQuery.toLowerCase());
    return typeMatch && searchMatch;
  });

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Audit Log' },
      ]} />
      <PageHeader
        title="Audit Log"
        description="Immutable event trail with cryptographic hash-chain verification"
      >
        <div className="flex items-center gap-2">
          <Button
            variant={showHashChain ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setShowHashChain(!showHashChain)}
          >
            <Hash className="h-4 w-4" />
            Hash Chain
          </Button>
          <Button variant="secondary" size="sm">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </PageHeader>

      {/* Hash Chain Status */}
      {showHashChain && (
        <Card className="border-brand-200 bg-brand-50/50">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                <Shield className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-brand-900">Hash Chain Integrity: Verified</h3>
                <p className="mt-1 text-xs text-brand-700">
                  All 847 audit events are cryptographically linked. The last verified hash 
                  matches the expected chain value. Last verification: 14 Jul 2026, 14:35.
                </p>
                <div className="mt-3 flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1.5 text-green-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Chain intact
                  </span>
                  <span className="text-brand-600">Total events: 847</span>
                  <span className="text-brand-600">Earliest: 03 Jan 2026</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col gap-4">
            {/* Type filter chips */}
            <div className="flex flex-wrap gap-1.5">
              {eventTypes.map((et) => (
                <button
                  key={et.value}
                  onClick={() => setSelectedType(et.value)}
                  className={`inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    selectedType === et.value
                      ? 'bg-brand-800 text-white'
                      : 'text-ink-500 hover:text-ink-700 hover:bg-muted'
                  }`}
                >
                  {et.icon}
                  {et.label}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
              <Input
                placeholder="Search events by action, actor, entity, or details..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Event Timeline */}
      {filteredEvents.length === 0 ? (
        <EmptyState
          title="No events found"
          description="No audit events match your current filters. Try adjusting the search or filter criteria."
          icon={<History className="h-6 w-6" />}
        />
      ) : (
        <div className="space-y-2">
          {filteredEvents.map((event, i) => {
            const sevLabel = event.severity as Severity;
            return (
              <Card key={event.id} hover>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    {/* Timeline connector */}
                    <div className="flex flex-col items-center">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full ${eventBgColors[event.eventType]} ${eventIconColors[event.eventType]}`}
                      >
                        {eventIcons[event.eventType]}
                      </div>
                      {i < filteredEvents.length - 1 && (
                        <div className="mt-1 h-full w-px bg-border" />
                      )}
                    </div>

                    {/* Event content */}
                    <div className="min-w-0 flex-1 pb-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-ink-950">{event.action}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-ink-500">{event.timestamp}</span>
                          <Badge
                            variant={
                              sevLabel === 'critical'
                                ? 'error'
                                : sevLabel === 'warning'
                                  ? 'pending'
                                  : 'info'
                            }
                            size="sm"
                          >
                            {severityConfig[sevLabel].label}
                          </Badge>
                        </div>
                      </div>

                      <p className="mt-1 text-xs text-ink-500">{event.details}</p>

                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                        <span className="flex items-center gap-1 text-ink-500">
                          <UserCheck className="h-3 w-3" />
                          {event.actor}
                        </span>
                        <span className="flex items-center gap-1 text-ink-500">
                          <FileText className="h-3 w-3" />
                          {event.entity}
                        </span>
                        {showHashChain && (
                          <span className="flex items-center gap-1 font-mono text-[10px] text-ink-400">
                            <Hash className="h-3 w-3" />
                            {`0x${Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}...`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* Load more */}
          <div className="flex items-center justify-center pt-2">
            <Button variant="secondary" size="sm">
              Load More Events
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
