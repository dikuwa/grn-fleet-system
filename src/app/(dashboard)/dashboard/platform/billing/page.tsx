'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  CreditCard,
  Edit3,
  RefreshCw,
  Save,
  Search,
} from 'lucide-react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

interface BillingSettings {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantCode: string;
  billingContactName: string | null;
  billingContactEmail: string | null;
  billingContactPhone: string | null;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingCity: string | null;
  billingRegion: string | null;
  billingPostalCode: string | null;
  billingCountry: string | null;
  taxId: string | null;
  taxExempt: boolean;
  taxExemptCertificateUrl: string | null;
  preferredPaymentMethod: string | null;
  paymentInstructions: string | null;
  bankAccountName: string | null;
  bankName: string | null;
  bankBranchCode: string | null;
  bankAccountNumber: string | null;
  bankSwiftCode: string | null;
  bankReferenceTemplate: string | null;
  mobilePaymentProvider: string | null;
  mobilePaymentNumber: string | null;
  mobilePaymentReferenceTemplate: string | null;
  notifyOnPaymentDue: boolean;
  notifyOnPaymentReceived: boolean;
  notifyOnPaymentOverdue: boolean;
  notifyOnSubscriptionChanges: boolean;
  gracePeriodDays: number;
  createdAt: string;
  updatedAt: string;
}

