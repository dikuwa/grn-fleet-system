'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import {
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Info,
  Loader2,
  Mail,
  Palette,
  Shield,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import type { PackageWithEntitlements } from '@/lib/platform/packages';

interface OnboardingForm {
  orgName: string;
  orgCode: string;
  orgSlug: string;
  orgType: string;
  timezone: string;
  locale: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string;
  primaryContactTitle: string;
  tenantAdminEmail: string;
  tenantAdminName: string;
  subscriptionPackageId: string;
  billingInterval: 'monthly' | 'quarterly' | 'annually';
  brandingContactEmail: string;
  brandingContactPhone: string;
  brandingAddress: string;
  brandingPrimaryColor: string;
  brandingAccentColor: string;
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
  { label: 'Tenant Admin', icon: Shield, description: 'Primary administrator who will receive the invitation' },
  { label: 'Subscription', icon: Clock, description: 'Package and billing configuration' },
  { label: 'Branding', icon: Palette, description: 'Optional organisation branding' },
  { label: 'Review', icon: CheckCircle2, description: 'Review all configuration before creation' },
];

const makeSlug = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50);

export default function OnboardTenantPage() {
  const router = useRouter();
  const [form, setForm] = useState<OnboardingForm>({ ...DEFAULT_FORM });
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const {
    data: packagesData,
    isLoading: packagesLoading,
    isError: packagesError,
    refetch: refetchPackages,
  } = useQuery<PackageWithEntitlements[]>({
    queryKey: ['onboarding-packages'],
    queryFn: async () => {
      const res = await fetch('/api/platform/onboard');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch packages');
      return json.data?.packages || [];
    },
  });

  const updateField = useCallback(
    <K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) => {
      setForm((previous) => ({ ...previous, [key]: value }));
      setError(null);
    },
    [],
  );

  const updateOrganisationName = (name: string) => {
    setForm((previous) => ({
      ...previous,
      orgName: name,
      orgSlug: !previous.orgSlug || previous.orgSlug === makeSlug(previous.orgName)
        ? makeSlug(name)
        : previous.orgSlug,
    }));
    setError(null);
  };

  const goNext = () => {
    setForm((previous) => ({
      ...previous,
      currentStep: Math.min(previous.currentStep + 1, STEPS.length - 1),
    }));
  };

  const goPrev = () => {
    if (form.currentStep > 0) {
      setForm((previous) => ({ ...previous, currentStep: previous.currentStep - 1 }));
      return;
    }
    router.push('/dashboard/platform/tenants');
  };

  const canProceed = (): boolean => {
    switch (form.currentStep) {
      case 0:
        return Boolean(form.orgName.trim() && form.orgCode.trim() && form.orgSlug.trim());
      case 1:
        return Boolean(form.primaryContactName.trim() && form.primaryContactEmail.trim());
      case 2:
        return Boolean(form.tenantAdminName.trim() && form.tenantAdminEmail.trim());
      case 3:
        return Boolean(form.subscriptionPackageId.trim() && form.billingInterval);
      case 4:
      case 5:
        return true;
      default:
        return false;
    }
  };

  const onboardMutation = useMutation({
    mutationFn: async () => {
      const selectedPackage = packagesData?.find((pkg) => pkg.id === form.subscriptionPackageId);
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
          branding:
            form.brandingContactEmail ||
            form.brandingContactPhone ||
            form.brandingAddress ||
            form.brandingPrimaryColor !== '#1F4E8C' ||
            form.brandingAccentColor !== '#0F766E'
              ? {
                  contactEmail: form.brandingContactEmail.trim() || undefined,
                  contactPhone: form.brandingContactPhone.trim() || undefined,
                  address: form.brandingAddress.trim() || undefined,
                  primaryColor: form.brandingPrimaryColor,
                  accentColor: form.brandingAccentColor,
                }
              : undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to onboard tenant');
      return json.data;
    },
    onSuccess: () => {
      toast({
        title: 'Tenant created successfully',
        description: `${form.orgName} has been onboarded and is awaiting invitation acceptance.`,
        variant: 'success',
      });
      router.push('/dashboard/platform/tenants');
    },
    onError: (err: Error) => {
      setError(err.message);
      toast({ title: 'Onboarding failed', description: err.message, variant: 'error' });
    },
  });

  const selectedPackage = packagesData?.find((pkg) => pkg.id === form.subscriptionPackageId);

  const renderStep = () => {
    switch (form.currentStep) {
      case 0:
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label required>Organisation Name</Label>
              <Input
                placeholder="e.g. Kavango East Regional Council"
                value={form.orgName}
                onChange={(e) => updateOrganisationName(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label required>Code</Label>
                <Input
                  placeholder="e.g. KERC"
                  value={form.orgCode}
                  onChange={(e) => updateField('orgCode', e.target.value.toUpperCase())}
                  className="font-mono"
                />
                <p className="text-ink-400 text-xs">Unique organisation code.</p>
              </div>
              <div className="space-y-1.5">
                <Label required>Slug</Label>
                <Input
                  placeholder="e.g. kavango-east"
                  value={form.orgSlug}
                  onChange={(e) => updateField('orgSlug', makeSlug(e.target.value))}
                  className="font-mono"
                />
                <p className="text-ink-400 text-xs">URL-friendly identifier.</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <StyledSelect value={form.orgType} onChange={(e) => updateField('orgType', e.target.value)}>
                  {ORG_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </StyledSelect>
              </div>
              <div className="space-y-1.5">
                <Label>Timezone</Label>
                <StyledSelect value={form.timezone} onChange={(e) => updateField('timezone', e.target.value)}>
                  <option value="Africa/Windhoek">Africa/Windhoek (UTC+2)</option>
                </StyledSelect>
              </div>
            </div>
          </div>
        );

      case 1:
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label required>Full Name</Label>
              <Input value={form.primaryContactName} onChange={(e) => updateField('primaryContactName', e.target.value)} placeholder="e.g. John Doe" />
            </div>
            <div className="space-y-1.5">
              <Label required>Email Address</Label>
              <Input type="email" value={form.primaryContactEmail} onChange={(e) => updateField('primaryContactEmail', e.target.value)} placeholder="john@organisation.na" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input type="tel" value={form.primaryContactPhone} onChange={(e) => updateField('primaryContactPhone', e.target.value)} placeholder="+264 61 123 456" />
              </div>
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input value={form.primaryContactTitle} onChange={(e) => updateField('primaryContactTitle', e.target.value)} placeholder="e.g. Transport Director" />
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-5">
            <div className="border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-800 dark:bg-brand-950/30 dark:text-brand-200 rounded-[8px] border p-4 text-sm">
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-medium">Tenant Administrator invitation</p>
                  <p className="mt-1 opacity-80">This person receives the setup invitation and becomes the organisation administrator after acceptance.</p>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label required>Full Name</Label>
              <Input value={form.tenantAdminName} onChange={(e) => updateField('tenantAdminName', e.target.value)} placeholder="e.g. Jane Smith" />
            </div>
            <div className="space-y-1.5">
              <Label required>Email Address</Label>
              <Input type="email" value={form.tenantAdminEmail} onChange={(e) => updateField('tenantAdminEmail', e.target.value)} placeholder="jane@organisation.na" />
              <p className="text-ink-400 text-xs">The invitation is sent to this address.</p>
            </div>
          </div>
        );

      case 3:
        if (packagesLoading) {
          return <div className="text-ink-500 flex items-center justify-center gap-2 py-12 text-sm"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />Loading packages…</div>;
        }
        if (packagesError) {
          return (
            <div className="space-y-3 py-6 text-center">
              <p className="text-status-error-text text-sm">Subscription packages could not be loaded.</p>
              <Button variant="secondary" size="sm" onClick={() => void refetchPackages()}>Retry</Button>
            </div>
          );
        }
        if (!packagesData?.length) {
          return (
            <div className="border-status-warning-text/20 bg-status-warning-bg rounded-[8px] border p-4">
              <p className="text-status-warning-text text-sm font-medium">No active subscription package is available.</p>
              <p className="text-ink-500 mt-1 text-xs">Create or activate a package in Subscription Packages before onboarding a tenant.</p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => router.push('/dashboard/platform/packages')}>Open Packages</Button>
            </div>
          );
        }
        return (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label required>Subscription Package</Label>
              <StyledSelect value={form.subscriptionPackageId} onChange={(e) => updateField('subscriptionPackageId', e.target.value)}>
                <option value="">Select a package...</option>
                {packagesData.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>{pkg.name} — {pkg.code}{pkg.trialDays > 0 ? ` (${pkg.trialDays}-day trial)` : ''}</option>
                ))}
              </StyledSelect>
            </div>

            {selectedPackage && (
              <div className="border-border bg-muted/30 rounded-[8px] border p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div><p className="text-ink-400 text-xs">Package</p><p className="text-ink-950 mt-1 text-sm font-medium">{selectedPackage.name}</p></div>
                  <div><p className="text-ink-400 text-xs">Code</p><p className="text-ink-950 mt-1 font-mono text-sm">{selectedPackage.code}</p></div>
                  <div><p className="text-ink-400 text-xs">Trial</p><p className="text-ink-950 mt-1 text-sm">{selectedPackage.trialDays > 0 ? `${selectedPackage.trialDays} days` : 'None'}</p></div>
                </div>
                <p className="text-ink-500 mt-3 text-xs">{Object.values(selectedPackage.features ?? {}).filter(Boolean).length} enabled capabilities</p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label required>Billing Interval</Label>
              <StyledSelect value={form.billingInterval} onChange={(e) => updateField('billingInterval', e.target.value as OnboardingForm['billingInterval'])}>
                {BILLING_INTERVALS.map((interval) => <option key={interval.value} value={interval.value}>{interval.label} — {interval.suffix}</option>)}
              </StyledSelect>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-5">
            <p className="text-ink-500 text-sm">Optional organisation details. They can be changed later by an authorised administrator.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Contact Email</Label>
                <Input type="email" value={form.brandingContactEmail} onChange={(e) => updateField('brandingContactEmail', e.target.value)} placeholder="contact@organisation.na" />
              </div>
              <div className="space-y-1.5">
                <Label>Contact Phone</Label>
                <Input type="tel" value={form.brandingContactPhone} onChange={(e) => updateField('brandingContactPhone', e.target.value)} placeholder="+264 61 123 456" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Textarea value={form.brandingAddress} onChange={(e) => updateField('brandingAddress', e.target.value)} rows={3} placeholder="Physical address of the organisation headquarters" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {([
                ['brandingPrimaryColor', 'Primary Color'],
                ['brandingAccentColor', 'Accent Color'],
              ] as const).map(([field, label]) => (
                <div key={field} className="space-y-1.5">
                  <Label>{label}</Label>
                  <div className="flex items-center gap-2">
                    <span className="border-border h-10 w-10 shrink-0 rounded-[7px] border" style={{ backgroundColor: form[field] }} aria-hidden="true" />
                    <Input value={form[field]} onChange={(e) => updateField(field, e.target.value)} className="font-mono" aria-label={`${label} hexadecimal value`} />
                  </div>
                </div>
              ))}
            </div>
            <div className="border-border bg-muted/40 rounded-[8px] border p-3">
              <div className="flex gap-2">
                <Info className="text-ink-400 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p className="text-ink-500 text-xs leading-relaxed">Use approved organisation brand colours. Branding can be updated later without repeating onboarding.</p>
              </div>
            </div>
          </div>
        );

      case 5:
        return (
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="text-status-success-text mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
              <div>
                <h3 className="text-ink-950 font-semibold">Review before creating the tenant</h3>
                <p className="text-ink-500 mt-1 text-sm">Confirm the organisation, administrator and subscription information.</p>
              </div>
            </div>

            <div className="border-border divide-border overflow-hidden rounded-[8px] border divide-y">
              <ReviewSection title="Organisation" rows={[
                ['Name', form.orgName],
                ['Code', form.orgCode],
                ['Slug', form.orgSlug],
                ['Type', ORG_TYPES.find((type) => type.value === form.orgType)?.label || form.orgType],
              ]} />
              <ReviewSection title="Primary Contact" rows={[
                ['Name', form.primaryContactName],
                ['Email', form.primaryContactEmail],
                ['Phone', form.primaryContactPhone || 'Not provided'],
                ['Title', form.primaryContactTitle || 'Not provided'],
              ]} />
              <ReviewSection title="Tenant Administrator" rows={[
                ['Name', form.tenantAdminName],
                ['Email', form.tenantAdminEmail],
              ]} />
              {selectedPackage && <ReviewSection title="Subscription" rows={[
                ['Package', `${selectedPackage.name} (${selectedPackage.code})`],
                ['Trial', selectedPackage.trialDays > 0 ? `${selectedPackage.trialDays} days` : 'None'],
                ['Billing', form.billingInterval],
              ]} />}
            </div>

            <div className="border-status-warning-text/20 bg-status-warning-bg rounded-[8px] border p-4 text-sm">
              <div className="flex items-start gap-3">
                <Info className="text-status-warning-text mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-status-warning-text font-medium">Invitation will be sent after creation</p>
                  <p className="text-ink-600 mt-1">The Tenant Administrator invitation will be sent to <strong>{form.tenantAdminEmail}</strong>. The account becomes usable after the invitation is accepted.</p>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const currentStep = STEPS[form.currentStep];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Breadcrumbs items={[
        { label: 'Platform', href: '/dashboard/platform' },
        { label: 'Tenants', href: '/dashboard/platform/tenants' },
        { label: 'Onboard Tenant' },
      ]} />
      <PageHeader
        title="Onboard New Tenant"
        description={`Create a new organisation through a controlled ${STEPS.length}-step setup and invitation workflow.`}
      />

      <div className="border-border overflow-x-auto border-y py-3" aria-label={`Step ${form.currentStep + 1} of ${STEPS.length}`}>
        <div className="flex min-w-max items-center gap-1 px-1 sm:min-w-0 sm:justify-between">
          {STEPS.map((step, index) => {
            const StepIcon = step.icon;
            const active = index === form.currentStep;
            const complete = index < form.currentStep;
            return (
              <button
                key={step.label}
                type="button"
                onClick={() => complete && setForm((previous) => ({ ...previous, currentStep: index }))}
                disabled={!complete}
                aria-current={active ? 'step' : undefined}
                className={`focus-ring flex min-h-10 items-center gap-2 rounded-[8px] px-3 py-2 text-xs font-medium transition-colors motion-reduce:transition-none ${
                  active
                    ? 'bg-brand-800 text-white'
                    : complete
                      ? 'text-brand-700 hover:bg-brand-50 disabled:cursor-default'
                      : 'text-ink-400 disabled:cursor-default'
                }`}
              >
                <StepIcon className="h-4 w-4" aria-hidden="true" />
                <span>{step.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <currentStep.icon className="text-brand-700 mt-0.5 h-5 w-5" aria-hidden="true" />
            <div>
              <CardTitle>{currentStep.label}</CardTitle>
              <p className="text-ink-500 mt-1 text-sm">{currentStep.description}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {renderStep()}

          {error && <div className="bg-status-error-bg text-status-error-text rounded-[8px] p-3 text-sm" role="alert">{error}</div>}

          <div className="border-border mt-6 flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="tertiary" onClick={goPrev} disabled={onboardMutation.isPending} className="justify-center sm:justify-start">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> {form.currentStep === 0 ? 'Cancel' : 'Back'}
            </Button>

            {form.currentStep < STEPS.length - 1 ? (
              <Button onClick={goNext} disabled={!canProceed() || onboardMutation.isPending} className="justify-center sm:justify-start">
                Continue <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button onClick={() => onboardMutation.mutate()} loading={onboardMutation.isPending} disabled={!canProceed()} className="justify-center sm:justify-start">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Create Tenant & Send Invitation
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ReviewSection({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <section className="grid gap-3 p-4 sm:grid-cols-[150px_1fr]">
      <h4 className="text-ink-950 text-sm font-semibold">{title}</h4>
      <dl className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-0.5 sm:grid-cols-[120px_1fr] sm:gap-3">
            <dt className="text-ink-500 text-xs">{label}</dt>
            <dd className="text-ink-800 min-w-0 break-words text-sm">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
