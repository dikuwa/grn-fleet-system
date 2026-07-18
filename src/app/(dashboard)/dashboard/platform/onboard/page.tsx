'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Building2, ChevronLeft, ChevronRight, CheckCircle2, Loader2,
  Plus, X, Shield, Users, Mail, Globe, Palette, MapPin, Hash,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NewOffice {
  name: string;
  code: string;
  type: string;
  address: string;
}

interface NewDepartment {
  name: string;
  code: string;
}

interface OnboardForm {
  // Step 1 — Organisation
  orgName: string;
  orgCode: string;
  orgSlug: string;
  orgType: string;
  timezone: string;
  locale: string;
  // Step 2 — Branding
  contactEmail: string;
  contactPhone: string;
  address: string;
  primaryColor: string;
  accentColor: string;
  // Step 3 — Offices
  offices: NewOffice[];
  // Step 4 — Departments
  departments: NewDepartment[];
  // Step 5 — Admin User (optional)
  adminEmail: string;
  adminPassword: string;
  adminName: string;
  // Step 6 — Roles
  selectedRoles: string[];
}

const DEFAULT_FORM: OnboardForm = {
  orgName: '',
  orgCode: '',
  orgSlug: '',
  orgType: 'regional_council',
  timezone: 'Africa/Windhoek',
  locale: 'en-NA',
  contactEmail: '',
  contactPhone: '',
  address: '',
  primaryColor: '#1F4E8C',
  accentColor: '#0F766E',
  offices: [{ name: 'Head Office', code: 'HO', type: 'head_office', address: '' }],
  departments: [],
  adminEmail: '',
  adminPassword: '',
  adminName: '',
  selectedRoles: [
    'TRANSPORT_ADMIN',
    'REQUESTER',
    'SUPERVISOR',
    'CONTROL_ADMIN_OFFICER',
    'DEPUTY_DIRECTOR',
    'DIRECTOR',
    'CHIEF_REGIONAL_OFFICER',
    'DRIVER',
    'TENANT_AUDITOR',
  ],
};

const ORG_TYPES = [
  { value: 'regional_council', label: 'Regional Council' },
  { value: 'ministry', label: 'Ministry / National Office' },
  { value: 'agency', label: 'Government Agency' },
];

const ALL_ROLES = [
  { key: 'TRANSPORT_ADMIN', label: 'Transport Administrator' },
  { key: 'REQUESTER', label: 'Requester / Programme Officer' },
  { key: 'SUPERVISOR', label: 'Immediate Supervisor' },
  { key: 'CONTROL_ADMIN_OFFICER', label: 'Control Admin Officer' },
  { key: 'DEPUTY_DIRECTOR', label: 'Deputy Director' },
  { key: 'DIRECTOR', label: 'Director' },
  { key: 'CHIEF_REGIONAL_OFFICER', label: 'Chief Regional Officer' },
  { key: 'DRIVER', label: 'Assigned Driver' },
  { key: 'TENANT_AUDITOR', label: 'Tenant Auditor' },
];

