'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Info,
  Loader2,
  Mail,
  MonitorPlay,
  Palette,
  Shield,
} from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';
import type { PackageWithEntitlements } from '@/lib/platform/packages';

interface DemoPrefill {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string;
  jobTitle: string;
  industry: string | null;
  vehicleCount: number | null;
  userCount: number | null;
  status: string;
}

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
  orgName: '', orgCode: '', orgSlug: '', orgType: 'regional_council', timezone: 'Africa/Windhoek', locale: 'en-NA',
  primaryContactName: '', primaryContactEmail: '', primaryContactPhone: '', primaryContactTitle: '',
  tenantAdminEmail: '', tenantAdminName: '', subscriptionPackageId: '', billingInterval: 'monthly',
  brandingContactEmail: '', brandingContactPhone: '', brandingAddress: '', brandingPrimaryColor: '#1F4E8C', brandingAccentColor: '#0F766E',
  currentStep: 0,
};

const ORG_TYPES = [
  { value: 'regional_council', label: 'Regional Council' },
  { value: 'ministry', label: 'Ministry / National Office' },
  { value: 'agency', label: 'Government Agency' },
  { value: 'municipality', label: 'Municipality' },
  { value: 'public_enterprise', label: 'Public Enterprise' },
  { value: 'private_organisation', label: 'Private Organisation' },
];

const STEPS = [
  { label: 'Organisation', icon: Building2 },
  { label: 'Primary Contact', icon: Mail },
  { label: 'Tenant Admin', icon: Shield },
  { label: 'Subscription', icon: Clock },
  { label: 'Branding', icon: Palette },
  { label: 'Review', icon: CheckCircle2 },
];

const makeSlug = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 50);
const makeCode = (value: string) => value.split(/\s+/).map((part) => part[0]).join('').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8);

function ReviewRows({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="p-4"><h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</h3><dl className="mt-3 grid gap-2 sm:grid-cols-2">{rows.map(([label, value]) => <div key={label}><dt className="text-xs text-ink-400">{label}</dt><dd className="mt-0.5 text-sm font-medium text-ink-900">{value || '—'}</dd></div>)}</dl></div>
  );
}

