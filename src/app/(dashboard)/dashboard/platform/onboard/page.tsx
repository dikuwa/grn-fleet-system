'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StyledSelect } from '@/components/ui/styled-select';
import { Shield, Mail, Building2, Palette, CheckCircle2, Loader2, ChevronLeft, ChevronRight, Clock, Info } from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { format } from 'date-fns';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OnboardingForm {
  // Step 1: Organisation
  orgName: string;
  orgCode: string;
  orgSlug: string;
  orgType: string;
  timezone: string;
  locale: string;

  // Step 2: Primary Contact
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string;
  primaryContactTitle: string;

  // Step 3: Tenant Admin (invitation recipient)
  tenantAdminEmail: string;
  tenantAdminName: string;

  // Step 4: Subscription
  subscriptionPackageId: string;
  billingInterval: 'monthly' | 'quarterly' | 'annually';

  // Step 5: Optional Branding
  brandingContactEmail: string;
  brandingContactPhone: string;
  brandingAddress: string;
  brandingPrimaryColor: string;
  brandingAccentColor: string;

  // Internal state
  currentStep: number;
}

const DEFAULT_FORM: OnboardingForm = {
  orgName: '',
  orgCode: '',
  orgSlug: '',
  orgType: 'regional_council',
  timezone: 'Africa/Windhoek',
  locale: 'en-NA',

  primaryContactName: '',
  primaryContactEmail: '',
  primaryContactPhone: '',
  primaryContactTitle: '',

  tenantAdminEmail: '',
  tenantAdminName: '',

  subscriptionPackageId: '',
  billingInterval: 'monthly',

  brandingContactEmail: '',
  brandingContactPhone: '',
  brandingAddress: '',
  brandingPrimaryColor: '#1F4E8C',
  brandingAccentColor: '#0F766E',

  currentStep: 0,
};

const ORG_TYPES = [
  { value: 'regional_council', label: 'Regional Council' },
  { value: 'ministry', label: 'Ministry / National Office' },
  { value: 'agency', label: 'Government Agency' },
];

const BILLING_INTERVALS = [
  { value: 'monthly', label: 'Monthly', suffix: 'per month' },
  { value: 'quarterly', label: 'Quarterly', suffix: 'per 3 months' },
  { value: 'annually', label: 'Annually', suffix: 'per year' },
];