const STEPS = [
  { label: 'Organisation', icon: Building2 },
  { label: 'Branding', icon: Palette },
  { label: 'Offices', icon: MapPin },
  { label: 'Departments', icon: Hash },
  { label: 'Admin User', icon: Shield },
  { label: 'Roles', icon: Users },
  { label: 'Review', icon: CheckCircle2 },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OnboardTenantPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<OnboardForm>({ ...DEFAULT_FORM });
  const [error, setError] = useState<string | null>(null);

  // Update simple field
  const updateField = useCallback(<K extends keyof OnboardForm>(key: K, value: OnboardForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  }, []);

  // Office management
  const updateOffice = useCallback((index: number, field: keyof NewOffice, value: string) => {
    setForm((prev) => {
      const offices = [...prev.offices];
      offices[index] = { ...offices[index], [field]: value };
      return { ...prev, offices };
    });
  }, []);

  const addOffice = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      offices: [...prev.offices, { name: '', code: '', type: 'constituency_office', address: '' }],
    }));
  }, []);

  const removeOffice = useCallback((index: number) => {
    setForm((prev) => ({
      ...prev,
      offices: prev.offices.filter((_, i) => i !== index),
    }));
  }, []);

  // Department management
  const updateDept = useCallback((index: number, field: keyof NewDepartment, value: string) => {
    setForm((prev) => {
      const depts = [...prev.departments];
      depts[index] = { ...depts[index], [field]: value };
      return { ...prev, departments: depts };
    });
  }, []);

  const addDept = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      departments: [...prev.departments, { name: '', code: '' }],
    }));
  }, []);

  const removeDept = useCallback((index: number) => {
    setForm((prev) => ({
      ...prev,
      departments: prev.departments.filter((_, i) => i !== index),
    }));
  }, []);

  // Role toggling
  const toggleRole = useCallback((key: string) => {
    setForm((prev) => ({
      ...prev,
      selectedRoles: prev.selectedRoles.includes(key)
        ? prev.selectedRoles.filter((r) => r !== key)
        : [...prev.selectedRoles, key],
    }));
  }, []);

  // Mutation
  const onboardMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/platform/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organisation: {
            name: form.orgName,
            code: form.orgCode,
            slug: form.orgSlug,
            type: form.orgType,
            timezone: form.timezone,
            locale: form.locale,
          },
          branding: {
            contactEmail: form.contactEmail || undefined,
            contactPhone: form.contactPhone || undefined,
            address: form.address || undefined,
            primaryColor: form.primaryColor,
            accentColor: form.accentColor,
          },
          offices: form.offices.filter((o) => o.name.trim()).map((o) => ({
            name: o.name.trim(),
            code: o.code.trim(),
            type: o.type,
            address: o.address.trim() || undefined,
          })),
          departments: form.departments.filter((d) => d.name.trim()).map((d) => ({
            name: d.name.trim(),
            code: d.code.trim(),
          })),
          adminUser: form.adminEmail
            ? {
                email: form.adminEmail.trim(),
                password: form.adminPassword,
                name: form.adminName.trim() || 'System Administrator',
              }
            : undefined,
          roles: form.selectedRoles,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to onboard tenant');
      return json.data;
    },
    onSuccess: () => {
      router.push('/dashboard/platform/tenants');
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const canProceed = (): boolean => {
    switch (step) {
      case 0: return form.orgName.trim().length > 0 && form.orgCode.trim().length > 0 && form.orgSlug.trim().length > 0;
      case 1: return true;
      case 2: return form.offices.some((o) => o.name.trim());
      case 3: return true;
      case 4: return form.adminEmail === '' || (form.adminEmail.includes('@') && form.adminPassword.length >= 4);
      case 5: return form.selectedRoles.length > 0;
      case 6: return true;
      default: return false;
    }
  };

  // -------------------------------------------------------------------
  // Render steps
  // -------------------------------------------------------------------

  const renderStep = () => {
    switch (step) {
      // --- Step 0: Organisation ---
      case 0:
        return (
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
                <p className="text-xs text-ink-400">Unique identifier (auto-uppercased)</p>
              </div>
              <div className="space-y-1.5">
                <Label required>Slug</Label>
                <Input
                  placeholder="e.g. kavango-east"
                  value={form.orgSlug}
                  onChange={(e) => updateField('orgSlug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  className="h-11 font-mono"
                />
                <p className="text-xs text-ink-400">URL-friendly identifier</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <select
                  className="h-11 w-full rounded-[8px] border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
                  value={form.orgType}
                  onChange={(e) => updateField('orgType', e.target.value)}
                >
                  {ORG_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Timezone</Label>
                <select
                  className="h-11 w-full rounded-[8px] border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
                  value={form.timezone}
                  onChange={(e) => updateField('timezone', e.target.value)}
                >
                  <option value="Africa/Windhoek">Africa/Windhoek (UTC+2)</option>
                  <option value="Africa/Windhoek">Africa/Windhoek (CAT)</option>
                </select>
              </div>
            </div>
          </div>
        );

      // --- Step 1: Branding ---
      case 1:
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Contact Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                  <Input
                    type="email"
                    placeholder="transport@council.gov.na"
                    value={form.contactEmail}
                    onChange={(e) => updateField('contactEmail', e.target.value)}
                    className="pl-9 h-11"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Contact Phone</Label>
                <Input
                  placeholder="+264 61 123 456"
                  value={form.contactPhone}
                  onChange={(e) => updateField('contactPhone', e.target.value)}
                  className="h-11"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <textarea
                className="min-h-[60px] w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200 resize-y"
                placeholder="Physical address of the transport office"
                value={form.address}
                onChange={(e) => updateField('address', e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Primary Colour</Label>
                <div className="flex items-center gap-2">
                  <div
                    className="h-10 w-10 rounded-[6px] border border-border shrink-0"
                    style={{ backgroundColor: form.primaryColor }}
                  />
                  <Input
                    type="text"
                    value={form.primaryColor}
                    onChange={(e) => updateField('primaryColor', e.target.value)}
                    className="h-11 font-mono"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Accent Colour</Label>
                <div className="flex items-center gap-2">
                  <div
                    className="h-10 w-10 rounded-[6px] border border-border shrink-0"
                    style={{ backgroundColor: form.accentColor }}
                  />
                  <Input
                    type="text"
                    value={form.accentColor}
                    onChange={(e) => updateField('accentColor', e.target.value)}
                    className="h-11 font-mono"
                  />
                </div>
              </div>
            </div>
          </div>
        );

      // --- Step 2: Offices ---
      case 2:
        return (
          <div className="space-y-4">
            <p className="text-sm text-ink-500">Add your organisation&apos;s offices and depots.</p>
            {form.offices.map((office, i) => (
              <div key={i} className="rounded-[8px] border border-border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink-500 uppercase">Office {i + 1}</span>
                  {form.offices.length > 1 && (
                    <button onClick={() => removeOffice(i)} className="text-ink-400 hover:text-status-error-text transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Office name" value={office.name} onChange={(e) => updateOffice(i, 'name', e.target.value)} className="h-10" />
                  <Input placeholder="Code" value={office.code} onChange={(e) => updateOffice(i, 'code', e.target.value.toUpperCase())} className="h-10 font-mono" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="h-10 rounded-[8px] border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
                    value={office.type}
                    onChange={(e) => updateOffice(i, 'type', e.target.value)}
                  >
                    <option value="head_office">Head Office</option>
                    <option value="constituency_office">Constituency Office</option>
                    <option value="settlement_office">Settlement Office</option>
                    <option value="depot">Depot / Workshop</option>
                  </select>
                  <Input placeholder="Address (optional)" value={office.address} onChange={(e) => updateOffice(i, 'address', e.target.value)} className="h-10" />
                </div>
              </div>
            ))}
            <Button variant="secondary" size="compact" onClick={addOffice} className="w-full">
              <Plus className="h-4 w-4" /> Add Office
            </Button>
          </div>
        );

      // --- Step 3: Departments ---
      case 3:
        return (
          <div className="space-y-4">
            <p className="text-sm text-ink-500">Add your organisation&apos;s departments. Optional — can be managed later.</p>
            {form.departments.map((dept, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  placeholder="Department name"
                  value={dept.name}
                  onChange={(e) => updateDept(i, 'name', e.target.value)}
                  className="h-10 flex-1"
                />
                <Input
                  placeholder="Code"
                  value={dept.code}
                  onChange={(e) => updateDept(i, 'code', e.target.value.toUpperCase())}
                  className="h-10 w-24 font-mono"
                />
                <button onClick={() => removeDept(i)} className="text-ink-400 hover:text-status-error-text transition-colors shrink-0">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button variant="secondary" size="compact" onClick={addDept} className="w-full">
              <Plus className="h-4 w-4" /> Add Department
            </Button>
          </div>
        );

      // --- Step 4: Admin User (optional) ---
      case 4:
        return (
          <div className="space-y-4">
            <p className="text-sm text-ink-500">
              Optionally create an initial administrator account. Leave blank to create users later.
            </p>
            <div className="space-y-1.5">
              <Label>Admin Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <Input
                  type="email"
                  placeholder="admin@council.gov.na"
                  value={form.adminEmail}
                  onChange={(e) => updateField('adminEmail', e.target.value)}
                  className="pl-9 h-11"
                />
              </div>
            </div>
            {form.adminEmail && (
              <>
                <div className="space-y-1.5">
                  <Label>Admin Name</Label>
                  <Input
                    placeholder="e.g. System Administrator"
                    value={form.adminName}
                    onChange={(e) => updateField('adminName', e.target.value)}
                    className="h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    placeholder="Minimum 4 characters"
                    value={form.adminPassword}
                    onChange={(e) => updateField('adminPassword', e.target.value)}
                    className="h-11"
                  />
                </div>
              </>
            )}
          </div>
        );

      // --- Step 5: Roles ---
      case 5:
        return (
          <div className="space-y-4">
            <p className="text-sm text-ink-500">Select the default roles to create for this tenant.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ALL_ROLES.map((role) => (
                <button
                  key={role.key}
                  onClick={() => toggleRole(role.key)}
                  className={`flex items-center gap-3 rounded-[8px] border p-3 text-left transition-all ${
                    form.selectedRoles.includes(role.key)
                      ? 'border-brand-300 bg-brand-50 text-brand-900'
                      : 'border-border text-ink-700 hover:border-ink-300'
                  }`}
                >
                  <div className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors ${
                    form.selectedRoles.includes(role.key)
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-ink-300'
                  }`}>
                    {form.selectedRoles.includes(role.key) && (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{role.label}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );

      // --- Step 6: Review ---
      case 6:
        return (
          <div className="space-y-4">
            {/* Organisation card */}
            <Card>
              <CardHeader><CardTitle>Organisation</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p><span className="text-ink-500">Name:</span> {form.orgName}</p>
                <p><span className="text-ink-500">Code:</span> {form.orgCode}</p>
                <p><span className="text-ink-500">Slug:</span> {form.orgSlug}</p>
                <p><span className="text-ink-500">Type:</span> {ORG_TYPES.find((t) => t.value === form.orgType)?.label}</p>
              </CardContent>
            </Card>

            {form.contactEmail && (
              <Card>
                <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {form.contactEmail && <p><span className="text-ink-500">Email:</span> {form.contactEmail}</p>}
                  {form.contactPhone && <p><span className="text-ink-500">Phone:</span> {form.contactPhone}</p>}
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle>Offices</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold">{form.offices.filter((o) => o.name.trim()).length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Departments</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold">{form.departments.filter((d) => d.name.trim()).length}</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle>Roles ({form.selectedRoles.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {form.selectedRoles.map((key) => (
                    <Badge key={key} variant="info" size="sm">
                      {ALL_ROLES.find((r) => r.key === key)?.label || key}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            {form.adminEmail && (
              <Card>
                <CardHeader><CardTitle>Admin User</CardTitle></CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p><span className="text-ink-500">Email:</span> {form.adminEmail}</p>
                  {form.adminName && <p><span className="text-ink-500">Name:</span> {form.adminName}</p>}
                </CardContent>
              </Card>
            )}
          </div>
        );
    }
  };

  // -------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Tenants', href: '/dashboard/platform/tenants' },
        { label: 'Onboard New Tenant' },
      ]} />
      <PageHeader
        title="Onboard New Tenant"
        description="Set up a new organisation on the fleet management platform"
      />


      {/* Step indicator */}
      <div className="flex items-center gap-0 overflow-x-auto">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-0">
            <button
              onClick={() => i < step && setStep(i)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                i === step
                  ? 'bg-brand-600 text-white'
                  : i < step
                    ? 'bg-brand-100 text-brand-700 cursor-pointer hover:bg-brand-200'
                    : 'bg-muted text-ink-400'
              }`}
            >
              <s.icon className="h-3.5 w-3.5" />
              {s.label}
            </button>
            {i < STEPS.length - 1 && (
              <div className={`h-px w-4 ${
                i < step ? 'bg-brand-400' : 'bg-muted'
              }`} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <Card>
        <CardHeader>
          <CardTitle>{STEPS[step].label}</CardTitle>
        </CardHeader>
        <CardContent>
          {renderStep()}

          {error && (
            <div className="mt-4 rounded-[8px] bg-status-error-bg p-3 text-sm text-status-error-text">
              {error}
            </div>
          )}

          {/* Navigation */}
          <div className="mt-6 flex items-center justify-between">
            <Button
              variant="tertiary"
              size="default"
              onClick={() => step > 0 ? setStep(step - 1) : router.push('/dashboard/platform/tenants')}
            >
              <ChevronLeft className="h-4 w-4" />
              {step === 0 ? 'Cancel' : 'Back'}
            </Button>

            {step < STEPS.length - 1 ? (
              <Button
                variant="primary"
                size="default"
                onClick={() => setStep(step + 1)}
                disabled={!canProceed()}
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
                  <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</>
                ) : (
                  <><CheckCircle2 className="h-4 w-4" /> Create Tenant</>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
