'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Check,
  Loader2,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Label } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/lib/use-toast';
import { PACKAGE_FEATURES } from '@/lib/platform/package-feature-catalog';

interface SubscriptionPackage {
  id: string;
  code: string;
  name: string;
  description: string | null;
  tier: 'trial' | 'starter' | 'professional' | 'enterprise' | 'custom_institutional';
  status: string;
  priceMonthlyCents: number | null;
  priceQuarterlyCents: number | null;
  priceAnnuallyCents: number | null;
  defaultBillingInterval: 'monthly' | 'quarterly' | 'annually';
  maxVehicles: number | null;
  maxUsers: number | null;
  maxStorageGb: number | null;
  maxDrivers: number | null;
  maxDepartments: number | null;
  maxOffices: number | null;
  trialDays: number;
  sortOrder: number;
  features: Record<string, boolean> | null;
}

interface PackageFormState {
  code: string;
  name: string;
  description: string;
  tier: SubscriptionPackage['tier'];
  defaultBillingInterval: SubscriptionPackage['defaultBillingInterval'];
  monthlyPrice: string;
  quarterlyPrice: string;
  annualPrice: string;
  maxVehicles: string;
  maxUsers: string;
  maxDrivers: string;
  maxDepartments: string;
  maxOffices: string;
  maxStorageGb: string;
  trialDays: string;
  sortOrder: string;
  features: Record<string, boolean>;
}

type LimitKey =
  | 'maxVehicles'
  | 'maxUsers'
  | 'maxDrivers'
  | 'maxDepartments'
  | 'maxOffices'
  | 'maxStorageGb';

const LIMIT_FIELDS: Array<{ key: LimitKey; label: string }> = [
  { key: 'maxVehicles', label: 'Vehicles' },
  { key: 'maxUsers', label: 'Users' },
  { key: 'maxDrivers', label: 'Drivers' },
  { key: 'maxDepartments', label: 'Departments' },
  { key: 'maxOffices', label: 'Offices' },
  { key: 'maxStorageGb', label: 'Storage GB' },
];

const EMPTY_FORM: PackageFormState = {
  code: '',
  name: '',
  description: '',
  tier: 'starter',
  defaultBillingInterval: 'annually',
  monthlyPrice: '',
  quarterlyPrice: '',
  annualPrice: '',
  maxVehicles: '',
  maxUsers: '',
  maxDrivers: '',
  maxDepartments: '',
  maxOffices: '',
  maxStorageGb: '',
  trialDays: '0',
  sortOrder: '0',
  features: {},
};

const moneyFromCents = (value: number | null) =>
  value == null ? '' : (value / 100).toFixed(2);
const centsFromMoney = (value: string) =>
  value.trim() === '' ? null : Math.round(Number(value) * 100);
const nullableInteger = (value: string) =>
  value.trim() === '' ? null : Number.parseInt(value, 10);

function formFromPackage(pkg: SubscriptionPackage): PackageFormState {
  return {
    code: pkg.code,
    name: pkg.name,
    description: pkg.description ?? '',
    tier: pkg.tier,
    defaultBillingInterval: pkg.defaultBillingInterval,
    monthlyPrice: moneyFromCents(pkg.priceMonthlyCents),
    quarterlyPrice: moneyFromCents(pkg.priceQuarterlyCents),
    annualPrice: moneyFromCents(pkg.priceAnnuallyCents),
    maxVehicles: pkg.maxVehicles?.toString() ?? '',
    maxUsers: pkg.maxUsers?.toString() ?? '',
    maxDrivers: pkg.maxDrivers?.toString() ?? '',
    maxDepartments: pkg.maxDepartments?.toString() ?? '',
    maxOffices: pkg.maxOffices?.toString() ?? '',
    maxStorageGb: pkg.maxStorageGb?.toString() ?? '',
    trialDays: pkg.trialDays?.toString() ?? '0',
    sortOrder: pkg.sortOrder?.toString() ?? '0',
    features: pkg.features ?? {},
  };
}

function formatMoney(cents: number | null) {
  if (cents == null) return 'Custom';
  return `N$ ${new Intl.NumberFormat('en-NA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)}`;
}