export default function OnboardTenantPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState<OnboardingForm>({ ...DEFAULT_FORM });
  const [error, setError] = useState<string | null>(null);
  const [demoRequestId, setDemoRequestId] = useState<string | null>(null);
  const [demoPrefill, setDemoPrefill] = useState<DemoPrefill | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);

  const packagesQuery = useQuery<PackageWithEntitlements[]>({
    queryKey: ['onboarding-packages'],
    queryFn: async () => {
      const res = await fetch('/api/platform/onboard');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch packages');
      return json.data?.packages ?? [];
    },
  });

  useEffect(() => {
    const requestId = new URLSearchParams(window.location.search).get('demoRequest');
    if (!requestId) return;
    setDemoRequestId(requestId);
    setDemoLoading(true);
    void fetch(`/api/platform/demo-requests?id=${encodeURIComponent(requestId)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Demo request could not be loaded');
        const demo = json.data?.request as DemoPrefill;
        setDemoPrefill(demo);
        const slug = makeSlug(demo.company);
        const code = makeCode(demo.company);
        const type = demo.industry && ['regional_council', 'ministry', 'agency', 'municipality', 'public_enterprise', 'private_organisation'].includes(demo.industry)
          ? demo.industry
          : 'regional_council';
        setForm((current) => ({
          ...current,
          orgName: demo.company,
          orgCode: code,
          orgSlug: slug,
          orgType: type,
          primaryContactName: demo.name,
          primaryContactEmail: demo.email,
          primaryContactPhone: demo.phone ?? '',
          primaryContactTitle: demo.jobTitle ?? '',
          tenantAdminName: demo.name,
          tenantAdminEmail: demo.email,
          brandingContactEmail: demo.email,
          brandingContactPhone: demo.phone ?? '',
        }));
      })
      .catch((err) => toast({ title: 'Demo prefill unavailable', description: err instanceof Error ? err.message : 'Could not load demo request', variant: 'error' }))
      .finally(() => setDemoLoading(false));
  }, [toast]);

  useEffect(() => {
    if (!form.subscriptionPackageId && packagesQuery.data?.[0]?.id) {
      setForm((current) => ({ ...current, subscriptionPackageId: packagesQuery.data?.[0]?.id ?? '' }));
    }
  }, [form.subscriptionPackageId, packagesQuery.data]);

  const updateField = useCallback(<K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  }, []);

  const updateOrganisationName = (name: string) => {
    setForm((current) => {
      const previousAutoSlug = makeSlug(current.orgName);
      const previousAutoCode = makeCode(current.orgName);
      return {
        ...current,
        orgName: name,
        orgSlug: !current.orgSlug || current.orgSlug === previousAutoSlug ? makeSlug(name) : current.orgSlug,
        orgCode: !current.orgCode || current.orgCode === previousAutoCode ? makeCode(name) : current.orgCode,
      };
    });
  };

  const selectedPackage = packagesQuery.data?.find((pkg) => pkg.id === form.subscriptionPackageId);

  const canProceed = useMemo(() => {
    if (form.currentStep === 0) return Boolean(form.orgName.trim() && form.orgCode.trim() && form.orgSlug.trim());
    if (form.currentStep === 1) return Boolean(form.primaryContactName.trim() && form.primaryContactEmail.trim());
    if (form.currentStep === 2) return Boolean(form.tenantAdminName.trim() && form.tenantAdminEmail.trim());
    if (form.currentStep === 3) return Boolean(form.subscriptionPackageId);
    return true;
  }, [form]);

  const onboardMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPackage) throw new Error('Select an active subscription package');
      const res = await fetch('/api/platform/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organisation: { name: form.orgName.trim(), code: form.orgCode.trim().toUpperCase(), slug: form.orgSlug.trim().toLowerCase(), type: form.orgType, timezone: form.timezone, locale: form.locale },
          primaryContact: { name: form.primaryContactName.trim(), email: form.primaryContactEmail.trim().toLowerCase(), phone: form.primaryContactPhone.trim() || undefined, title: form.primaryContactTitle.trim() || undefined },
          tenantAdmin: { email: form.tenantAdminEmail.trim().toLowerCase(), name: form.tenantAdminName.trim() },
          subscription: { packageId: form.subscriptionPackageId, billingInterval: form.billingInterval, trialDays: selectedPackage.trialDays || 0 },
          branding: { contactEmail: form.brandingContactEmail.trim() || undefined, contactPhone: form.brandingContactPhone.trim() || undefined, address: form.brandingAddress.trim() || undefined, primaryColor: form.brandingPrimaryColor, accentColor: form.brandingAccentColor },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to onboard tenant');
      return json.data;
    },
    onSuccess: async (data) => {
      let conversionWarning = false;
      if (demoRequestId && data?.tenant?.id) {
        try {
          const response = await fetch('/api/platform/demo-requests/convert', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ demoRequestId, tenantId: data.tenant.id }),
          });
          if (!response.ok) conversionWarning = true;
        } catch { conversionWarning = true; }
      }
      toast({
        title: 'Tenant created successfully',
        description: conversionWarning
          ? 'Tenant created, but the demo lead could not be marked converted. Review the Demo Requests queue.'
          : demoRequestId ? 'Tenant created and the demo evaluation was converted into onboarding.' : 'Tenant created and the administrator invitation was prepared.',
        variant: conversionWarning ? 'default' : 'success',
      });
      router.push(data?.tenant?.id ? `/dashboard/platform/tenants/${data.tenant.id}` : '/dashboard/platform/tenants');
    },
    onError: (err: Error) => {
      setError(err.message);
      toast({ title: 'Onboarding failed', description: err.message, variant: 'error' });
    },
  });

  const goPrevious = () => {
    if (form.currentStep > 0) updateField('currentStep', form.currentStep - 1);
    else router.push(demoRequestId ? '/dashboard/platform/demo-requests' : '/dashboard/platform/tenants');
  };

  const renderStep = () => {
    switch (form.currentStep) {
      case 0:
        return <div className="space-y-4"><div className="space-y-1.5"><Label required>Organisation name</Label><Input value={form.orgName} onChange={(event) => updateOrganisationName(event.target.value)} placeholder="Organisation name" /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label required>Code</Label><Input value={form.orgCode} onChange={(event) => updateField('orgCode', event.target.value.toUpperCase())} className="font-mono" /></div><div className="space-y-1.5"><Label required>Slug</Label><Input value={form.orgSlug} onChange={(event) => updateField('orgSlug', makeSlug(event.target.value))} className="font-mono" /></div><div className="space-y-1.5"><Label>Organisation type</Label><StyledSelect value={form.orgType} onChange={(event) => updateField('orgType', event.target.value)}>{ORG_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</StyledSelect></div><div className="space-y-1.5"><Label>Timezone</Label><StyledSelect value={form.timezone} onChange={(event) => updateField('timezone', event.target.value)}><option value="Africa/Windhoek">Africa/Windhoek (UTC+2)</option></StyledSelect></div></div></div>;
      case 1:
        return <div className="space-y-4"><div className="space-y-1.5"><Label required>Full name</Label><Input value={form.primaryContactName} onChange={(event) => updateField('primaryContactName', event.target.value)} /></div><div className="space-y-1.5"><Label required>Email</Label><Input type="email" value={form.primaryContactEmail} onChange={(event) => updateField('primaryContactEmail', event.target.value)} /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label>Phone</Label><Input type="tel" value={form.primaryContactPhone} onChange={(event) => updateField('primaryContactPhone', event.target.value)} /></div><div className="space-y-1.5"><Label>Title</Label><Input value={form.primaryContactTitle} onChange={(event) => updateField('primaryContactTitle', event.target.value)} /></div></div></div>;
      case 2:
        return <div className="space-y-4"><div className="rounded-[8px] border border-brand-200 bg-brand-50/40 p-4 text-sm text-ink-700 dark:bg-brand-950/10"><div className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" /><p>This person receives the Tenant Administrator invitation. You can change the default if the demo requester is not the administrator.</p></div></div><div className="space-y-1.5"><Label required>Tenant Administrator name</Label><Input value={form.tenantAdminName} onChange={(event) => updateField('tenantAdminName', event.target.value)} /></div><div className="space-y-1.5"><Label required>Tenant Administrator email</Label><Input type="email" value={form.tenantAdminEmail} onChange={(event) => updateField('tenantAdminEmail', event.target.value)} /></div></div>;
      case 3:
        if (packagesQuery.isLoading) return <div className="flex justify-center gap-2 py-10 text-sm text-ink-500"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> Loading packages…</div>;
        if (packagesQuery.isError || !packagesQuery.data?.length) return <div className="space-y-3 rounded-[8px] border border-status-warning-text/20 bg-status-warning-bg/20 p-4"><p className="text-sm font-medium text-status-warning-text">No active package is available for onboarding.</p><Button variant="secondary" size="sm" onClick={() => router.push('/dashboard/platform/packages')}>Manage packages</Button></div>;
        return <div className="space-y-4"><div className="space-y-1.5"><Label required>Subscription package</Label><StyledSelect value={form.subscriptionPackageId} onChange={(event) => updateField('subscriptionPackageId', event.target.value)}>{packagesQuery.data.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name} ({pkg.code}){pkg.trialDays > 0 ? ` · ${pkg.trialDays}-day trial` : ''}</option>)}</StyledSelect></div>{selectedPackage && <div className="grid gap-3 rounded-[8px] border border-border bg-muted/20 p-4 sm:grid-cols-3"><div><p className="text-xs text-ink-400">Package</p><p className="mt-1 text-sm font-medium text-ink-950">{selectedPackage.name}</p></div><div><p className="text-xs text-ink-400">Vehicle limit</p><p className="mt-1 text-sm font-medium text-ink-950">{selectedPackage.maxVehicles ?? 'Unlimited'}</p></div><div><p className="text-xs text-ink-400">User limit</p><p className="mt-1 text-sm font-medium text-ink-950">{selectedPackage.maxUsers ?? 'Unlimited'}</p></div></div>}<div className="space-y-1.5"><Label>Billing interval</Label><StyledSelect value={form.billingInterval} onChange={(event) => updateField('billingInterval', event.target.value as OnboardingForm['billingInterval'])}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option></StyledSelect></div></div>;
      case 4:
        return <div className="space-y-4"><p className="text-sm text-ink-500">Optional tenant branding and contact details. These remain separate from the public website CMS.</p><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label>Contact email</Label><Input type="email" value={form.brandingContactEmail} onChange={(event) => updateField('brandingContactEmail', event.target.value)} /></div><div className="space-y-1.5"><Label>Contact phone</Label><Input type="tel" value={form.brandingContactPhone} onChange={(event) => updateField('brandingContactPhone', event.target.value)} /></div><div className="space-y-1.5"><Label>Primary colour</Label><Input value={form.brandingPrimaryColor} onChange={(event) => updateField('brandingPrimaryColor', event.target.value)} className="font-mono" /></div><div className="space-y-1.5"><Label>Accent colour</Label><Input value={form.brandingAccentColor} onChange={(event) => updateField('brandingAccentColor', event.target.value)} className="font-mono" /></div></div><div className="space-y-1.5"><Label>Address</Label><Textarea rows={3} value={form.brandingAddress} onChange={(event) => updateField('brandingAddress', event.target.value)} /></div></div>;
      case 5:
        return <div className="space-y-5"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 text-status-success-text" /><div><h3 className="text-sm font-semibold text-ink-950">Review before tenant creation</h3><p className="mt-1 text-xs text-ink-500">The organisation is not marked converted until this creation succeeds.</p></div></div><div className="divide-y divide-border overflow-hidden rounded-[8px] border border-border"><ReviewRows title="Organisation" rows={[[ 'Name', form.orgName ], [ 'Code', form.orgCode ], [ 'Type', ORG_TYPES.find((item) => item.value === form.orgType)?.label ?? form.orgType ], [ 'Slug', form.orgSlug ]]} /><ReviewRows title="Primary contact" rows={[[ 'Name', form.primaryContactName ], [ 'Email', form.primaryContactEmail ], [ 'Phone', form.primaryContactPhone ], [ 'Title', form.primaryContactTitle ]]} /><ReviewRows title="Tenant Administrator" rows={[[ 'Name', form.tenantAdminName ], [ 'Email', form.tenantAdminEmail ]]} />{selectedPackage && <ReviewRows title="Subscription" rows={[[ 'Package', `${selectedPackage.name} (${selectedPackage.code})` ], [ 'Billing', form.billingInterval ]]} />}</div></div>;
      default: return null;
    }
  };

  const CurrentIcon = STEPS[form.currentStep].icon;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Breadcrumbs items={[{ label: 'Platform', href: '/dashboard/platform' }, { label: 'Tenants', href: '/dashboard/platform/tenants' }, { label: 'Onboard Tenant' }]} />
      <PageHeader title="Onboard Tenant" description="Create the production tenant, subscription and administrator invitation through a controlled workflow." />

      {demoRequestId && <div className="flex flex-col gap-3 rounded-[8px] border border-brand-200 bg-brand-50/40 p-4 dark:bg-brand-950/10 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><MonitorPlay className="mt-0.5 h-5 w-5 text-brand-700" /><div><p className="text-sm font-semibold text-ink-950">Converting a demo evaluation</p><p className="mt-1 text-xs text-ink-500">{demoLoading ? 'Loading demo request…' : demoPrefill ? `${demoPrefill.company} · ${demoPrefill.name}${demoPrefill.vehicleCount ? ` · ${demoPrefill.vehicleCount} vehicles` : ''}` : 'The demo request could not be prefilled.'}</p></div></div>{demoPrefill && <Badge variant="info" size="sm">{demoPrefill.status}</Badge>}</div>}

      <div className="overflow-x-auto border-y border-border py-3"><div className="flex min-w-max gap-1 sm:min-w-0 sm:justify-between">{STEPS.map((step, index) => { const Icon = step.icon; const active = index === form.currentStep; const complete = index < form.currentStep; return <button key={step.label} type="button" disabled={!complete} onClick={() => complete && updateField('currentStep', index)} aria-current={active ? 'step' : undefined} className={`focus-ring inline-flex min-h-10 items-center gap-2 rounded-[7px] px-3 text-xs font-medium ${active ? 'bg-brand-800 text-white' : complete ? 'text-brand-700 hover:bg-brand-50' : 'text-ink-400'}`}><Icon className="h-4 w-4" />{step.label}</button>; })}</div></div>

      <Card><CardHeader><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700"><CurrentIcon className="h-4 w-4" /></div><div><CardTitle>{STEPS[form.currentStep].label}</CardTitle><p className="mt-0.5 text-xs text-ink-500">Step {form.currentStep + 1} of {STEPS.length}</p></div></div></CardHeader><CardContent>{renderStep()}</CardContent></Card>

      {error && <div className="rounded-[8px] border border-status-error-text/20 bg-status-error-bg/20 p-3 text-sm text-status-error-text">{error}</div>}

      <div className="mobile-action-bar flex flex-wrap items-center justify-between gap-3"><Button variant="secondary" onClick={goPrevious}><ChevronLeft className="h-4 w-4" /> {form.currentStep === 0 ? 'Cancel' : 'Back'}</Button>{form.currentStep < STEPS.length - 1 ? <Button disabled={!canProceed} onClick={() => updateField('currentStep', form.currentStep + 1)}>Continue <ChevronRight className="h-4 w-4" /></Button> : <Button onClick={() => onboardMutation.mutate()} loading={onboardMutation.isPending} disabled={onboardMutation.isPending || !canProceed}><Building2 className="h-4 w-4" /> Create tenant & invitation</Button>}</div>
    </div>
  );
}
