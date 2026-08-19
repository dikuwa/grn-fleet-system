'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StyledSelect } from '@/components/ui/styled-select';
import {
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  Palette,
  Plus,
  Save,
  Settings2,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';

const STEPS = [
  { label: 'Organisation', description: 'Confirm the tenant identity created during onboarding.', category: 'required', icon: Building2 },
  { label: 'Departments', description: 'Add organisational units if this tenant uses them.', category: 'optional', icon: Users },
  { label: 'Locations', description: 'Add at least one office, depot or other operating location.', category: 'required', icon: MapPin },
  { label: 'Branding', description: 'Set workspace colours and contact details if needed.', category: 'optional', icon: Palette },
  { label: 'Review', description: 'Complete initial setup and continue to operational setup.', category: 'final', icon: Settings2 },
] as const;

const TOTAL_STEPS = STEPS.length;
const REQUIRED_STEPS = [0, 2] as const;
const LOCKED_LIFECYCLES = new Set(['READY_FOR_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'RESTRICTED', 'ARCHIVED']);

const ORG_TYPES: Record<string, string> = {
  regional_council: 'Regional Council',
  ministry: 'Ministry / National Office',
  agency: 'Government Agency',
  municipality: 'Municipality',
  public_enterprise: 'Public Enterprise',
  private_organisation: 'Private Organisation',
};

interface TenantInfo {
  id: string;
  name: string;
  code: string;
  slug: string;
  type: string;
  timezone: string;
  locale: string;
  lifecycleStatus: string;
}

interface DepartmentInput {
  id?: string;
  name: string;
  code: string;
}

interface OfficeInput {
  id?: string;
  name: string;
  code: string;
  type: string;
  address: string;
}

interface BrandingInput {
  primaryColor: string;
  accentColor: string;
  contactEmail: string;
  contactPhone: string;
}

async function readJson(response: Response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || 'The request could not be completed.');
  return json;
}

export default function SetupWizardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [departments, setDepartments] = useState<DepartmentInput[]>([]);
  const [offices, setOffices] = useState<OfficeInput[]>([]);
  const [branding, setBranding] = useState<BrandingInput>({
    primaryColor: '#1F4E8C',
    accentColor: '#0F766E',
    contactEmail: '',
    contactPhone: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await readJson(await fetch('/api/platform/setup', { cache: 'no-store' }));
      const data = json.data;
      setTenant(data.tenant);
      setCurrentStep(Math.min(Math.max(Number(data.progress?.currentStep ?? 0), 0), TOTAL_STEPS - 1));
      setCompletedSteps(
        Array.isArray(data.progress?.completedSteps)
          ? data.progress.completedSteps.filter((step: unknown): step is number => Number.isInteger(step) && Number(step) >= 0 && Number(step) < TOTAL_STEPS)
          : [],
      );
      setDepartments(
        (data.departments ?? []).map((department: { id: string; name: string; code: string | null }) => ({
          id: department.id,
          name: department.name,
          code: department.code ?? '',
        })),
      );
      const loadedOffices = (data.offices ?? []).map((office: {
        id: string;
        name: string;
        code: string | null;
        type: string;
        address: string | null;
      }) => ({
        id: office.id,
        name: office.name,
        code: office.code ?? '',
        type: office.type,
        address: office.address ?? '',
      }));
      setOffices(
        loadedOffices.length
          ? loadedOffices
          : [{ name: 'Head Office', code: 'HO', type: 'head_office', address: '' }],
      );
      if (data.branding) {
        setBranding({
          primaryColor: data.branding.primaryColor || '#1F4E8C',
          accentColor: data.branding.accentColor || '#0F766E',
          contactEmail: data.branding.contactEmail || '',
          contactPhone: data.branding.contactPhone || '',
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load workspace setup.';
      setError(message);
      toast({ title: 'Setup could not be loaded', description: message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const persistDepartments = useCallback(async () => {
    const next: DepartmentInput[] = [];
    for (const department of departments) {
      const name = department.name.trim();
      if (!name) continue;
      const body = {
        ...(department.id ? { id: department.id } : {}),
        name,
        ...(department.code.trim() ? { code: department.code.trim() } : {}),
        type: 'department',
      };
      const json = await readJson(await fetch('/api/departments', {
        method: department.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }));
      next.push({ id: json.data.id, name: json.data.name, code: json.data.code ?? '' });
    }
    setDepartments(next);
  }, [departments]);

  const persistOffices = useCallback(async () => {
    const candidates = offices.filter((office) => office.name.trim());
    if (!candidates.length) throw new Error('Add at least one office, depot or operating location before continuing.');

    const next: OfficeInput[] = [];
    for (const office of candidates) {
      const body = {
        ...(office.id ? { id: office.id } : {}),
        name: office.name.trim(),
        ...(office.code.trim() ? { code: office.code.trim() } : {}),
        type: office.type,
        address: office.address.trim(),
      };
      const json = await readJson(await fetch('/api/offices', {
        method: office.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }));
      next.push({
        id: json.data.id,
        name: json.data.name,
        code: json.data.code ?? '',
        type: json.data.type,
        address: json.data.address ?? '',
      });
    }
    setOffices(next);
  }, [offices]);

  const persistBranding = useCallback(async () => {
    await readJson(await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branding }),
    }));
  }, [branding]);

  const persistCurrentConfiguration = useCallback(async (step: number) => {
    if (step === 1) await persistDepartments();
    if (step === 2) await persistOffices();
    if (step === 3) await persistBranding();
  }, [persistBranding, persistDepartments, persistOffices]);

  const saveProgress = useCallback(async (step: number, completed: number[]) => {
    await readJson(await fetch('/api/platform/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentStep: step,
        completedSteps: [...new Set(completed)].sort((a, b) => a - b),
        stepData: { setupVersion: 3 },
      }),
    }));
  }, []);

  const saveStep = useCallback(async (advance: boolean) => {
    if (!tenant) return;
    setSaving(true);
    setError(null);
    try {
      await persistCurrentConfiguration(currentStep);
      const nextCompleted = completedSteps.includes(currentStep)
        ? completedSteps
        : [...completedSteps, currentStep];
      const nextStep = advance ? Math.min(currentStep + 1, TOTAL_STEPS - 1) : currentStep;
      await saveProgress(nextStep, nextCompleted);
      setCompletedSteps([...new Set(nextCompleted)].sort((a, b) => a - b));
      if (advance) setCurrentStep(nextStep);
      toast({
        title: advance ? 'Step saved' : 'Progress saved',
        description: currentStep === 1 || currentStep === 2 || currentStep === 3
          ? 'Changes were saved to the live tenant configuration.'
          : 'Initial setup progress was saved.',
        variant: 'success',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save this setup step.';
      setError(message);
      toast({ title: 'Save failed', description: message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }, [completedSteps, currentStep, persistCurrentConfiguration, saveProgress, tenant, toast]);

  const completeInitialSetup = useCallback(async () => {
    if (!tenant) return;
    setSaving(true);
    setError(null);
    try {
      const json = await readJson(await fetch('/api/platform/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentStep: TOTAL_STEPS - 1,
          completedSteps: [...new Set([...completedSteps, TOTAL_STEPS - 1])].sort((a, b) => a - b),
          stepData: { setupVersion: 3 },
          action: 'complete',
        }),
      }));
      setTenant((current) => current ? { ...current, lifecycleStatus: json.data.lifecycleStatus } : current);
      setCompletedSteps((steps) => [...new Set([...steps, TOTAL_STEPS - 1])].sort((a, b) => a - b));
      toast({
        title: 'Initial setup complete',
        description: 'Next, configure the required operational workflow and review the recommended setup items.',
        variant: 'success',
      });
      router.push(json.data.nextHref || '/dashboard/setup/operational');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not complete initial setup.';
      setError(message);
      toast({ title: 'Initial setup incomplete', description: message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }, [completedSteps, router, tenant, toast]);

  const canContinue = useMemo(() => {
    if (!tenant) return false;
    if (currentStep === 2) return offices.some((office) => office.name.trim());
    return currentStep < TOTAL_STEPS - 1;
  }, [currentStep, offices, tenant]);

  const progress = Math.round((completedSteps.filter((step) => step < TOTAL_STEPS - 1).length / (TOTAL_STEPS - 1)) * 100);
  const activeStep = STEPS[currentStep];
  const setupClosed = Boolean(tenant && LOCKED_LIFECYCLES.has(tenant.lifecycleStatus));
  const alreadySubmitted = tenant?.lifecycleStatus === 'PENDING_PLATFORM_REVIEW';
  const requiredReady = REQUIRED_STEPS.every((step) => completedSteps.includes(step));

  if (loading) {
    return (
      <div className="text-ink-500 flex min-h-[55dvh] items-center justify-center gap-2 text-sm" role="status">
        <Loader2 className="text-brand-700 h-5 w-5 animate-spin motion-reduce:animate-none" />
        Loading workspace setup…
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <PageHeader title="Initial Setup" />
        <Card><CardContent className="py-10 text-center"><p className="text-status-error-text text-sm">{error || 'Tenant context could not be loaded.'}</p><Button variant="secondary" size="sm" className="mt-4" onClick={() => void load()}>Retry</Button></CardContent></Card>
      </div>
    );
  }

  if (setupClosed || alreadySubmitted) {
    return (
      <div className="mx-auto max-w-2xl space-y-5 sm:space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Initial Setup' }]} />
        <PageHeader title="Initial Setup" description="Initial tenant configuration" />
        <Card>
          <CardContent className="py-8 sm:py-10">
            <div className="mx-auto max-w-lg text-center">
              <div className="bg-brand-50 text-brand-700 mx-auto flex h-12 w-12 items-center justify-center rounded-full dark:bg-brand-950/30 dark:text-brand-300"><CheckCircle2 className="h-6 w-6" /></div>
              <h2 className="text-ink-950 mt-4 text-lg font-semibold">{alreadySubmitted ? 'Setup submitted for platform review' : 'Initial setup is closed'}</h2>
              <p className="text-ink-500 mt-2 text-sm leading-6">
                {alreadySubmitted
                  ? 'The tenant has completed its setup handoff. The Platform Administrator now controls the activation decision.'
                  : 'This tenant has moved beyond onboarding. Use Administration and Settings for normal configuration changes.'}
              </p>
              <Badge variant={alreadySubmitted ? 'pending' : 'info'} size="sm" className="mt-4">{tenant.lifecycleStatus.replaceAll('_', ' ')}</Badge>
              <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
                <Button variant="primary" size="sm" onClick={() => router.push('/dashboard')}>Return to Dashboard</Button>
                {!alreadySubmitted && <Button variant="secondary" size="sm" onClick={() => router.push('/dashboard/settings')}>Open Tenant Settings</Button>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const renderStep = () => {
    if (currentStep === 0) {
      const rows = [
        ['Organisation', tenant.name],
        ['Code', tenant.code],
        ['Slug', tenant.slug],
        ['Type', ORG_TYPES[tenant.type] ?? tenant.type],
        ['Timezone', tenant.timezone],
        ['Locale', tenant.locale],
      ];
      return (
        <div className="space-y-4">
          <p className="text-ink-500 text-sm leading-6">Confirm the organisation created by the Platform Administrator. Identity fields remain platform-controlled so tenant codes and URLs stay stable.</p>
          <div className="border-border divide-border overflow-hidden rounded-[8px] border divide-y">
            {rows.map(([label, value]) => (
              <div key={label} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
                <span className="text-ink-500">{label}</span>
                <span className={`text-ink-950 min-w-0 break-words font-medium ${label === 'Slug' || label === 'Code' ? 'font-mono text-xs' : ''}`}>{value || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (currentStep === 1) {
      return (
        <div className="space-y-4">
          <div className="border-border bg-muted/20 rounded-[8px] border px-4 py-3">
            <p className="text-ink-700 text-xs leading-5"><strong>Optional.</strong> Small organisations can skip departments entirely. Add them when they improve staff organisation, workflow routing or reporting.</p>
          </div>
          <div className="space-y-3">
            {departments.map((department, index) => (
              <div key={department.id ?? `new-${index}`} className="border-border grid gap-2 rounded-[8px] border p-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-center">
                <Input value={department.name} placeholder="Department name" onChange={(event) => setDepartments((rows) => rows.map((row, i) => i === index ? { ...row, name: event.target.value } : row))} />
                <Input value={department.code} placeholder="Auto code" className="font-mono" onChange={(event) => setDepartments((rows) => rows.map((row, i) => i === index ? { ...row, code: event.target.value.toUpperCase() } : row))} />
                {department.id ? (
                  <Badge variant="success" size="sm" className="justify-self-start sm:justify-self-end">Saved</Badge>
                ) : (
                  <Button type="button" variant="ghost" size="icon-sm" className="text-status-error-text justify-self-end" aria-label="Remove unsaved department" onClick={() => setDepartments((rows) => rows.filter((_, i) => i !== index))}><X className="h-4 w-4" /></Button>
                )}
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setDepartments((rows) => [...rows, { name: '', code: '' }])}><Plus className="h-4 w-4" /> Add Department</Button>
          <p className="text-ink-400 text-xs">Saved departments are preserved here. Archive or restructure them later from Organisation Management so linked staff records remain safe.</p>
        </div>
      );
    }

    if (currentStep === 2) {
      return (
        <div className="space-y-4">
          <div className="border-brand-200 bg-brand-50/50 rounded-[8px] border px-4 py-3 dark:border-brand-900/60 dark:bg-brand-950/20">
            <p className="text-ink-700 text-xs leading-5"><strong>Required.</strong> Add at least one real operating location. It can be a head office, branch, depot, workshop or another location that makes sense for this organisation.</p>
          </div>
          <div className="space-y-3">
            {offices.map((office, index) => (
              <div key={office.id ?? `new-${index}`} className="border-border space-y-3 rounded-[8px] border p-3 sm:p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink-500 text-xs font-semibold uppercase tracking-wider">Location {index + 1}</span>
                  {office.id ? <Badge variant="success" size="sm">Saved</Badge> : offices.length > 1 ? <Button type="button" variant="ghost" size="icon-sm" className="text-status-error-text" aria-label="Remove unsaved location" onClick={() => setOffices((rows) => rows.filter((_, i) => i !== index))}><X className="h-4 w-4" /></Button> : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                  <Input value={office.name} placeholder="Office, depot or location name" onChange={(event) => setOffices((rows) => rows.map((row, i) => i === index ? { ...row, name: event.target.value } : row))} />
                  <Input value={office.code} placeholder="Auto code" className="font-mono" onChange={(event) => setOffices((rows) => rows.map((row, i) => i === index ? { ...row, code: event.target.value.toUpperCase() } : row))} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <StyledSelect value={office.type} aria-label={`Location ${index + 1} type`} onChange={(event) => setOffices((rows) => rows.map((row, i) => i === index ? { ...row, type: event.target.value } : row))}>
                    <option value="head_office">Head Office</option>
                    <option value="satellite_office">Satellite / Branch Office</option>
                    <option value="regional_office">Regional Office</option>
                    <option value="constituency_office">Constituency Office</option>
                    <option value="settlement_office">Settlement Office</option>
                    <option value="depot">Depot</option>
                    <option value="workshop">Workshop</option>
                    <option value="other">Other</option>
                  </StyledSelect>
                  <Input value={office.address} placeholder="Address (optional)" onChange={(event) => setOffices((rows) => rows.map((row, i) => i === index ? { ...row, address: event.target.value } : row))} />
                </div>
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setOffices((rows) => [...rows, { name: '', code: '', type: 'other', address: '' }])}><Plus className="h-4 w-4" /> Add Location</Button>
        </div>
      );
    }

    if (currentStep === 3) {
      return (
        <div className="space-y-5">
          <div className="border-border bg-muted/20 rounded-[8px] border px-4 py-3">
            <p className="text-ink-700 text-xs leading-5"><strong>Optional.</strong> The system works with the default branding. Change these values only when the organisation wants its own colours and document contacts.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Primary Colour</Label><div className="flex items-center gap-2"><span className="border-border h-10 w-10 shrink-0 rounded-[7px] border" style={{ backgroundColor: branding.primaryColor }} /><Input value={branding.primaryColor} className="font-mono" onChange={(event) => setBranding((value) => ({ ...value, primaryColor: event.target.value }))} /></div></div>
            <div className="space-y-1.5"><Label>Accent Colour</Label><div className="flex items-center gap-2"><span className="border-border h-10 w-10 shrink-0 rounded-[7px] border" style={{ backgroundColor: branding.accentColor }} /><Input value={branding.accentColor} className="font-mono" onChange={(event) => setBranding((value) => ({ ...value, accentColor: event.target.value }))} /></div></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Contact Email</Label><Input type="email" value={branding.contactEmail} placeholder="transport@organisation.example" onChange={(event) => setBranding((value) => ({ ...value, contactEmail: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Contact Phone</Label><Input value={branding.contactPhone} placeholder="Contact number" onChange={(event) => setBranding((value) => ({ ...value, contactPhone: event.target.value }))} /></div>
          </div>
          <p className="text-ink-400 text-xs">Operational safety rules such as licence verification, inspections and trip-conflict protection are enforced by the system and are intentionally not presented as setup switches.</p>
        </div>
      );
    }

    const savedDepartments = departments.filter((department) => department.id).length;
    const savedOffices = offices.filter((office) => office.id).length;
    const requiredCompleted = REQUIRED_STEPS.filter((step) => completedSteps.includes(step)).length;

    return (
      <div className="space-y-5">
        <div className="text-center">
          <div className="bg-brand-50 text-brand-700 mx-auto flex h-12 w-12 items-center justify-center rounded-full dark:bg-brand-950/30 dark:text-brand-300"><Sparkles className="h-6 w-6" /></div>
          <h3 className="text-ink-950 mt-3 text-lg font-semibold">Complete initial setup</h3>
          <p className="text-ink-500 mt-1 text-sm">This does not activate the tenant or submit it for Platform Review.</p>
        </div>

        <section className="border-border grid grid-cols-3 gap-px overflow-hidden rounded-[10px] border bg-border" aria-label="Initial setup summary">
          {[
            ['Locations', savedOffices],
            ['Departments', savedDepartments],
            ['Required', `${requiredCompleted}/${REQUIRED_STEPS.length}`],
          ].map(([label, value]) => (
            <div key={String(label)} className="bg-surface px-2 py-4 text-center sm:px-4">
              <p className="text-brand-700 text-xl font-semibold tabular-nums">{value}</p>
              <p className="text-ink-500 mt-1 text-[11px]">{label}</p>
            </div>
          ))}
        </section>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">What happens next?</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start gap-3"><span className="bg-brand-50 text-brand-700 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold dark:bg-brand-950/30 dark:text-brand-300">1</span><p className="text-ink-600 leading-5">Complete this initial setup.</p></div>
            <div className="flex items-start gap-3"><span className="bg-brand-50 text-brand-700 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold dark:bg-brand-950/30 dark:text-brand-300">2</span><p className="text-ink-600 leading-5">Operational Setup guides you to configure the required approval workflow and shows recommended items such as staff, vehicles and drivers.</p></div>
            <div className="flex items-start gap-3"><span className="bg-brand-50 text-brand-700 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold dark:bg-brand-950/30 dark:text-brand-300">3</span><p className="text-ink-600 leading-5">Only when the required operational checks pass do you submit the tenant for final Platform Review.</p></div>
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 sm:space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Initial Setup' }]} />
      <PageHeader title="Initial Setup" description="Confirm the minimum tenant structure, then continue to operational setup." />

      <section aria-label="Initial setup progress" className="space-y-2">
        <div className="flex items-center justify-between gap-3"><p className="text-ink-600 text-xs font-medium">Step {currentStep + 1} of {TOTAL_STEPS} · {activeStep.label}</p><p className="text-ink-500 text-xs tabular-nums">{progress}%</p></div>
        <div className="bg-muted h-1.5 overflow-hidden rounded-full"><div className="bg-brand-700 h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${progress}%` }} /></div>
      </section>

      <div className="-mx-1 overflow-x-auto px-1 pb-1" aria-label="Setup steps">
        <div className="flex min-w-max gap-1.5">
          {STEPS.map((step, index) => {
            const completed = completedSteps.includes(index);
            const active = currentStep === index;
            const Icon = step.icon;
            return (
              <button key={step.label} type="button" disabled={saving || (!completed && !active)} onClick={() => { if (completed && !active) setCurrentStep(index); }} aria-current={active ? 'step' : undefined} className={`focus-ring flex min-h-10 items-center gap-2 rounded-[7px] border px-3 text-xs font-medium transition-colors motion-reduce:transition-none ${active ? 'border-brand-700 bg-brand-700 text-white' : completed ? 'border-brand-200 bg-brand-50/60 text-brand-800 dark:border-brand-900/60 dark:bg-brand-950/20 dark:text-brand-200' : 'border-border bg-surface text-ink-400'} disabled:cursor-default`}>
                {completed && !active ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}<span>{index + 1}. {step.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-start gap-3">
            <div className="bg-brand-50 text-brand-700 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] dark:bg-brand-950/30 dark:text-brand-300"><activeStep.icon className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{activeStep.label}</CardTitle>
                {activeStep.category !== 'final' && <Badge variant={activeStep.category === 'required' ? 'error' : 'default'} size="sm">{activeStep.category === 'required' ? 'Required' : 'Optional'}</Badge>}
              </div>
              <p className="text-ink-500 mt-1 text-sm">{activeStep.description}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {error && <div className="border-status-error-border bg-status-error-bg text-status-error-text rounded-[8px] border px-3 py-2.5 text-sm" role="alert">{error}</div>}
          {renderStep()}
          <div className="border-border mt-6 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="secondary" size="sm" disabled={currentStep === 0 || saving} onClick={() => { setError(null); setCurrentStep((step) => Math.max(0, step - 1)); }} className="w-full sm:w-auto"><ChevronLeft className="h-4 w-4" /> Back</Button>
              {currentStep < TOTAL_STEPS - 1 && <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => void saveStep(false)} className="w-full sm:w-auto">{saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Save className="h-4 w-4" />} Save</Button>}
            </div>
            {currentStep < TOTAL_STEPS - 1 ? (
              <Button type="button" variant="primary" size="sm" disabled={saving || !canContinue} onClick={() => void saveStep(true)} className="w-full sm:w-auto">{saving && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />} Continue <ChevronRight className="h-4 w-4" /></Button>
            ) : (
              <Button type="button" variant="primary" size="sm" disabled={saving || !requiredReady || offices.filter((office) => office.id).length < 1} onClick={() => void completeInitialSetup()} className="w-full sm:w-auto">{saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Settings2 className="h-4 w-4" />} Complete & Continue to Operational Setup</Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