const STEPS = [
  { label: 'Organisation', icon: Building2, description: 'Organisation details and identifiers' },
  { label: 'Primary Contact', icon: Mail, description: 'Main contact person for the organisation' },
  { label: 'Tenant Admin', icon: Shield, description: 'Primary administrator who will receive invitation' },
  { label: 'Subscription', icon: Clock, description: 'Package and billing configuration' },
  { label: 'Branding', icon: Palette, description: 'Optional organisation branding' },
  { label: 'Review', icon: CheckCircle2, description: 'Review all configuration before creation' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OnboardTenantPage() {
  const router = useRouter();
  const [form, setForm] = useState<OnboardingForm>({ ...DEFAULT_FORM });
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Fetch available packages
  const { data: packagesData, isLoading: packagesLoading } = useQuery({
    queryKey: ['onboarding-packages'],
    queryFn: async () => {
      const res = await fetch('/api/platform/onboard');
      if (!res.ok) throw new Error('Failed to fetch packages');
      const json = await res.json();
      return json.data.packages || [];
    },
  });

  // Update form field
  const updateField = useCallback(<K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setError(null);
  }, []);

  // Navigation handlers
  const goNext = useCallback(() => {
    const current = form.currentStep;
    const next = current + 1;
    setForm(prev => ({ ...prev, currentStep: next }));
  }, [form.currentStep]);

  const goPrev = useCallback(() => {
    const current = form.currentStep;
    if (current > 0) {
      setForm(prev => ({ ...prev, currentStep: current - 1 }));
    } else {
      router.push('/dashboard/platform/tenants');
    }
  }, [form.currentStep, router]);

  // Auto-generate slug from name
  useEffect(() => {
    if (form.orgName && !form.orgSlug) {
      const slug = form.orgName
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 50);
      updateField('orgSlug', slug);
    }
  }, [form.orgName, form.orgSlug, updateField]);

  // Validate current step
  const canProceed = useCallback((): boolean => {
    const { currentStep } = form;

    switch (currentStep) {
      case 0: // Organisation
        return !!(form.orgName.trim() && form.orgCode.trim() && form.orgSlug.trim());
      case 1: // Primary Contact
        return !!(form.primaryContactName.trim() && form.primaryContactEmail.trim());
      case 2: // Tenant Admin
        return !!(form.tenantAdminName.trim() && form.tenantAdminEmail.trim());
      case 3: // Subscription
        return !!(form.subscriptionPackageId.trim() && form.billingInterval);
      case 4: // Branding
        return true; // Optional
      case 5: // Review
        return true;
      default:
        return false;
    }
  }, [form]);

  // Mutation
  const onboardMutation = useMutation({
    mutationFn: async () => {
      const selectedPackage = packagesData?.find(p => p.id === form.subscriptionPackageId);
      if (!selectedPackage) throw new Error('Selected package not found');

      const res = await fetch('/api/platform/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organisation: {
            name: form.orgName.trim(),
            code: form.orgCode.trim().toUpperCase(),
            slug: form.orgSlug.trim().toLowerCase(),
            type: form.orgType,
            timezone: form.timezone,
            locale: form.locale,
          },
          primaryContact: {
            name: form.primaryContactName.trim(),
            email: form.primaryContactEmail.trim().toLowerCase(),
            phone: form.primaryContactPhone.trim() || undefined,
            title: form.primaryContactTitle.trim() || undefined,
          },
          tenantAdmin: {
            email: form.tenantAdminEmail.trim().toLowerCase(),
            name: form.tenantAdminName.trim(),
          },
          subscription: {
            packageId: form.subscriptionPackageId,
            billingInterval: form.billingInterval,
            trialDays: selectedPackage.trialDays || 0,
          },
          branding: (form.brandingContactEmail || form.brandingContactPhone || form.brandingAddress ||
            form.brandingPrimaryColor !== '#1F4E8C' || form.brandingAccentColor !== '#0F766E') ? {
            contactEmail: form.brandingContactEmail.trim() || undefined,
            contactPhone: form.brandingContactPhone.trim() || undefined,
            address: form.brandingAddress.trim() || undefined,
            primaryColor: form.brandingPrimaryColor,
            accentColor: form.brandingAccentColor,
          } : undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to onboard tenant');
      return json.data;
    },
    onSuccess: () => {
      router.push('/dashboard/platform/tenants');
      toast({
        title: 'Tenant Created Successfully',
        description: `${form.orgName} has been onboarded and is awaiting invitation acceptance.`,
        variant: 'success',
      });
    },
    onError: (err: Error) => {
      setError(err.message);
      toast({
        title: 'Onboarding Failed',
        description: err.message,
        variant: 'error',
      });
    },
  });

  // Render current step
  const renderStep = () => {
    switch (form.currentStep) {
      // --- Step 0: Organisation ---
      case 0:
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label required>Organisation Name</Label>
                <Input
                  placeholder="e.g. Kavango East Regional Council"
                  value={form.orgName}
                  onChange={(e) => updateField('orgName', e.target.value)}
                  className="h-11"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label required>Code</Label>
                  <Input
                    placeholder="e.g. KERC"
                    value={form.orgCode}
                    onChange={(e) => updateField('orgCode', e.target.value.toUpperCase())}
                    className="h-11 font-mono"
                  />
                  <p className="text-xs text-ink-400">Unique 4-letter code (auto-uppercased)</p>
                </div>

                <div className="space-y-1.5">
                  <Label required>Slug</Label>
                  <Input
                    placeholder="e.g. kavango-east"
                    value={form.orgSlug}
                    onChange={(e) => updateField('orgSlug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                    className="h-11 font-mono"
                  />
                  <p className="text-xs text-ink-400">URL-friendly identifier (auto-generated from name)</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <StyledSelect
                    value={form.orgType}
                    onChange={(e) => updateField('orgType', e.target.value)}
                  >
                    {ORG_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </StyledSelect>
                </div>

                <div className="space-y-1.5">
                  <Label>Timezone</Label>
                  <StyledSelect
                    value={form.timezone}
                    onChange={(e) => updateField('timezone', e.target.value)}
                  >
                    <option value="Africa/Windhoek">Africa/Windhoek (UTC+2)</option>
                  </StyledSelect>
                </div>
              </div>
            </div>
          </div>
        );

      // --- Step 1: Primary Contact ---
      case 1:
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label required>Full Name</Label>
                <Input
                  placeholder="e.g. John Doe"
                  value={form.primaryContactName}
                  onChange={(e) => updateField('primaryContactName', e.target.value)}
                  className="h-11"
                />
              </div>

              <div className="space-y-1.5">
                <Label required>Email Address</Label>
                <Input
                  type="email"
                  placeholder="john@council.gov.na"
                  value={form.primaryContactEmail}
                  onChange={(e) => updateField('primaryContactEmail', e.target.value)}
                  className="h-11"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input
                    placeholder="+264 61 123 456"
                    value={form.primaryContactPhone}
                    onChange={(e) => updateField('primaryContactPhone', e.target.value)}
                    className="h-11"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Title</Label>
                  <Input
                    placeholder="e.g. Transport Director"
                    value={form.primaryContactTitle}
                    onChange={(e) => updateField('primaryContactTitle', e.target.value)}
                    className="h-11"
                  />
                </div>
              </div>
            </div>
          </div>
        );

      // --- Step 2: Tenant Admin ---
      case 2:
        return (
          <div className="space-y-6">
            <div className="rounded-[8px] bg-brand-50 border border-brand-200 p-4 text-sm">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-brand-600 mt-0.5" />
                <div>
                  <p className="font-medium text-brand-800">Who will receive the invitation</p>
                  <p className="text-brand-700 mt-1">
                    This user will become the Tenant Administrator and have full control over the organization&apos;s fleet management system.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label required>Full Name</Label>
                <Input
                  placeholder="e.g. Jane Smith"
                  value={form.tenantAdminName}
                  onChange={(e) => updateField('tenantAdminName', e.target.value)}
                  className="h-11"
                />
              </div>

              <div className="space-y-1.5">
                <Label required>Email Address</Label>
                <Input
                  type="email"
                  placeholder="jane@council.gov.na"
                  value={form.tenantAdminEmail}
                  onChange={(e) => updateField('tenantAdminEmail', e.target.value)}
                  className="h-11"
                />
                <p className="text-xs text-ink-400">This person will receive an invitation email to set up their account</p>
              </div>
            </div>
          </div>
        );

      // --- Step 3: Subscription ---
      case 3:
        if (packagesLoading) {
          return (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
            </div>
          );
        }

        return (
          <div className="space-y-6">
            <div className="space-y-1.5">
              <Label required>Subscription Package</Label>
              <StyledSelect
                value={form.subscriptionPackageId}
                onChange={(e) => updateField('subscriptionPackageId', e.target.value)}
              >
                <option value="">Select a package...</option>
                {packagesData?.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.name} - {pkg.code} ({pkg.trialDays > 0 ? `${pkg.trialDays}-day trial` : 'No trial'})
                  </option>
                ))}
              </StyledSelect>
            </div>

            {form.subscriptionPackageId && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Package Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {(() => {
                    const pkg = packagesData?.find(p => p.id === form.subscriptionPackageId);
                    if (!pkg) return null;
                    return (
                      <div className="space-y-1">
                        <p><span className="text-ink-500">Code:</span> {pkg.code}</p>
                        <p><span className="text-ink-500">Trial:</span> {pkg.trialDays > 0 ? `${pkg.trialDays} days` : 'None'}</p>
                        <p><span className="text-ink-500">Features:</span> {pkg.features?.join(', ') || 'Standard features'}</p>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            )}

            <div className="space-y-1.5">
              <Label required>Billing Interval</Label>
              <StyledSelect
                value={form.billingInterval}
                onChange={(e) => updateField('billingInterval', e.target.value as 'monthly' | 'quarterly' | 'annually')}
              >
                {BILLING_INTERVALS.map((interval) => (
                  <option key={interval.value} value={interval.value}>
                    {interval.label} - {interval.suffix}
                  </option>
                ))}
              </StyledSelect>
            </div>
          </div>
        );

      // --- Step 4: Branding (Optional) ---
      case 4:
        return (
          <div className="space-y-6">
            <p className="text-sm text-ink-500">Optional branding elements to customize the tenant&apos;s workspace appearance.</p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Contact Email</Label>
                  <Input
                    type="email"
                    placeholder="contact@council.gov.na"
                    value={form.brandingContactEmail}
                    onChange={(e) => updateField('brandingContactEmail', e.target.value)}
                    className="h-11"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Contact Phone</Label>
                  <Input
                    placeholder="+264 61 123 456"
                    value={form.brandingContactPhone}
                    onChange={(e) => updateField('brandingContactPhone', e.target.value)}
                    className="h-11"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Address</Label>
                <textarea
                  className="min-h-[60px] w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 resize-y"
                  placeholder="Physical address of the organisation headquarters"
                  value={form.brandingAddress}
                  onChange={(e) => updateField('brandingAddress', e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Primary Color</Label>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-10 w-10 rounded-[6px] border border-border shrink-0"
                      style={{ backgroundColor: form.brandingPrimaryColor }}
                    />
                    <Input
                      type="text"
                      value={form.brandingPrimaryColor}
                      onChange={(e) => updateField('brandingPrimaryColor', e.target.value)}
                      className="h-11 font-mono flex-1"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Accent Color</Label>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-10 w-10 rounded-[6px] border border-border shrink-0"
                      style={{ backgroundColor: form.brandingAccentColor }}
                    />
                    <Input
                      type="text"
                      value={form.brandingAccentColor}
                      onChange={(e) => updateField('brandingAccentColor', e.target.value)}
                      className="h-11 font-mono flex-1"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[8px] bg-muted border border-border p-3 text-xs text-ink-500">
              <p className="font-medium mb-1">💡 Pro Tips:</p>
              <ul className="space-y-1 ml-4 list-disc">
                <li>Brand colors will be used throughout the tenant&apos;s dashboard and export documents</li>
                <li>Keep colors in the brand guidelines palette for consistency</li>
                <li>All branding fields are optional and can be updated later</li>
              </ul>
            </div>
          </div>
        );

      // --- Step 5: Review ---
      case 5:
        return (
          <div className="space-y-6">
            <div className="text-center pb-4">
              <CheckCircle2 className="h-12 w-12 text-brand-600 mx-auto mb-3" />
              <h3 className="text-lg font-medium text-ink-900">Review Your Organisation Details</h3>
              <p className="text-sm text-ink-500">Please review all information before creating the tenant</p>
            </div>

            <div className="space-y-4">
              {/* Organisation Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Organisation</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p><span className="text-ink-500">Name:</span> {form.orgName}</p>
                  <p><span className="text-ink-500">Code:</span> {form.orgCode}</p>
                  <p><span className="text-ink-500">Slug:</span> {form.orgSlug}</p>
                  <p><span className="text-ink-500">Type:</span> {ORG_TYPES.find((t) => t.value === form.orgType)?.label}</p>
                </CardContent>
              </Card>

              {/* Primary Contact Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Primary Contact</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p><span className="text-ink-500">Name:</span> {form.primaryContactName}</p>
                  <p><span className="text-ink-500">Email:</span> {form.primaryContactEmail}</p>
                  {(form.primaryContactPhone || form.primaryContactTitle) && (
                    <div className="pt-1">
                      {form.primaryContactPhone && <p><span className="text-ink-500">Phone:</span> {form.primaryContactPhone}</p>}
                      {form.primaryContactTitle && <p><span className="text-ink-500">Title:</span> {form.primaryContactTitle}</p>}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Tenant Admin Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Tenant Administrator</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p><span className="text-ink-500">Name:</span> {form.tenantAdminName}</p>
                  <p><span className="text-ink-500">Email:</span> {form.tenantAdminEmail}</p>
                </CardContent>
              </Card>

              {/* Subscription Summary */}
              {(() => {
                const pkg = packagesData?.find(p => p.id === form.subscriptionPackageId);
                if (!pkg) return null;
                return (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Subscription</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <p><span className="text-ink-500">Package:</span> {pkg.name} ({pkg.code})</p>
                      <p><span className="text-ink-500">Trial:</span> {pkg.trialDays > 0 ? `${pkg.trialDays} days` : 'None'}</p>
                      <p><span className="text-ink-500">Billing:</span> {form.billingInterval}</p>
                    </CardContent>
                  </Card>
                );
              })()}

              {/* Branding Summary */}
              {(form.brandingContactEmail || form.brandingContactPhone || form.brandingAddress) && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Branding</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {form.brandingContactEmail && <p><span className="text-ink-500">Contact Email:</span> {form.brandingContactEmail}</p>}
                    {form.brandingContactPhone && <p><span className="text-ink-500">Contact Phone:</span> {form.brandingContactPhone}</p>}
                    {form.brandingAddress && <p><span className="text-ink-500">Address:</span> {form.brandingAddress}</p>}
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="rounded-[8px] bg-amber-50 border border-amber-200 p-4 text-sm">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-amber-600 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-800">Important</p>
                  <p className="text-amber-700 mt-1">
                    A Tenant Administrator invitation will be sent to <strong>{form.tenantAdminEmail}</strong>.
                    This user will need to accept the invitation to activate their account.
                  </p>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Tenants', href: '/dashboard/platform/tenants' },
        { label: 'Onboard New Tenant' },
      ]} />

      <PageHeader
        title="Onboard New Tenant"
        description="Create a new organisation on the fleet management platform through the 7-step onboarding wizard"
      />

      {/* Step Indicator */}
      <div className="flex items-center gap-0 overflow-x-auto pb-2">
        {STEPS.map((step, index) => (
          <div key={index} className="flex items-center gap-0">
            <button
              onClick={() => index < form.currentStep && setForm(prev => ({ ...prev, currentStep: index }))}
              className={`flex flex-col items-center gap-1 px-3 py-2 rounded-[8px] transition-all min-w-[80px] ${
                index === form.currentStep
                  ? 'bg-brand-600 text-white shadow-sm'
                  : index < form.currentStep
                    ? 'bg-brand-100 text-brand-700 hover:bg-brand-200 cursor-pointer'
                    : 'bg-muted text-ink-400'
              }`}
            >
              <step.icon className="h-4 w-4" />
              <span className="text-xs font-medium whitespace-nowrap">{step.label}</span>
            </button>
            {index < STEPS.length - 1 && (
              <div className={`h-px w-4 ${index < form.currentStep ? 'bg-brand-400' : 'bg-muted'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            {(() => {
              const currentStep = STEPS[form.currentStep];
              return (
                <>
                  <currentStep.icon className="h-5 w-5 text-brand-600" />
                  <CardTitle>{currentStep.label}</CardTitle>
                </>
              );
            })()}
          </div>
          <p className="text-sm text-ink-500 mt-1">{STEPS[form.currentStep]?.description}</p>
        </CardHeader>

        <CardContent className="space-y-4">
          {renderStep()}

          {error && (
            <div className="rounded-[8px] bg-status-error-bg p-3 text-sm text-status-error-text">
              {error}
            </div>
          )}

          {/* Navigation */}
          <div className="mt-6 flex items-center justify-between">
            <Button
              variant="tertiary"
              size="default"
              onClick={goPrev}
              disabled={onboardMutation.isPending}
            >
              <ChevronLeft className="h-4 w-4" />
              {form.currentStep === 0 ? 'Cancel' : 'Back'}
            </Button>

            {form.currentStep < STEPS.length - 1 ? (
              <Button
                variant="primary"
                size="default"
                onClick={goNext}
                disabled={!canProceed() || onboardMutation.isPending}
              >
                Continue
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="primary"
                size="default"
                onClick={() => onboardMutation.mutate()}
                loading={onboardMutation.isPending}
                disabled={!canProceed()}
              >
                {onboardMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Creating Tenant...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" /> Create Tenant & Send Invitation
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}