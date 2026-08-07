'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StyledSelect } from '@/components/ui/styled-select';
import {
  MonitorPlay,
  Search,
  RefreshCw,
  Loader2,
  Building2,
  Phone,
  Mail,
  Calendar,
  CheckCircle,
  Clock,
  Users,
  Car,
  ArrowRight,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DemoRequest {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string;
  jobTitle: string;
  role: string;
  industry: string | null;
  userCount: number | null;
  vehicleCount: number | null;
  preferredDate: string | null;
  preferredTime: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  contactMethod: string;
}

const STATUS_CONFIG: Record<string, { label: string; variant: string }> = {
  new: { label: 'New', variant: 'info' },
  qualified: { label: 'Qualified', variant: 'warning' },
  scheduled: { label: 'Scheduled', variant: 'success' },
  completed: { label: 'Completed', variant: 'default' },
  converted: { label: 'Converted', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'error' },
};

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'new', label: 'New' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'converted', label: 'Converted' },
  { value: 'cancelled', label: 'Cancelled' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PlatformDemoRequestsPage() {
  const { toast } = useToast();

  const [requests, setRequests] = useState<DemoRequest[]>([]);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      if (statusFilter) params.set('status', statusFilter);

      const res = await fetch(`/api/platform/demo-requests?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch');
      setRequests(json.data.requests);
      setStats(json.data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const updateStatus = useCallback(async (id: string, status: string) => {
    try {
      const res = await fetch('/api/platform/demo-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update');
      toast({ title: 'Request Updated', description: `Marked as ${status}`, variant: 'success' });
      fetchRequests();
    } catch (err) {
      toast({
        title: 'Update Failed',
        description: err instanceof Error ? err.message : 'Could not update request',
        variant: 'error',
      });
    }
  }, [toast, fetchRequests]);

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-NA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatCount = (count: number | null) => {
    if (count === null || count === 0) return '—';
    return count;
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Platform', href: '/dashboard/platform' },
        { label: 'Demo Requests' },
      ]} />

      <PageHeader
        title="Demo Requests"
        description="Qualify and manage platform demo requests"
      />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total" value={stats.total ?? 0} color="text-ink-600" />
          <StatCard label="New" value={stats.new ?? 0} color="text-status-info-text" />
          <StatCard label="Qualified" value={stats.qualified ?? 0} color="text-status-warning-text" />
          <StatCard label="Scheduled" value={stats.scheduled ?? 0} color="text-status-success-text" />
          <StatCard label="Completed" value={stats.completed ?? 0} color="text-ink-500" />
          <StatCard label="Converted" value={stats.converted ?? 0} color="text-status-success-text" />
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
              <input
                type="text"
                placeholder="Search by name, email, or company..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 h-10 text-sm border border-border rounded-[8px] bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              />
            </div>
            <StyledSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44">
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </StyledSelect>
            <Button variant="secondary" size="compact" onClick={fetchRequests}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Requests List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
          <span className="ml-2 text-sm text-ink-500">Loading demo requests...</span>
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-sm text-status-error-text">{error}</p>
          <Button variant="secondary" size="compact" onClick={fetchRequests} className="mt-3">Retry</Button>
        </div>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <MonitorPlay className="h-12 w-12 text-ink-300 mx-auto mb-3" />
            <p className="text-sm text-ink-500">No demo requests found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const config = STATUS_CONFIG[req.status] || { label: req.status, variant: 'default' };
            return (
              <Card key={req.id}>
                <CardContent className="py-4">
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Building2 className="h-4 w-4 text-ink-400" />
                        <h3 className="font-semibold text-ink-900 truncate">{req.company}</h3>
                        <Badge variant={config.variant as any} size="sm">{config.label}</Badge>
                      </div>
                      <p className="text-sm text-ink-600">
                        {req.name} · {req.jobTitle}
                      </p>
                      <div className="flex flex-wrap gap-4 mt-2 text-xs text-ink-500">
                        <span className="flex items-center gap-1">
                          <Mail className="h-3.5 w-3.5" /> {req.email}
                        </span>
                        {req.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5" /> {req.phone}
                          </span>
                        )}
                        {req.userCount && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3.5 w-3.5" /> {req.userCount} users
                          </span>
                        )}
                        {req.vehicleCount && (
                          <span className="flex items-center gap-1">
                            <Car className="h-3.5 w-3.5" /> {req.vehicleCount} vehicles
                          </span>
                        )}
                      </div>
                      {(req.preferredDate || req.notes) && (
                        <div className="mt-2 text-xs text-ink-400 space-y-1">
                          {req.preferredDate && (
                            <p className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              Preferred: {formatDate(req.preferredDate)}
                              {req.preferredTime ? ` (${req.preferredTime})` : ''}
                            </p>
                          )}
                          {req.notes && <p className="line-clamp-2">{req.notes}</p>}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 lg:flex-col lg:items-end">
                      {req.status === 'new' && (
                        <Button variant="secondary" size="compact" onClick={() => updateStatus(req.id, 'qualified')}>
                          <CheckCircle className="h-4 w-4 mr-1" /> Qualify
                        </Button>
                      )}
                      {req.status === 'qualified' && (
                        <Button variant="primary" size="compact" onClick={() => updateStatus(req.id, 'scheduled')}>
                          <Calendar className="h-4 w-4 mr-1" /> Schedule
                        </Button>
                      )}
                      {req.status === 'scheduled' && (
                        <Button variant="primary" size="compact" onClick={() => updateStatus(req.id, 'completed')}>
                          <CheckCircle className="h-4 w-4 mr-1" /> Mark Completed
                        </Button>
                      )}
                      {req.status === 'completed' && (
                        <Button variant="primary" size="compact" onClick={() => updateStatus(req.id, 'converted')}>
                          <ArrowRight className="h-4 w-4 mr-1" /> Mark Converted
                        </Button>
                      )}
                      {!['completed', 'converted', 'cancelled'].includes(req.status) && (
                        <Button variant="ghost" size="compact" onClick={() => updateStatus(req.id, 'cancelled')}>
                          Cancel
                        </Button>
                      )}
                      <span className="text-xs text-ink-400">{formatDate(req.createdAt)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-[8px] border border-border bg-surface p-4">
      <p className="text-xs font-medium text-ink-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}