const PAYMENT_METHOD_OPTIONS = [
  { value: 'none', label: 'Select method' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mobile_payment', label: 'Mobile Payment' },
  { value: 'card', label: 'Card' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'other', label: 'Other' },
];

const NOTIFICATION_FIELDS: Array<{
  field:
    | 'notifyOnPaymentDue'
    | 'notifyOnPaymentReceived'
    | 'notifyOnPaymentOverdue'
    | 'notifyOnSubscriptionChanges';
  label: string;
}> = [
  { field: 'notifyOnPaymentDue', label: 'Payment Due' },
  { field: 'notifyOnPaymentReceived', label: 'Payment Received' },
  { field: 'notifyOnPaymentOverdue', label: 'Payment Overdue' },
  { field: 'notifyOnSubscriptionChanges', label: 'Subscription Changes' },
];

export default function PlatformBillingPage() {
  const { toast } = useToast();
  const [settingsList, setSettingsList] = useState<BillingSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [selectedTenantName, setSelectedTenantName] = useState('');
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<Partial<BillingSettings>>({});

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);
      params.set('page', String(page));
      params.set('limit', '25');

      const res = await fetch(`/api/platform/billing?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch billing settings');
      setSettingsList(json.data.settings ?? []);
      setTotalPages(json.data.totalPages ?? 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing settings');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const fetchTenantSettings = useCallback(
    async (tenantId: string) => {
      try {
        const res = await fetch(`/api/platform/billing/${tenantId}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to fetch billing settings');
        setEditForm(json.data ?? {});
        setSelectedTenantName(json.data?.tenantName ?? tenantId);
        setSelectedTenantId(tenantId);
      } catch (err) {
        toast({
          title: 'Could not open billing settings',
          description: err instanceof Error ? err.message : 'Failed to load tenant billing settings',
          variant: 'error',
        });
      }
    },
    [toast],
  );

  const saveSettings = useCallback(async () => {
    if (!selectedTenantId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/billing/${selectedTenantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save billing settings');
      toast({
        title: 'Billing settings saved',
        description: `${selectedTenantName} billing configuration has been updated.`,
        variant: 'success',
      });
      setSelectedTenantId(null);
      setEditForm({});
      await fetchSettings();
    } catch (err) {
      toast({
        title: 'Could not save billing settings',
        description: err instanceof Error ? err.message : 'Failed to save billing settings',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }, [selectedTenantId, selectedTenantName, editForm, toast, fetchSettings]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-NA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const updateField = <K extends keyof BillingSettings>(field: K, value: BillingSettings[K]) => {
    setEditForm((current) => ({ ...current, [field]: value }));
  };

  const closeEditor = () => {
    if (saving) return;
    setSelectedTenantId(null);
    setSelectedTenantName('');
    setEditForm({});
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Platform', href: '/dashboard/platform' },
          { label: 'Billing Settings' },
        ]}
      />

      <PageHeader
        title="Billing Settings"
        description="Manage tenant billing contacts, payment preferences, and invoicing details."
      />

      <section aria-label="Billing filters" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-md sm:flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Search tenant billing settings"
            placeholder="Search tenants..."
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
        <Button variant="secondary" size="icon" onClick={fetchSettings} loading={loading} aria-label="Refresh billing settings">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </Button>
      </section>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center" role="status">
          <span className="text-sm text-ink-500">Loading billing settings…</span>
        </div>
      ) : error ? (
        <EmptyState
          icon={<CreditCard className="h-6 w-6" />}
          title="Could not load billing settings"
          description={error}
          action={{ label: 'Retry', onClick: fetchSettings }}
        />
      ) : settingsList.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-6 w-6" />}
          title="No billing settings found"
          description={debouncedSearch ? 'Try another tenant name or clear the search.' : 'Billing settings appear here after tenant billing configuration is created.'}
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          {settingsList.map((settings) => (
            <article key={settings.id} className="border-b border-border p-4 last:border-b-0 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-600">
                    <Building2 className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-semibold text-ink-950">{settings.tenantName}</h2>
                      <span className="font-mono text-xs text-ink-400">{settings.tenantCode}</span>
                      {settings.taxExempt && <Badge variant="info" size="sm">Tax Exempt</Badge>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-500">
                      {settings.billingContactName && <span>{settings.billingContactName}</span>}
                      {settings.billingContactEmail && <span>{settings.billingContactEmail}</span>}
                      {settings.preferredPaymentMethod && (
                        <span className="capitalize">{settings.preferredPaymentMethod.replace('_', ' ')}</span>
                      )}
                      {settings.bankName && <span>{settings.bankName}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-400">
                      {settings.taxId && <span>Tax ID: {settings.taxId}</span>}
                      <span>Grace: {settings.gracePeriodDays ?? 0} days</span>
                      <span>Updated {formatDate(settings.updatedAt)}</span>
                    </div>
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => fetchTenantSettings(settings.tenantId)}>
                  <Edit3 className="h-4 w-4" aria-hidden="true" /> Edit Settings
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Billing pagination">
          <p className="text-xs text-ink-500">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="secondary" size="sm" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages}>Next</Button>
          </div>
        </nav>
      )}

      <Dialog open={Boolean(selectedTenantId)} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent className="max-h-[92dvh] overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b border-border px-5 py-4 sm:px-6">
            <DialogTitle>Edit Billing Settings</DialogTitle>
            <DialogDescription>{selectedTenantName || selectedTenantId}</DialogDescription>
          </DialogHeader>

          <div className="max-h-[calc(92dvh-9rem)] space-y-7 overflow-y-auto px-5 py-5 sm:px-6">
            <section aria-labelledby="billing-contact-heading">
              <h3 id="billing-contact-heading" className="mb-3 text-sm font-semibold text-ink-950">Billing Contact</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Contact Name</Label>
                  <Input value={editForm.billingContactName ?? ''} onChange={(event) => updateField('billingContactName', event.target.value)} placeholder="John Doe" />
                </div>
                <div className="space-y-1.5">
                  <Label>Contact Email</Label>
                  <Input type="email" value={editForm.billingContactEmail ?? ''} onChange={(event) => updateField('billingContactEmail', event.target.value)} placeholder="billing@example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label>Contact Phone</Label>
                  <Input value={editForm.billingContactPhone ?? ''} onChange={(event) => updateField('billingContactPhone', event.target.value)} placeholder="+264 61 123 4567" />
                </div>
              </div>
            </section>

            <section aria-labelledby="billing-address-heading" className="border-t border-border pt-5">
              <h3 id="billing-address-heading" className="mb-3 text-sm font-semibold text-ink-950">Billing Address</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Address Line 1</Label>
                  <Input value={editForm.billingAddressLine1 ?? ''} onChange={(event) => updateField('billingAddressLine1', event.target.value)} placeholder="123 Main Street" />
                </div>
                <div className="space-y-1.5">
                  <Label>City</Label>
                  <Input value={editForm.billingCity ?? ''} onChange={(event) => updateField('billingCity', event.target.value)} placeholder="Windhoek" />
                </div>
                <div className="space-y-1.5">
                  <Label>Region</Label>
                  <Input value={editForm.billingRegion ?? ''} onChange={(event) => updateField('billingRegion', event.target.value)} placeholder="Khomas" />
                </div>
                <div className="space-y-1.5">
                  <Label>Postal Code</Label>
                  <Input value={editForm.billingPostalCode ?? ''} onChange={(event) => updateField('billingPostalCode', event.target.value)} placeholder="9000" />
                </div>
                <div className="space-y-1.5">
                  <Label>Country</Label>
                  <Input value={editForm.billingCountry ?? 'Namibia'} onChange={(event) => updateField('billingCountry', event.target.value)} />
                </div>
              </div>
            </section>

            <section aria-labelledby="billing-tax-heading" className="border-t border-border pt-5">
              <h3 id="billing-tax-heading" className="mb-3 text-sm font-semibold text-ink-950">Tax Information</h3>
              <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
                <div className="space-y-1.5">
                  <Label>Tax ID / VAT Number</Label>
                  <Input value={editForm.taxId ?? ''} onChange={(event) => updateField('taxId', event.target.value)} placeholder="TAX12345678" />
                </div>
                <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-ink-700">
                  <Checkbox checked={Boolean(editForm.taxExempt)} onCheckedChange={(value) => updateField('taxExempt', value === true)} />
                  Tax Exempt
                </label>
              </div>
            </section>

            <section aria-labelledby="billing-payment-heading" className="border-t border-border pt-5">
              <h3 id="billing-payment-heading" className="mb-3 text-sm font-semibold text-ink-950">Payment Preferences</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Preferred Payment Method</Label>
                  <Select
                    value={editForm.preferredPaymentMethod ?? 'none'}
                    onValueChange={(value) => updateField('preferredPaymentMethod', value === 'none' ? null : value)}
                  >
                    <SelectTrigger aria-label="Preferred payment method"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHOD_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Grace Period (Days)</Label>
                  <Input type="number" min={0} value={editForm.gracePeriodDays ?? 14} onChange={(event) => updateField('gracePeriodDays', Number.parseInt(event.target.value || '0', 10))} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Payment Instructions</Label>
                  <Textarea value={editForm.paymentInstructions ?? ''} onChange={(event) => updateField('paymentInstructions', event.target.value)} placeholder="Special payment instructions for this tenant..." />
                </div>
              </div>
            </section>

            <section aria-labelledby="billing-bank-heading" className="border-t border-border pt-5">
              <h3 id="billing-bank-heading" className="mb-3 text-sm font-semibold text-ink-950">Bank Details</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Account Name</Label><Input value={editForm.bankAccountName ?? ''} onChange={(event) => updateField('bankAccountName', event.target.value)} /></div>
                <div className="space-y-1.5"><Label>Bank Name</Label><Input value={editForm.bankName ?? ''} onChange={(event) => updateField('bankName', event.target.value)} /></div>
                <div className="space-y-1.5"><Label>Account Number</Label><Input value={editForm.bankAccountNumber ?? ''} onChange={(event) => updateField('bankAccountNumber', event.target.value)} /></div>
                <div className="space-y-1.5"><Label>Branch Code</Label><Input value={editForm.bankBranchCode ?? ''} onChange={(event) => updateField('bankBranchCode', event.target.value)} /></div>
                <div className="space-y-1.5"><Label>SWIFT Code</Label><Input value={editForm.bankSwiftCode ?? ''} onChange={(event) => updateField('bankSwiftCode', event.target.value)} /></div>
                <div className="space-y-1.5"><Label>Reference Template</Label><Input value={editForm.bankReferenceTemplate ?? ''} onChange={(event) => updateField('bankReferenceTemplate', event.target.value)} placeholder="GRNFL-{TENANT_CODE}" /></div>
              </div>
            </section>

            <section aria-labelledby="billing-mobile-heading" className="border-t border-border pt-5">
              <h3 id="billing-mobile-heading" className="mb-3 text-sm font-semibold text-ink-950">Mobile Payment</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Provider</Label><Input value={editForm.mobilePaymentProvider ?? ''} onChange={(event) => updateField('mobilePaymentProvider', event.target.value)} /></div>
                <div className="space-y-1.5"><Label>Number</Label><Input value={editForm.mobilePaymentNumber ?? ''} onChange={(event) => updateField('mobilePaymentNumber', event.target.value)} /></div>
              </div>
            </section>

            <section aria-labelledby="billing-notifications-heading" className="border-t border-border pt-5">
              <h3 id="billing-notifications-heading" className="mb-3 text-sm font-semibold text-ink-950">Notifications</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {NOTIFICATION_FIELDS.map(({ field, label }) => (
                  <label key={field} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-ink-700">
                    <Checkbox
                      checked={editForm[field] ?? true}
                      onCheckedChange={(value) => updateField(field, value === true)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </section>
          </div>

          <DialogFooter className="mobile-action-bar border-t border-border px-5 py-4 sm:px-6">
            <Button variant="secondary" onClick={closeEditor} disabled={saving}>Cancel</Button>
            <Button onClick={saveSettings} loading={saving}>
              <Save className="h-4 w-4" aria-hidden="true" /> Save Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
