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

interface PackageOption {
  id: string;
  name: string;
  code: string;
  status: string;
  priceMonthlyCents: number | null;
  priceQuarterlyCents: number | null;
  priceAnnuallyCents: number | null;
  defaultBillingInterval: 'monthly' | 'quarterly' | 'annually';
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
  const [packages, setPackages] = useState<PackageOption[]>([]);
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

      const [res, packagesRes] = await Promise.all([
        fetch(`/api/platform/subscriptions?${params}`),
        fetch('/api/platform/packages'),
      ]);
      const [json, packagesJson] = await Promise.all([res.json(), packagesRes.json()]);
      if (!res.ok) throw new Error(json.error || 'Failed to fetch subscriptions');
      if (!packagesRes.ok) throw new Error(packagesJson.error || 'Failed to fetch packages');
      setSubscriptions(json.data.subscriptions ?? []);
      setPackages((packagesJson.data?.packages ?? []).filter((pkg: PackageOption) => pkg.status === 'active'));
      setStats(json.data.stats ?? null);
      setTotalPages(json.data.totalPages ?? 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscriptions');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  const handleTransition = useCallback(
    async (change: { status?: string; reason: string; packageId?: string; billingInterval?: string; billingPeriods?: number }) => {
      if (!transitionModal.subscription) return;
      setTransitioning(true);
      try {
        const res = await fetch(`/api/platform/subscriptions/${transitionModal.subscription.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(change),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to transition subscription');
        toast({
          title: 'Subscription updated',
          description: change.packageId
            ? 'The tenant package, price and billing duration are now updated.'
            : `Subscription transitioned to ${STATUS_CONFIG[change.status ?? '']?.label ?? change.status}.`,
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
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setTransitionModal({ open: true, subscription })}
                  >
                    <ArrowRightLeft className="h-4 w-4" aria-hidden="true" /> Manage
                  </Button>
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
        packages={packages}
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
  packages,
}: {
  open: boolean;
  subscription: Subscription | null;
  availableStatuses: string[];
  transitioning: boolean;
  packages: PackageOption[];
  onTransition: (change: { status?: string; reason: string; packageId?: string; billingInterval?: string; billingPeriods?: number }) => void | Promise<void>;
  onClose: () => void;
}) {
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'quarterly' | 'annually'>('annually');
  const [billingPeriods, setBillingPeriods] = useState('1');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedStatus('keep');
      setSelectedPackageId(subscription?.packageId ?? '');
      setBillingInterval((subscription?.billingInterval as typeof billingInterval) ?? 'annually');
      setBillingPeriods('1');
      setReason('');
    }
  }, [availableStatuses, open, subscription?.billingInterval, subscription?.id, subscription?.packageId]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !transitioning && !nextOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage tenant subscription</DialogTitle>
          <DialogDescription>
            Upgrade or downgrade the package, set its billing duration, and optionally change lifecycle status.
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

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Subscription package</Label>
            <Select value={selectedPackageId} onValueChange={(value) => {
              setSelectedPackageId(value);
              const pkg = packages.find((item) => item.id === value);
              if (pkg) setBillingInterval(pkg.defaultBillingInterval);
            }} disabled={transitioning}>
              <SelectTrigger aria-label="Subscription package"><SelectValue placeholder="Select package" /></SelectTrigger>
              <SelectContent>{packages.map((pkg) => <SelectItem key={pkg.id} value={pkg.id}>{pkg.name} ({pkg.code})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Billing interval</Label>
            <Select value={billingInterval} onValueChange={(value) => setBillingInterval(value as typeof billingInterval)} disabled={transitioning}>
              <SelectTrigger aria-label="Billing interval"><SelectValue /></SelectTrigger>
              <SelectContent>{(['monthly', 'quarterly', 'annually'] as const).map((interval) => {
                const pkg = packages.find((item) => item.id === selectedPackageId);
                const price = interval === 'monthly' ? pkg?.priceMonthlyCents : interval === 'quarterly' ? pkg?.priceQuarterlyCents : pkg?.priceAnnuallyCents;
                return <SelectItem key={interval} value={interval} disabled={price == null}>{interval.charAt(0).toUpperCase() + interval.slice(1)}</SelectItem>;
              })}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="billing-periods">Duration (billing periods)</Label>
            <Input id="billing-periods" type="number" min={1} max={36} value={billingPeriods} onChange={(event) => setBillingPeriods(event.target.value)} disabled={transitioning} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Lifecycle status <span className="font-normal text-ink-400">(optional)</span></Label>
          <Select value={selectedStatus} onValueChange={setSelectedStatus} disabled={transitioning}>
            <SelectTrigger aria-label="New subscription status">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="keep">Keep current status</SelectItem>
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
            onClick={() => onTransition({
              status: selectedStatus === 'keep' ? undefined : selectedStatus,
              reason: reason.trim(),
              packageId: selectedPackageId !== subscription?.packageId || billingInterval !== subscription?.billingInterval || billingPeriods !== '1' ? selectedPackageId : undefined,
              billingInterval,
              billingPeriods: Number(billingPeriods),
            })}
            loading={transitioning}
            disabled={!selectedPackageId || Number(billingPeriods) < 1 || Number(billingPeriods) > 36 || (selectedStatus === 'keep' && selectedPackageId === subscription?.packageId && billingInterval === subscription?.billingInterval && billingPeriods === '1')}
          >
            <ArrowRightLeft className="h-4 w-4" aria-hidden="true" /> Apply changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
