'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRightLeft,
  Building2,
  Calendar,
  CheckCircle,
  Clock,
  CreditCard,
  Package,
  Pause,
  Plus,
  RefreshCw,
  Search,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Label, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/lib/use-toast';

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

type BadgeVariant = NonNullable<BadgeProps['variant']>;

const STATUS_CONFIG: Record<string, { label: string; variant: BadgeVariant; icon: LucideIcon }> = {
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
  { value: 'all', label: 'All Statuses' },
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

const SUMMARY_ITEMS: Array<{ key: keyof SubscriptionStats; label: string }> = [
  { key: 'total', label: 'Total' },
  { key: 'active', label: 'Active' },
  { key: 'trialing', label: 'Trialing' },
  { key: 'pastDue', label: 'Past Due' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'expired', label: 'Expired' },
];

export default function PlatformSubscriptionsPage() {
  const { toast } = useToast();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [stats, setStats] = useState<SubscriptionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [transitionModal, setTransitionModal] = useState<{
    open: boolean;
    subscription: Subscription | null;
  }>({ open: false, subscription: null });
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const fetchSubscriptions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('limit', '25');

      const res = await fetch(`/api/platform/subscriptions?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch subscriptions');
      setSubscriptions(json.data.subscriptions ?? []);
      setStats(json.data.stats ?? null);
      setTotalPages(json.data.totalPages ?? 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscriptions');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter, page]);

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  const handleTransition = useCallback(
    async (newStatus: string, reason: string) => {
      if (!transitionModal.subscription) return;
      setTransitioning(true);
      try {
        const res = await fetch(`/api/platform/subscriptions/${transitionModal.subscription.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus, reason }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to transition subscription');
        toast({
          title: 'Subscription updated',
          description: `Subscription transitioned to ${STATUS_CONFIG[newStatus]?.label ?? newStatus}.`,
          variant: 'success',
        });
        setTransitionModal({ open: false, subscription: null });
        await fetchSubscriptions();
      } catch (err) {
        toast({
          title: 'Transition failed',
          description: err instanceof Error ? err.message : 'Could not update status',
          variant: 'error',
        });
      } finally {
        setTransitioning(false);
      }
    },
    [transitionModal.subscription, toast, fetchSubscriptions],
  );

  const formatCurrency = (cents: number, currency = 'NAD') =>
    new Intl.NumberFormat('en-NA', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-NA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Platform', href: '/dashboard/platform' },
          { label: 'Subscriptions' },
        ]}
      />

      <PageHeader
        title="Subscription Management"
        description="Manage tenant subscription states, billing periods, and payment readiness."
      >
        <Button asChild size="sm">
          <Link href="/dashboard/platform/onboard">
            <Plus className="h-4 w-4" aria-hidden="true" /> New Tenant
          </Link>
        </Button>
      </PageHeader>

      {stats && (
        <section aria-label="Subscription summary" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            {SUMMARY_ITEMS.map(({ key, label }, index) => (
              <div
                key={key}
                className={`px-4 py-4 ${index % 2 ? 'border-l border-border' : ''} ${index >= 2 ? 'border-t border-border sm:border-t-0' : ''} ${index >= 3 ? 'sm:border-t sm:border-border lg:border-t-0' : ''} ${index > 0 ? 'lg:border-l lg:border-border' : ''}`}
              >
                <p className="text-xs font-medium text-ink-500">{label}</p>
                <p className="mt-1 text-2xl font-[650] tabular-nums text-ink-950">{stats[key]}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-label="Subscription filters" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-md sm:flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Search subscriptions"
            placeholder="Search tenant or package..."
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-52" aria-label="Filter subscriptions by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="secondary" size="icon" onClick={fetchSubscriptions} loading={loading} aria-label="Refresh subscriptions">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </Button>
      </section>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center" role="status">
          <span className="text-sm text-ink-500">Loading subscriptions…</span>
        </div>
      ) : error ? (
        <EmptyState
          icon={<CreditCard className="h-6 w-6" />}
          title="Could not load subscriptions"
          description={error}
          action={{ label: 'Retry', onClick: fetchSubscriptions }}
        />
      ) : subscriptions.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-6 w-6" />}
          title="No subscriptions found"
          description={debouncedSearch || statusFilter !== 'all' ? 'Adjust the current filters to see other subscriptions.' : 'Tenant subscriptions will appear here after onboarding.'}
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="hidden grid-cols-[1.2fr_1fr_0.75fr_0.8fr_0.9fr_1.15fr_auto] gap-4 border-b border-border bg-muted/40 px-5 py-3 text-xs font-medium text-ink-500 xl:grid">
            <span>Tenant</span>
            <span>Package</span>
            <span>Status</span>
            <span>Billing</span>
            <span>Price</span>
            <span>Period / Payment</span>
            <span className="text-right">Actions</span>
          </div>
          {subscriptions.map((subscription) => {
            const statusConfig = STATUS_CONFIG[subscription.status] ?? {
              label: subscription.status,
              variant: 'default' as BadgeVariant,
              icon: CreditCard,
            };
            const availableTransitions = TRANSITION_OPTIONS[subscription.status] ?? [];
            return (
              <article
                key={subscription.id}
                className="grid gap-4 border-b border-border px-4 py-5 last:border-b-0 sm:px-5 xl:grid-cols-[1.2fr_1fr_0.75fr_0.8fr_0.9fr_1.15fr_auto] xl:items-center"
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400 xl:hidden">Tenant</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <Building2 className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
                    <span className="truncate text-sm font-medium text-ink-950">{subscription.tenantName}</span>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400 xl:hidden">Package</p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                    <span className="truncate text-sm text-ink-700">{subscription.packageName}</span>
                  </div>
                </div>
                <div>
                  <Badge variant={statusConfig.variant} size="sm">{statusConfig.label}</Badge>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400 xl:hidden">Billing</p>
                  <p className="text-sm capitalize text-ink-700">{subscription.billingInterval}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400 xl:hidden">Price</p>
                  <p className="text-sm font-semibold text-ink-950">{formatCurrency(subscription.priceCents, subscription.currency)}</p>
                </div>
                <div className="space-y-1 text-xs text-ink-500">
                  <p>{formatDate(subscription.currentPeriodStart)} — {formatDate(subscription.currentPeriodEnd)}</p>
                  {subscription.nextPaymentDueAt && (
                    <p className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                      Next: {formatDate(subscription.nextPaymentDueAt)}
                    </p>
                  )}
                </div>
                <div className="flex xl:justify-end">
                  {availableTransitions.length > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setTransitionModal({ open: true, subscription })}
                    >
                      <ArrowRightLeft className="h-4 w-4" aria-hidden="true" /> Change Status
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Subscription pagination">
          <p className="text-xs text-ink-500">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="secondary" size="sm" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages}>Next</Button>
          </div>
        </nav>
      )}

      <TransitionDialog
        open={transitionModal.open}
        subscription={transitionModal.subscription}
        availableStatuses={transitionModal.subscription ? TRANSITION_OPTIONS[transitionModal.subscription.status] ?? [] : []}
        transitioning={transitioning}
        onTransition={handleTransition}
        onClose={() => setTransitionModal({ open: false, subscription: null })}
      />
    </div>
  );
}

function TransitionDialog({
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
  onTransition: (status: string, reason: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [selectedStatus, setSelectedStatus] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) {
      setSelectedStatus(availableStatuses[0] ?? '');
      setReason('');
    }
  }, [open, subscription?.id, availableStatuses]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !transitioning && !nextOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change subscription status</DialogTitle>
          <DialogDescription>
            Apply an allowed lifecycle transition and keep the reason with the subscription history.
          </DialogDescription>
        </DialogHeader>

        {subscription && (
          <div className="rounded-[8px] border border-border bg-muted/40 p-3">
            <p className="text-sm font-medium text-ink-950">{subscription.tenantName}</p>
            <p className="mt-1 text-xs text-ink-500">
              {subscription.packageName} · {STATUS_CONFIG[subscription.status]?.label ?? subscription.status}
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>New Status</Label>
          <Select value={selectedStatus} onValueChange={setSelectedStatus} disabled={transitioning}>
            <SelectTrigger aria-label="New subscription status">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              {availableStatuses.map((status) => (
                <SelectItem key={status} value={status}>{STATUS_CONFIG[status]?.label ?? status}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Reason <span className="font-normal text-ink-400">(optional)</span></Label>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason for this transition..."
            disabled={transitioning}
            className="min-h-24"
          />
        </div>

        <DialogFooter className="mobile-action-bar">
          <Button variant="secondary" onClick={onClose} disabled={transitioning}>Cancel</Button>
          <Button
            onClick={() => onTransition(selectedStatus, reason.trim())}
            loading={transitioning}
            disabled={!selectedStatus}
          >
            <ArrowRightLeft className="h-4 w-4" aria-hidden="true" /> Transition
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
