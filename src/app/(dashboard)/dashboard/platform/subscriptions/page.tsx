'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StyledSelect } from '@/components/ui/styled-select';
import {
  CreditCard,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Clock,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Pause,
  Loader2,
  Eye,
  ArrowRightLeft,
  Calendar,
  Building2,
  Package,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Subscription {
  id: string;
  tenantId: string;
  packageId: string;
  status: string;
  billingInterval: string;
  priceCents: number;
  currency: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  cancelledAt: string | null;
  gracePeriodEndsAt: string | null;
  nextPaymentDueAt: string | null;
  lastPaymentAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  packageName: string;
  packageCode: string;
  tenantName: string;
  createdAt: string;
}

interface SubscriptionStats {
  total: number;
  active: number;
  trialing: number;
  pastDue: number;
  cancelled: number;
  expired: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<string, { label: string; variant: string; icon: any }> = {
  active: { label: 'Active', variant: 'success', icon: CheckCircle },
  trialing: { label: 'Trialing', variant: 'info', icon: Clock },
  pending_payment: { label: 'Pending Payment', variant: 'warning', icon: CreditCard },
  past_due: { label: 'Past Due', variant: 'warning', icon: AlertTriangle },
  grace_period: { label: 'Grace Period', variant: 'warning', icon: AlertTriangle },
  cancelled: { label: 'Cancelled', variant: 'error', icon: XCircle },
  expired: { label: 'Expired', variant: 'error', icon: XCircle },
  suspended: { label: 'Suspended', variant: 'error', icon: Pause },
  restricted: { label: 'Restricted', variant: 'warning', icon: AlertTriangle },
};

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'trialing', label: 'Trialing' },
  { value: 'pending_payment', label: 'Pending Payment' },
  { value: 'past_due', label: 'Past Due' },
  { value: 'grace_period', label: 'Grace Period' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'restricted', label: 'Restricted' },
];

