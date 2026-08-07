'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import {
  CreditCard,
  Search,
  RefreshCw,
  Loader2,
  Building2,
  Edit3,
  Save,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mobile_payment', label: 'Mobile Payment' },
  { value: 'card', label: 'Card' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'other', label: 'Other' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PlatformBillingPage() {
  const { toast } = useToast();

  const [settingsList, setSettingsList] = useState<BillingSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Selected tenant for editing
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [selectedSettings, setSelectedSettings] = useState<BillingSettings | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<Partial<BillingSettings>>({});

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      params.set('page', String(page));
      params.set('limit', '25');

      const res = await fetch(`/api/platform/billing?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch');
      setSettingsList(json.data.settings);
      setTotalPages(json.data.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, page]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const fetchTenantSettings = useCallback(async (tenantId: string) => {
    try {
      const res = await fetch(`/api/platform/billing/${tenantId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch');
      setSelectedSettings(json.data);
      setSelectedTenantId(tenantId);
      setEditForm(json.data || {});
      setEditMode(true);
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed', variant: 'error' });
    }
  }, [toast]);

  // -----------------------------------------------------------------------
  // Save
  // -----------------------------------------------------------------------

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
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      toast({ title: 'Saved', description: 'Billing settings updated', variant: 'success' });
      setSelectedSettings(json.data);
      setEditMode(false);
      fetchSettings();
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed', variant: 'error' });
    } finally {
      setSaving(false);
    }
  }, [selectedTenantId, editForm, toast, fetchSettings]);

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-NA', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const updateField = (field: string, value: any) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Platform', href: '/dashboard/platform' },
        { label: 'Billing Settings' },
      ]} />

      <PageHeader
        title="Billing Settings"
        description="Manage tenant billing configuration, payment preferences, and invoicing details"
      />

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
              <input
                type="text"
                placeholder="Search tenants..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                className="w-full pl-9 pr-3 py-2 h-10 text-sm border border-border rounded-[8px] bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              />
            </div>
            <Button variant="secondary" size="compact" onClick={fetchSettings}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Settings List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
          <span className="ml-2 text-sm text-ink-500">Loading billing settings...</span>
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-sm text-status-error-text">{error}</p>
          <Button variant="secondary" size="compact" onClick={fetchSettings} className="mt-3">Retry</Button>
        </div>
      ) : settingsList.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <CreditCard className="h-12 w-12 text-ink-300 mx-auto mb-3" />
            <p className="text-sm text-ink-500 mb-4">No billing settings found</p>
            <p className="text-xs text-ink-400">Billing settings will appear once configured for tenants</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {settingsList.map((settings) => (
              <Card key={settings.id} className="hover:border-brand-300 transition-colors">
                <CardContent className="py-4 px-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <Building2 className="h-5 w-5 text-ink-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-ink-900">{settings.tenantName}</h3>
                          <span className="text-xs text-ink-400 font-mono">{settings.tenantCode}</span>
                          {settings.taxExempt && (
                            <Badge variant="info" size="sm">Tax Exempt</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-ink-500 mt-1">
                          {settings.billingContactName && <span>{settings.billingContactName}</span>}
                          {settings.billingContactEmail && (
                            <>
                              <span>·</span>
                              <span>{settings.billingContactEmail}</span>
                            </>
                          )}
                          {settings.preferredPaymentMethod && (
                            <>
                              <span>·</span>
                              <span className="capitalize">{settings.preferredPaymentMethod.replace('_', ' ')}</span>
                            </>
                          )}
                          {settings.bankName && (
                            <>
                              <span>·</span>
                              <span>{settings.bankName}</span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-ink-400 mt-0.5">
                          {settings.taxId && <span>Tax ID: {settings.taxId}</span>}
                          {settings.gracePeriodDays && <span>Grace: {settings.gracePeriodDays} days</span>}
                          <span>Updated {formatDate(settings.updatedAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="ghost" size="compact" onClick={() => fetchTenantSettings(settings.tenantId)}>
                        <Edit3 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-xs text-ink-500">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="compact" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                  Previous
                </Button>
                <Button variant="secondary" size="compact" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Edit Modal */}
      {editMode && selectedTenantId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden border border-border">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h2 className="text-lg font-semibold text-ink-900">Edit Billing Settings</h2>
                <p className="text-sm text-ink-500">{selectedSettings?.tenantName || selectedTenantId}</p>
              </div>
              <Button variant="ghost" size="compact" onClick={() => { setEditMode(false); setSelectedTenantId(null); }}>
                ✕
              </Button>
            </div>

            <div className="px-6 py-4 overflow-y-auto max-h-[65vh] space-y-6">
              {/* Billing Contact */}
              <div>
                <h3 className="text-sm font-medium text-ink-700 mb-3">Billing Contact</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Contact Name</Label>
                    <Input value={editForm.billingContactName || ''} onChange={(e) => updateField('billingContactName', e.target.value)} placeholder="John Doe" />
                  </div>
                  <div>
                    <Label>Contact Email</Label>
                    <Input type="email" value={editForm.billingContactEmail || ''} onChange={(e) => updateField('billingContactEmail', e.target.value)} placeholder="billing@example.com" />
                  </div>
                  <div>
                    <Label>Contact Phone</Label>
                    <Input value={editForm.billingContactPhone || ''} onChange={(e) => updateField('billingContactPhone', e.target.value)} placeholder="+264 61 123 4567" />
                  </div>
                </div>
              </div>

              {/* Billing Address */}
              <div>
                <h3 className="text-sm font-medium text-ink-700 mb-3">Billing Address</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label>Address Line 1</Label>
                    <Input value={editForm.billingAddressLine1 || ''} onChange={(e) => updateField('billingAddressLine1', e.target.value)} placeholder="123 Main Street" />
                  </div>
                  <div>
                    <Label>City</Label>
                    <Input value={editForm.billingCity || ''} onChange={(e) => updateField('billingCity', e.target.value)} placeholder="Windhoek" />
                  </div>
                  <div>
                    <Label>Region</Label>
                    <Input value={editForm.billingRegion || ''} onChange={(e) => updateField('billingRegion', e.target.value)} placeholder="Khomas" />
                  </div>
                  <div>
                    <Label>Postal Code</Label>
                    <Input value={editForm.billingPostalCode || ''} onChange={(e) => updateField('billingPostalCode', e.target.value)} placeholder="9000" />
                  </div>
                  <div>
                    <Label>Country</Label>
                    <Input value={editForm.billingCountry || 'Namibia'} onChange={(e) => updateField('billingCountry', e.target.value)} />
                  </div>
                </div>
              </div>

              {/* Tax */}
              <div>
                <h3 className="text-sm font-medium text-ink-700 mb-3">Tax Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Tax ID / VAT Number</Label>
                    <Input value={editForm.taxId || ''} onChange={(e) => updateField('taxId', e.target.value)} placeholder="TAX12345678" />
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input
                      type="checkbox"
                      checked={editForm.taxExempt || false}
                      onChange={(e) => updateField('taxExempt', e.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    <Label>Tax Exempt</Label>
                  </div>
                </div>
              </div>

              {/* Payment Method */}
              <div>
                <h3 className="text-sm font-medium text-ink-700 mb-3">Payment Preferences</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Preferred Payment Method</Label>
                    <StyledSelect value={editForm.preferredPaymentMethod || ''} onChange={(e) => updateField('preferredPaymentMethod', e.target.value || null)}>
                      <option value="">Select method</option>
                      {PAYMENT_METHOD_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </StyledSelect>
                  </div>
                  <div>
                    <Label>Grace Period (Days)</Label>
                    <Input type="number" value={editForm.gracePeriodDays || 14} onChange={(e) => updateField('gracePeriodDays', parseInt(e.target.value) || 14)} />
                  </div>
                  <div className="col-span-2">
                    <Label>Payment Instructions</Label>
                    <Textarea value={editForm.paymentInstructions || ''} onChange={(e) => updateField('paymentInstructions', e.target.value)} rows={2} placeholder="Special payment instructions for this tenant..." />
                  </div>
                </div>
              </div>

              {/* Bank Details */}
              <div>
                <h3 className="text-sm font-medium text-ink-700 mb-3">Bank Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Account Name</Label>
                    <Input value={editForm.bankAccountName || ''} onChange={(e) => updateField('bankAccountName', e.target.value)} placeholder="Company Name" />
                  </div>
                  <div>
                    <Label>Bank Name</Label>
                    <Input value={editForm.bankName || ''} onChange={(e) => updateField('bankName', e.target.value)} placeholder="First National Bank" />
                  </div>
                  <div>
                    <Label>Account Number</Label>
                    <Input value={editForm.bankAccountNumber || ''} onChange={(e) => updateField('bankAccountNumber', e.target.value)} placeholder="1234567890" />
                  </div>
                  <div>
                    <Label>Branch Code</Label>
                    <Input value={editForm.bankBranchCode || ''} onChange={(e) => updateField('bankBranchCode', e.target.value)} placeholder="481-073" />
                  </div>
                  <div>
                    <Label>SWIFT Code</Label>
                    <Input value={editForm.bankSwiftCode || ''} onChange={(e) => updateField('bankSwiftCode', e.target.value)} placeholder="FIRNNANX" />
                  </div>
                  <div>
                    <Label>Reference Template</Label>
                    <Input value={editForm.bankReferenceTemplate || ''} onChange={(e) => updateField('bankReferenceTemplate', e.target.value)} placeholder="GRNFL-{TENANT_CODE}" />
                  </div>
                </div>
              </div>

              {/* Mobile Payment */}
              <div>
                <h3 className="text-sm font-medium text-ink-700 mb-3">Mobile Payment</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Provider</Label>
                    <Input value={editForm.mobilePaymentProvider || ''} onChange={(e) => updateField('mobilePaymentProvider', e.target.value)} placeholder="MTC M-Pesa" />
                  </div>
                  <div>
                    <Label>Number</Label>
                    <Input value={editForm.mobilePaymentNumber || ''} onChange={(e) => updateField('mobilePaymentNumber', e.target.value)} placeholder="+264 81 123 4567" />
                  </div>
                </div>
              </div>

              {/* Notifications */}
              <div>
                <h3 className="text-sm font-medium text-ink-700 mb-3">Notifications</h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { field: 'notifyOnPaymentDue', label: 'Payment Due' },
                    { field: 'notifyOnPaymentReceived', label: 'Payment Received' },
                    { field: 'notifyOnPaymentOverdue', label: 'Payment Overdue' },
                    { field: 'notifyOnSubscriptionChanges', label: 'Subscription Changes' },
                  ].map(({ field, label }) => (
                    <div key={field} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={(editForm as any)[field] ?? true}
                        onChange={(e) => updateField(field, e.target.checked)}
                        className="h-4 w-4 rounded border-border"
                      />
                      <Label>{label}</Label>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
              <Button variant="secondary" onClick={() => { setEditMode(false); setSelectedTenantId(null); }}>
                Cancel
              </Button>
              <Button onClick={saveSettings} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Save Settings
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