export default function PlatformPackagesPage() {
  const { toast } = useToast();
  const [packages, setPackages] = useState<SubscriptionPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PackageFormState>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<SubscriptionPackage | null>(null);

  const fetchPackages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/platform/packages');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load packages');
      setPackages(json.data.packages ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load packages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPackages();
  }, [fetchPackages]);

  const activeCount = useMemo(
    () => packages.filter((pkg) => pkg.status === 'active').length,
    [packages],
  );

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, features: {} });
    setEditorOpen(true);
  };

  const openEdit = (pkg: SubscriptionPackage) => {
    setEditingId(pkg.id);
    setForm(formFromPackage(pkg));
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditorOpen(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM, features: {} });
  };

  const setField = <K extends keyof PackageFormState>(key: K, value: PackageFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const toggleFeature = (key: string, checked: boolean) => {
    setForm((current) => ({
      ...current,
      features: { ...current.features, [key]: checked },
    }));
  };

  const savePackage = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast({
        title: 'Missing information',
        description: 'Package code and name are required.',
        variant: 'error',
      });
      return;
    }

    const numericMoney = [form.monthlyPrice, form.quarterlyPrice, form.annualPrice]
      .filter((value) => value.trim() !== '')
      .map(Number);
    if (numericMoney.some((value) => !Number.isFinite(value) || value < 0)) {
      toast({
        title: 'Invalid price',
        description: 'Prices must be zero or positive numbers.',
        variant: 'error',
      });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim(),
        tier: form.tier,
        defaultBillingInterval: form.defaultBillingInterval,
        priceMonthlyCents: centsFromMoney(form.monthlyPrice),
        priceQuarterlyCents: centsFromMoney(form.quarterlyPrice),
        priceAnnuallyCents: centsFromMoney(form.annualPrice),
        maxVehicles: nullableInteger(form.maxVehicles),
        maxUsers: nullableInteger(form.maxUsers),
        maxDrivers: nullableInteger(form.maxDrivers),
        maxDepartments: nullableInteger(form.maxDepartments),
        maxOffices: nullableInteger(form.maxOffices),
        maxStorageGb: nullableInteger(form.maxStorageGb),
        trialDays: Number.parseInt(form.trialDays || '0', 10),
        sortOrder: Number.parseInt(form.sortOrder || '0', 10),
        features: form.features,
      };

      const res = await fetch(
        editingId ? `/api/platform/packages/${editingId}` : '/api/platform/packages',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save package');

      toast({
        title: editingId ? 'Package updated' : 'Package created',
        description: `${payload.name} is ready for tenant subscription configuration.`,
        variant: 'success',
      });
      closeEditor();
      await fetchPackages();
    } catch (err) {
      toast({
        title: 'Could not save package',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const archivePackage = async (pkg: SubscriptionPackage) => {
    const res = await fetch(`/api/platform/packages/${pkg.id}`, { method: 'DELETE' });
    const json = await res.json();
    if (!res.ok) {
      const message = json.error || 'Failed to archive package';
      toast({ title: 'Archive failed', description: message, variant: 'error' });
      throw new Error(message);
    }
    toast({
      title: 'Package archived',
      description: `${pkg.name} is no longer available for new subscriptions.`,
      variant: 'success',
    });
    await fetchPackages();
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Platform', href: '/dashboard/platform' },
          { label: 'Subscription Packages' },
        ]}
      />
      <PageHeader
        title="Subscription Packages"
        description="Define pricing, limits and feature entitlements used when onboarding and managing tenants."
      >
        <Button variant="secondary" size="sm" onClick={() => fetchPackages()} loading={loading}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </Button>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden="true" /> New Package
        </Button>
      </PageHeader>

      <div className="flex flex-wrap gap-x-8 gap-y-2 border-y border-border py-4 text-sm">
        <span>
          <strong className="text-ink-950">{packages.length}</strong>{' '}
          <span className="text-ink-500">total packages</span>
        </span>
        <span>
          <strong className="text-ink-950">{activeCount}</strong>{' '}
          <span className="text-ink-500">active</span>
        </span>
        <span className="text-ink-500">Tenant onboarding requires at least one active package.</span>
      </div>

      {editorOpen && (
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-ink-950">
                  {editingId ? 'Edit package' : 'Create package'}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-ink-500">
                  Blank numeric limits mean unlimited. Prices are entered in Namibian dollars.
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={closeEditor} aria-label="Close package editor">
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label required>Code</Label>
                <Input
                  value={form.code}
                  onChange={(event) => setField('code', event.target.value.toUpperCase())}
                  placeholder="PROFESSIONAL"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label required>Name</Label>
                <Input
                  value={form.name}
                  onChange={(event) => setField('name', event.target.value)}
                  placeholder="Professional"
                />
              </div>
              <div className="space-y-1.5">
                <Label required>Tier</Label>
                <Select
                  value={form.tier}
                  onValueChange={(value) => setField('tier', value as PackageFormState['tier'])}
                >
                  <SelectTrigger aria-label="Package tier">
                    <SelectValue placeholder="Select tier" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trial">Trial</SelectItem>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                    <SelectItem value="custom_institutional">Custom Institutional</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-2 lg:col-span-4">
                <Label>Description</Label>
                <Input
                  value={form.description}
                  onChange={(event) => setField('description', event.target.value)}
                  placeholder="Who this package is designed for"
                />
              </div>
            </div>

            <section className="mt-6 border-t border-border pt-5" aria-labelledby="package-pricing-heading">
              <h3 id="package-pricing-heading" className="text-sm font-semibold text-ink-950">Pricing & billing</h3>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>Monthly (N$)</Label>
                  <Input inputMode="decimal" value={form.monthlyPrice} onChange={(event) => setField('monthlyPrice', event.target.value)} placeholder="450.00" />
                </div>
                <div className="space-y-1.5">
                  <Label>Quarterly (N$)</Label>
                  <Input inputMode="decimal" value={form.quarterlyPrice} onChange={(event) => setField('quarterlyPrice', event.target.value)} placeholder="1215.00" />
                </div>
                <div className="space-y-1.5">
                  <Label>Annual (N$)</Label>
                  <Input inputMode="decimal" value={form.annualPrice} onChange={(event) => setField('annualPrice', event.target.value)} placeholder="4320.00" />
                </div>
                <div className="space-y-1.5">
                  <Label>Default interval</Label>
                  <Select
                    value={form.defaultBillingInterval}
                    onValueChange={(value) => setField('defaultBillingInterval', value as PackageFormState['defaultBillingInterval'])}
                  >
                    <SelectTrigger aria-label="Default billing interval">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="annually">Annually</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <section className="mt-6 border-t border-border pt-5" aria-labelledby="package-limits-heading">
              <h3 id="package-limits-heading" className="text-sm font-semibold text-ink-950">Usage limits</h3>
              <p className="mt-1 text-xs text-ink-500">Leave a field blank for unlimited.</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                {LIMIT_FIELDS.map(({ key, label }) => (
                  <div className="space-y-1.5" key={key}>
                    <Label>{label}</Label>
                    <Input
                      inputMode="numeric"
                      value={form[key]}
                      onChange={(event) => setField(key, event.target.value)}
                      placeholder="Unlimited"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>Trial days</Label>
                  <Input inputMode="numeric" value={form.trialDays} onChange={(event) => setField('trialDays', event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Display order</Label>
                  <Input inputMode="numeric" value={form.sortOrder} onChange={(event) => setField('sortOrder', event.target.value)} />
                </div>
              </div>
            </section>

            <section className="mt-6 border-t border-border pt-5" aria-labelledby="package-capabilities-heading">
              <h3 id="package-capabilities-heading" className="text-sm font-semibold text-ink-950">Included capabilities</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">
                Feature choices are translated into the permission entitlements enforced by the platform.
              </p>
              <div className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2 lg:grid-cols-3">
                {PACKAGE_FEATURES.map((feature) => {
                  const checked = Boolean(form.features[feature.key]);
                  return (
                    <label key={feature.key} className="flex cursor-pointer items-start gap-3 border-b border-border/70 pb-3">
                      <Checkbox
                        className="mt-0.5"
                        checked={checked}
                        onCheckedChange={(value) => toggleFeature(feature.key, value === true)}
                        aria-label={feature.label}
                      />
                      <span>
                        <span className="block text-sm font-medium text-ink-900">{feature.label}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">{feature.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>

            <div className="mobile-action-bar mt-6 flex flex-wrap gap-2 border-t border-border pt-5">
              <Button onClick={savePackage} loading={saving}>
                <Check className="h-4 w-4" aria-hidden="true" />
                {editingId ? 'Save Changes' : 'Create Package'}
              </Button>
              <Button variant="secondary" onClick={closeEditor} disabled={saving}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex min-h-40 items-center justify-center" role="status" aria-label="Loading subscription packages">
          <Loader2 className="h-6 w-6 animate-spin text-ink-400 motion-reduce:animate-none" aria-hidden="true" />
        </div>
      ) : error ? (
        <EmptyState icon={<Package className="h-6 w-6" />} title={error} action={{ label: 'Retry', onClick: fetchPackages }} />
      ) : packages.length === 0 ? (
        <EmptyState
          icon={<Package className="h-6 w-6" />}
          title="No subscription packages configured"
          description="Tenant onboarding cannot assign a package until at least one package exists. Create the first package here instead of relying on hidden seed data."
          action={{ label: 'Create Package', onClick: openCreate }}
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="hidden grid-cols-[1.4fr_0.7fr_0.8fr_1fr_0.7fr_auto] gap-4 border-b border-border bg-muted/40 px-5 py-3 text-xs font-medium text-ink-500 lg:grid">
            <span>Package</span>
            <span>Tier</span>
            <span>Default price</span>
            <span>Limits</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>
          {packages.map((pkg) => {
            const enabledFeatures = Object.values(pkg.features ?? {}).filter(Boolean).length;
            const defaultPrice =
              pkg.defaultBillingInterval === 'monthly'
                ? pkg.priceMonthlyCents
                : pkg.defaultBillingInterval === 'quarterly'
                  ? pkg.priceQuarterlyCents
                  : pkg.priceAnnuallyCents;
            return (
              <div key={pkg.id} className="grid gap-4 border-b border-border px-4 py-5 last:border-b-0 sm:px-5 lg:grid-cols-[1.4fr_0.7fr_0.8fr_1fr_0.7fr_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-ink-950">{pkg.name}</h3>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-ink-500">{pkg.code}</code>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-500">{pkg.description || 'No description'}</p>
                  <p className="mt-1 text-[11px] text-ink-400">{enabledFeatures} capabilities · {pkg.trialDays || 0}-day trial</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400 lg:hidden">Tier</p>
                  <span className="text-xs font-medium capitalize text-ink-700">{pkg.tier.replaceAll('_', ' ')}</span>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400 lg:hidden">Default price</p>
                  <p className="text-sm font-semibold text-ink-950">{formatMoney(defaultPrice)}</p>
                  <p className="text-[10px] capitalize text-ink-400">{pkg.defaultBillingInterval}</p>
                </div>
                <div className="text-xs text-ink-600">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400 lg:hidden">Limits</p>
                  <p>{pkg.maxVehicles ?? '∞'} vehicles</p>
                  <p>{pkg.maxUsers ?? '∞'} users · {pkg.maxDrivers ?? '∞'} drivers</p>
                </div>
                <div>
                  <Badge variant={pkg.status === 'active' ? 'success' : 'secondary'}>{pkg.status}</Badge>
                </div>
                <div className="flex flex-wrap gap-1 lg:justify-end">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(pkg)}>
                    <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
                  </Button>
                  {pkg.status === 'active' && (
                    <Button variant="ghost" size="sm" onClick={() => setArchiveTarget(pkg)}>
                      <Archive className="h-4 w-4" aria-hidden="true" /> Archive
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        title="Archive subscription package?"
        description={
          archiveTarget
            ? `${archiveTarget.name} will no longer be available for new subscriptions. Existing tenant subscriptions will keep their current package reference.`
            : 'This package will no longer be available for new subscriptions.'
        }
        confirmLabel="Archive Package"
        variant="destructive"
        onConfirm={async () => {
          if (!archiveTarget) return;
          const target = archiveTarget;
          await archivePackage(target);
          setArchiveTarget(null);
        }}
      />
    </div>
  );
}