const TRANSITION_OPTIONS: Record<string, string[]> = {
  trialing: ['active', 'cancelled'],
  active: ['past_due', 'suspended', 'cancelled'],
  pending_payment: ['active', 'cancelled'],
  past_due: ['active', 'grace_period', 'cancelled'],
  grace_period: ['active', 'cancelled'],
  suspended: ['active', 'cancelled'],
  restricted: ['active', 'cancelled'],
  cancelled: ['active'],
  expired: ['active'],
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PlatformSubscriptionsPage() {
  const router = useRouter();
  const { toast } = useToast();

  // Data state
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [stats, setStats] = useState<SubscriptionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Modal state
  const [transitionModal, setTransitionModal] = useState<{
    open: boolean;
    subscription: Subscription | null;
  }>({ open: false, subscription: null });
  const [transitioning, setTransitioning] = useState(false);

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const fetchSubscriptions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('limit', '25');

      const res = await fetch(`/api/platform/subscriptions?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch');
      setSubscriptions(json.data.subscriptions);
      setStats(json.data.stats);
      setTotalPages(json.data.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, page]);

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handleTransition = useCallback(async (newStatus: string, reason: string) => {
    if (!transitionModal.subscription) return;
    setTransitioning(true);
    try {
      const res = await fetch(`/api/platform/subscriptions/${transitionModal.subscription.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, reason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to transition');
      toast({
        title: 'Status Updated',
        description: `Subscription transitioned to ${newStatus}`,
        variant: 'success',
      });
      setTransitionModal({ open: false, subscription: null });
      fetchSubscriptions();
    } catch (err) {
      toast({
        title: 'Transition Failed',
        description: err instanceof Error ? err.message : 'Could not update status',
        variant: 'error',
      });
    } finally {
      setTransitioning(false);
    }
  }, [transitionModal.subscription, toast, fetchSubscriptions]);

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const formatCurrency = (cents: number, currency: string = 'NAD') => {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-NA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatInterval = (interval: string) => {
    return interval.charAt(0).toUpperCase() + interval.slice(1);
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Platform', href: '/dashboard/platform' },
        { label: 'Subscriptions' },
      ]} />

      <PageHeader
        title="Subscription Management"
        description="Manage tenant subscriptions, billing periods, and payment status"
        actions={
          <Button onClick={() => router.push('/dashboard/platform/onboard')} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            New Tenant
          </Button>
        }
      />

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            label="Total"
            value={stats.total}
            icon={CreditCard}
            color="text-ink-600"
          />
          <StatCard
            label="Active"
            value={stats.active}
            icon={CheckCircle}
            color="text-status-success-text"
          />
          <StatCard
            label="Trialing"
            value={stats.trialing}
            icon={Clock}
            color="text-status-info-text"
          />
          <StatCard
            label="Past Due"
            value={stats.pastDue}
            icon={AlertTriangle}
            color="text-status-warning-text"
          />
          <StatCard
            label="Cancelled"
            value={stats.cancelled}
            icon={XCircle}
            color="text-status-error-text"
          />
          <StatCard
            label="Expired"
            value={stats.expired}
            icon={XCircle}
            color="text-status-error-text"
          />
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
                placeholder="Search by tenant or package..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                className="w-full pl-9 pr-3 py-2 h-10 text-sm border border-border rounded-[8px] bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              />
            </div>
            <StyledSelect
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="w-48"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </StyledSelect>
            <Button variant="secondary" size="compact" onClick={fetchSubscriptions}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Subscriptions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            Subscriptions ({subscriptions.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
              <span className="ml-2 text-sm text-ink-500">Loading subscriptions...</span>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-sm text-status-error-text">{error}</p>
              <Button variant="secondary" size="compact" onClick={fetchSubscriptions} className="mt-3">
                Retry
              </Button>
            </div>
          ) : subscriptions.length === 0 ? (
            <div className="text-center py-12">
              <CreditCard className="h-12 w-12 text-ink-300 mx-auto mb-3" />
              <p className="text-sm text-ink-500">No subscriptions found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-3 font-medium text-ink-500">Tenant</th>
                    <th className="text-left py-3 px-3 font-medium text-ink-500">Package</th>
                    <th className="text-left py-3 px-3 font-medium text-ink-500">Status</th>
                    <th className="text-left py-3 px-3 font-medium text-ink-500">Billing</th>
                    <th className="text-left py-3 px-3 font-medium text-ink-500">Price</th>
                    <th className="text-left py-3 px-3 font-medium text-ink-500">Period</th>
                    <th className="text-left py-3 px-3 font-medium text-ink-500">Next Payment</th>
                    <th className="text-right py-3 px-3 font-medium text-ink-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {subscriptions.map((sub) => {
                    const statusConfig = STATUS_CONFIG[sub.status] || { label: sub.status, variant: 'default', icon: CreditCard };
                    const availableTransitions = TRANSITION_OPTIONS[sub.status] || [];
                    return (
                      <tr key={sub.id} className="hover:bg-surface-hover transition-colors">
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-ink-400" />
                            <span className="font-medium text-ink-900">{sub.tenantName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1.5">
                            <Package className="h-3.5 w-3.5 text-ink-400" />
                            <span>{sub.packageName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <Badge variant={statusConfig.variant as any} size="sm">
                            {statusConfig.label}
                          </Badge>
                        </td>
                        <td className="py-3 px-3">{formatInterval(sub.billingInterval)}</td>
                        <td className="py-3 px-3 font-medium">{formatCurrency(sub.priceCents, sub.currency)}</td>
                        <td className="py-3 px-3 text-xs text-ink-500">
                          {formatDate(sub.currentPeriodStart)} — {formatDate(sub.currentPeriodEnd)}
                        </td>
                        <td className="py-3 px-3">
                          {sub.nextPaymentDueAt ? (
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5 text-ink-400" />
                              <span className="text-xs">{formatDate(sub.nextPaymentDueAt)}</span>
                            </div>
                          ) : '—'}
                        </td>
                        <td className="py-3 px-3 text-right">
                          {availableTransitions.length > 0 && (
                            <Button
                              variant="ghost"
                              size="compact"
                              onClick={() => setTransitionModal({ open: true, subscription: sub })}
                            >
                              <ArrowRightLeft className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
              <p className="text-xs text-ink-500">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transition Modal */}
      <TransitionModal
        open={transitionModal.open}
        subscription={transitionModal.subscription}
        availableStatuses={
          transitionModal.subscription
            ? TRANSITION_OPTIONS[transitionModal.subscription.status] || []
            : []
        }
        transitioning={transitioning}
        onTransition={handleTransition}
        onClose={() => setTransitionModal({ open: false, subscription: null })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: any;
  color: string;
}) {
  return (
    <div className="rounded-[8px] border border-border bg-surface p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-xs font-medium text-ink-500">{label}</span>
      </div>
      <p className="text-2xl font-bold text-ink-900">{value}</p>
    </div>
  );
}

function TransitionModal({
  open,
  subscription,
  availableStatuses,
  transitioning,
  onTransition,
  onClose,
}: {
  open: boolean;
  subscription: Subscription | null;
  availableStatuses: string[];
  transitioning: boolean;
  onTransition: (status: string, reason: string) => void;
  onClose: () => void;
}) {
  const [selectedStatus, setSelectedStatus] = useState(availableStatuses[0] || '');
  const [reason, setReason] = useState('');

  if (!open || !subscription) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface rounded-[12px] border border-border shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-ink-900">Transition Subscription</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-600">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="rounded-[8px] border border-border p-3 bg-surface-hover">
          <p className="text-sm font-medium text-ink-900">{subscription.tenantName}</p>
          <p className="text-xs text-ink-500 mt-1">
            {subscription.packageName} · {STATUS_CONFIG[subscription.status]?.label || subscription.status}
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-700">New Status</label>
          <StyledSelect
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
          >
            {availableStatuses.map((status) => (
              <option key={status} value={status}>
                {STATUS_CONFIG[status]?.label || status}
              </option>
            ))}
          </StyledSelect>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-700">Reason (optional)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for this transition..."
            className="w-full h-20 px-3 py-2 text-sm border border-border rounded-[8px] bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 resize-none"
          />
        </div>

        <div className="flex gap-3 justify-end">
          <Button variant="secondary" size="compact" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="compact"
            onClick={() => onTransition(selectedStatus, reason)}
            disabled={transitioning || !selectedStatus}
          >
            {transitioning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRightLeft className="h-4 w-4 mr-1" />
            )}
            Transition
          </Button>
        </div>
      </div>
    </div>
  );
}
