'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StyledSelect } from '@/components/ui/styled-select';
import {
  Building2, Users, MapPin, CarFront, ShieldCheck, Fuel,
  ClipboardCheck, Bell, KeyRound, Palette, CheckCircle2,
  ChevronLeft, ChevronRight, Loader2, Save, Plus, X,
  Sparkles,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';

const TOTAL_STEPS = 11;

const STEPS = [
  { label: 'Organisation', icon: Building2, description: 'Organisation profile' },
  { label: 'Departments', icon: Users, description: 'Departments & units' },
  { label: 'Offices', icon: MapPin, description: 'Offices & depots' },
  { label: 'Vehicle Defaults', icon: CarFront, description: 'Fleet defaults' },
  { label: 'Driver Setup', icon: ShieldCheck, description: 'Driver management' },
  { label: 'Fuel & Odometer', icon: Fuel, description: 'Fuel tracking defaults' },
  { label: 'Inspection Rules', icon: ClipboardCheck, description: 'Inspection policies' },
  { label: 'Notifications', icon: Bell, description: 'Notification preferences' },
  { label: 'Roles', icon: KeyRound, description: 'Default role assignments' },
  { label: 'Branding', icon: Palette, description: 'Workspace appearance' },
  { label: 'Review', icon: CheckCircle2, description: 'Review & complete' },
];

const ORG_TYPES = [
  { value: 'regional_council', label: 'Regional Council' },
  { value: 'ministry', label: 'Ministry / National Office' },
  { value: 'agency', label: 'Government Agency' },
];

interface OfficeInput {
  name: string;
  code: string;
  type: string;
  address: string;
}

interface DepartmentInput {
  name: string;
  code: string;
}

interface StepData {
  [key: string]: unknown;
}

export default function SetupWizardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [stepData, setStepData] = useState<StepData>({});
  const [saving, setSaving] = useState(false);
  const [tenantInfo, setTenantInfo] = useState<{
    id: string;
    name: string;
    code: string;
    slug: string;
    type: string;
    timezone: string;
    locale: string;
    lifecycleStatus: string;
  } | null>(null);
  const [offices, setOffices] = useState<OfficeInput[]>([]);
  const [departments, setDepartments] = useState<DepartmentInput[]>([]);
  const [vehicleDefaults, setVehicleDefaults] = useState({
    defaultFuelType: 'diesel',
    odometerUnit: 'km',
    defaultServiceIntervalKm: '10000',
    requirePreTripInspection: true,
  });
  const [driverSetup, setDriverSetup] = useState({
    requireLicenceVerification: true,
    autoAssignOnAllocation: true,
    maxConcurrentTrips: 1,
  });
  const [fuelSettings, setFuelSettings] = useState({
    trackFuelEntries: true,
    fuelLimitWarningPct: 80,
    requireFuelReceipt: true,
  });
  const [inspectionRules, setInspectionRules] = useState({
    departureInspectionRequired: true,
    returnInspectionRequired: true,
    periodicInspectionDays: 30,
  });
  const [notificationPrefs, setNotificationPrefs] = useState({
    emailNotifications: true,
    smsNotifications: false,
    digestFrequency: 'immediate',
  });
  const [roleAssignments, setRoleAssignments] = useState({
    autoAssignTenantAdmin: true,
    createDefaultRoles: true,
    notifyNewUsers: true,
  });
  const [branding, setBranding] = useState({
    primaryColor: '#1F4E8C',
    accentColor: '#0F766E',
    contactEmail: '',
    contactPhone: '',
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/platform/setup');
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load setup');
        if (cancelled) return;
        const data = json.data;
        setTenantInfo(data.tenant);
        setOffices(data.offices?.map((o: { name: string; code: string | null; type: string; address: string | null }) => ({
          name: o.name,
          code: o.code ?? '',
          type: o.type,
          address: o.address ?? '',
        })) ?? []);
        setDepartments(data.departments?.map((d: { name: string; code: string | null }) => ({
          name: d.name,
          code: d.code ?? '',
        })) ?? []);
        if (data.progress) {
          setCurrentStep(data.progress.currentStep ?? 0);
          setCompletedSteps(Array.isArray(data.progress.completedSteps) ? data.progress.completedSteps : []);
          const saved = data.progress.stepData ?? {};
          setStepData(saved);
          if (saved.vehicleDefaults) setVehicleDefaults(saved.vehicleDefaults as typeof vehicleDefaults);
          if (saved.driverSetup) setDriverSetup(saved.driverSetup as typeof driverSetup);
          if (saved.fuelSettings) setFuelSettings(saved.fuelSettings as typeof fuelSettings);
          if (saved.inspectionRules) setInspectionRules(saved.inspectionRules as typeof inspectionRules);
          if (saved.notificationPrefs) setNotificationPrefs(saved.notificationPrefs as typeof notificationPrefs);
          if (saved.roleAssignments) setRoleAssignments(saved.roleAssignments as typeof roleAssignments);
          if (saved.branding) setBranding(saved.branding as typeof branding);
        }
        if ((data.offices?.length ?? 0) === 0) {
          setOffices([{ name: 'Head Office', code: 'HO', type: 'head_office', address: '' }]);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load setup');
          toast({ title: 'Failed to load', description: 'Could not load setup progress.', variant: 'error' });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [toast]);

  const saveProgress = useCallback(async (data: {
    currentStep: number;
    completedSteps: number[];
    stepData: StepData;
  }) => {
    setSaving(true);
    try {
      const res = await fetch('/api/platform/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      return true;
    } catch (err) {
      toast({ title: 'Save failed', description: err instanceof Error ? err.message : 'Could not save progress.', variant: 'error' });
      return false;
    } finally {
      setSaving(false);
    }
  }, [toast]);

  const gatherStepData = useCallback((): StepData => ({
    ...stepData,
    vehicleDefaults,
    driverSetup,
    fuelSettings,
    inspectionRules,
    notificationPrefs,
    roleAssignments,
    branding,
    offices: offices.filter((office) => office.name.trim()),
    departments: departments.filter((department) => department.name.trim()),
  }), [stepData, vehicleDefaults, driverSetup, fuelSettings, inspectionRules, notificationPrefs, roleAssignments, branding, offices, departments]);

  const completeStep = useCallback(async (step: number) => {
    const updated = completedSteps.includes(step)
      ? completedSteps
      : [...completedSteps, step].sort((a, b) => a - b);
    const data = { currentStep: step, completedSteps: updated, stepData: gatherStepData() };
    const ok = await saveProgress(data);
    if (ok) {
      setCompletedSteps(updated);
      setStepData(data.stepData);
    }
    return ok;
  }, [completedSteps, gatherStepData, saveProgress]);

  const goNext = useCallback(async () => {
    const ok = await completeStep(currentStep);
    if (ok && currentStep < TOTAL_STEPS - 1) {
      setCurrentStep(currentStep + 1);
      setError(null);
    }
  }, [completeStep, currentStep]);

  const goBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      setError(null);
    }
  }, [currentStep]);

  const jumpToStep = useCallback(async (target: number) => {
    if (target === currentStep) return;
    const data = { currentStep: target, completedSteps, stepData: gatherStepData() };
    const ok = await saveProgress(data);
    if (!ok) return;
    setStepData(data.stepData);
    setCurrentStep(target);
    setError(null);
  }, [currentStep, completedSteps, gatherStepData, saveProgress]);

  const handleComplete = useCallback(async () => {
    const data = {
      currentStep: TOTAL_STEPS - 1,
      completedSteps: Array.from({ length: TOTAL_STEPS - 1 }, (_, index) => index),
      stepData: gatherStepData(),
    };
    const ok = await saveProgress(data);
    if (!ok) return;
    setSaving(true);
    try {
      const res = await fetch('/api/platform/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, action: 'complete' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to finalise setup');
      toast({ title: 'Setup complete', description: 'Your workspace has been submitted for platform review.', variant: 'success' });
      router.push('/dashboard');
    } catch (err) {
      toast({ title: 'Finalise failed', description: err instanceof Error ? err.message : 'Could not finalise setup.', variant: 'error' });
    } finally {
      setSaving(false);
    }
  }, [gatherStepData, saveProgress, router, toast]);

  const updateOffice = useCallback((index: number, field: keyof OfficeInput, value: string) => {
    setOffices((current) => current.map((office, officeIndex) => officeIndex === index ? { ...office, [field]: value } : office));
  }, []);
  const addOffice = useCallback(() => setOffices((current) => [...current, { name: '', code: '', type: 'constituency_office', address: '' }]), []);
  const removeOffice = useCallback((index: number) => setOffices((current) => current.filter((_, officeIndex) => officeIndex !== index)), []);
  const updateDept = useCallback((index: number, field: keyof DepartmentInput, value: string) => {
    setDepartments((current) => current.map((department, departmentIndex) => departmentIndex === index ? { ...department, [field]: value } : department));
  }, []);
  const addDept = useCallback(() => setDepartments((current) => [...current, { name: '', code: '' }]), []);
  const removeDept = useCallback((index: number) => setDepartments((current) => current.filter((_, departmentIndex) => departmentIndex !== index)), []);
  const updateSetting = useCallback(
    <T,>(setter: React.Dispatch<React.SetStateAction<T>>) =>
      (key: keyof T, value: T[keyof T]) => setter((current) => ({ ...current, [key]: value })),
    [],
  );

  const canProceed = useCallback((): boolean => {
    if (currentStep === 0) return Boolean(tenantInfo);
    if (currentStep === 2) return offices.some((office) => office.name.trim());
    return currentStep >= 1 && currentStep < TOTAL_STEPS;
  }, [currentStep, offices, tenantInfo]);

  const SectionIntro = ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div className="space-y-1">
      <h3 className="text-ink-950 text-sm font-semibold">{title}</h3>
      <p className="text-ink-500 text-xs leading-5">{subtitle}</p>
    </div>
  );

  const ToggleRow = ({ label, description, checked, onChange }: {
    label: string;
    description: string;
    checked: boolean;
    onChange: (value: boolean) => void;
  }) => (
    <label className="border-border hover:bg-muted/30 flex min-h-16 cursor-pointer items-start gap-3 rounded-[8px] border p-3.5 transition-colors motion-reduce:transition-none sm:p-4">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        aria-label={label}
        className="mt-0.5 shrink-0"
      />
      <span className="min-w-0">
        <span className="text-ink-950 block text-sm font-medium">{label}</span>
        <span className="text-ink-500 mt-1 block text-xs leading-5">{description}</span>
      </span>
    </label>
  );

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-4">
            <SectionIntro title="Organisation Profile" subtitle="This information was collected during onboarding. Review the tenant identity before continuing." />
            <div className="border-border divide-border overflow-hidden rounded-[8px] border divide-y">
              {[
                ['Organisation Name', tenantInfo?.name],
                ['Code', tenantInfo?.code],
                ['Slug', tenantInfo?.slug],
                ['Type', ORG_TYPES.find((type) => type.value === tenantInfo?.type)?.label ?? tenantInfo?.type],
                ['Timezone', tenantInfo?.timezone],
              ].map(([label, value]) => (
                <div key={String(label)} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center">
                  <span className="text-ink-500">{label}</span>
                  <span className={`text-ink-900 min-w-0 break-words font-medium ${label === 'Slug' ? 'font-mono text-xs' : ''}`}>{value || '—'}</span>
                </div>
              ))}
              <div className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center">
                <span className="text-ink-500">Lifecycle Status</span>
                <span><Badge variant="info" size="sm">{tenantInfo?.lifecycleStatus?.replace(/_/g, ' ')}</Badge></span>
              </div>
            </div>
          </div>
        );

      case 1:
        return (
          <div className="space-y-4">
            <SectionIntro title="Departments & Units" subtitle="Optional. Add the organisation units you already use; more can be managed later." />
            <div className="space-y-3">
              {departments.map((department, index) => (
                <div key={index} className="border-border grid gap-2 rounded-[8px] border p-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-center">
                  <Input placeholder="Department name" value={department.name} onChange={(event) => updateDept(index, 'name', event.target.value)} />
                  <Input placeholder="Code" value={department.code} onChange={(event) => updateDept(index, 'code', event.target.value.toUpperCase())} className="font-mono" />
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeDept(index)} aria-label="Remove department" className="text-status-error-text justify-self-end sm:justify-self-auto">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={addDept} className="w-full sm:w-auto"><Plus className="h-4 w-4" /> Add Department</Button>
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <SectionIntro title="Offices & Depots" subtitle="Add offices, depots and workshops used by this tenant." />
            {offices.map((office, index) => (
              <div key={index} className="border-border space-y-3 rounded-[8px] border p-3 sm:p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink-500 text-xs font-semibold uppercase tracking-wider">Office {index + 1}</span>
                  {offices.length > 1 && (
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeOffice(index)} aria-label="Remove office" className="text-status-error-text">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                  <Input placeholder="Office name" value={office.name} onChange={(event) => updateOffice(index, 'name', event.target.value)} />
                  <Input placeholder="Code" value={office.code} onChange={(event) => updateOffice(index, 'code', event.target.value.toUpperCase())} className="font-mono" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <StyledSelect value={office.type} onChange={(event) => updateOffice(index, 'type', event.target.value)} aria-label={`Office ${index + 1} type`}>
                    <option value="head_office">Head Office</option>
                    <option value="constituency_office">Constituency Office</option>
                    <option value="settlement_office">Settlement Office</option>
                    <option value="depot">Depot / Workshop</option>
                  </StyledSelect>
                  <Input placeholder="Address (optional)" value={office.address} onChange={(event) => updateOffice(index, 'address', event.target.value)} />
                </div>
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={addOffice} className="w-full sm:w-auto"><Plus className="h-4 w-4" /> Add Office</Button>
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            <SectionIntro title="Fleet Defaults" subtitle="Set sensible defaults for newly managed fleet vehicles." />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Default Fuel Type</Label><StyledSelect value={vehicleDefaults.defaultFuelType} onChange={(event) => updateSetting(setVehicleDefaults)('defaultFuelType', event.target.value)}><option value="diesel">Diesel</option><option value="petrol">Petrol</option><option value="hybrid">Hybrid</option><option value="electric">Electric</option></StyledSelect></div>
              <div className="space-y-1.5"><Label>Odometer Unit</Label><StyledSelect value={vehicleDefaults.odometerUnit} onChange={(event) => updateSetting(setVehicleDefaults)('odometerUnit', event.target.value)}><option value="km">Kilometres (km)</option><option value="mi">Miles (mi)</option></StyledSelect></div>
            </div>
            <div className="space-y-1.5"><Label>Default Service Interval</Label><Input type="number" value={vehicleDefaults.defaultServiceIntervalKm} onChange={(event) => updateSetting(setVehicleDefaults)('defaultServiceIntervalKm', event.target.value)} /><p className="text-ink-500 text-xs">Kilometres between scheduled services.</p></div>
            <ToggleRow label="Require Pre-Trip Inspection" description="Vehicles must pass an official inspection before release for a trip." checked={vehicleDefaults.requirePreTripInspection} onChange={(value) => updateSetting(setVehicleDefaults)('requirePreTripInspection', value)} />
          </div>
        );

      case 4:
        return (
          <div className="space-y-4">
            <SectionIntro title="Driver Management" subtitle="Configure tenant defaults for driver eligibility and allocation." />
            <ToggleRow label="Require Licence Verification" description="Driver licences must be uploaded and verified before assignment." checked={driverSetup.requireLicenceVerification} onChange={(value) => updateSetting(setDriverSetup)('requireLicenceVerification', value)} />
            <ToggleRow label="Auto-Assign on Allocation" description="Use the primary driver automatically when a vehicle allocation already identifies one." checked={driverSetup.autoAssignOnAllocation} onChange={(value) => updateSetting(setDriverSetup)('autoAssignOnAllocation', value)} />
            <div className="space-y-1.5"><Label>Max Concurrent Trips per Driver</Label><StyledSelect value={String(driverSetup.maxConcurrentTrips)} onChange={(event) => updateSetting(setDriverSetup)('maxConcurrentTrips', Number(event.target.value))}><option value="1">1 trip</option><option value="2">2 trips</option><option value="3">3 trips</option></StyledSelect></div>
          </div>
        );

      case 5:
        return (
          <div className="space-y-4">
            <SectionIntro title="Fuel Tracking" subtitle="Configure fuel entry evidence and warning defaults." />
            <ToggleRow label="Track Fuel Entries" description="Allow eligible drivers and administrators to record fuel purchases." checked={fuelSettings.trackFuelEntries} onChange={(value) => updateSetting(setFuelSettings)('trackFuelEntries', value)} />
            <ToggleRow label="Require Fuel Receipt" description="Fuel entries require a receipt or other proof of purchase." checked={fuelSettings.requireFuelReceipt} onChange={(value) => updateSetting(setFuelSettings)('requireFuelReceipt', value)} />
            <div className="space-y-1.5"><Label>Fuel Limit Warning (%)</Label><Input type="number" min={1} max={100} value={String(fuelSettings.fuelLimitWarningPct)} onChange={(event) => updateSetting(setFuelSettings)('fuelLimitWarningPct', Number(event.target.value))} /><p className="text-ink-500 text-xs">Warn when the configured threshold is reached.</p></div>
          </div>
        );

      case 6:
        return (
          <div className="space-y-4">
            <SectionIntro title="Inspection Policies" subtitle="Define the default official inspection requirements for tenant vehicles." />
            <ToggleRow label="Departure Inspection Required" description="Vehicles must be inspected by an authorised inspector before departure." checked={inspectionRules.departureInspectionRequired} onChange={(value) => updateSetting(setInspectionRules)('departureInspectionRequired', value)} />
            <ToggleRow label="Return Inspection Required" description="Vehicles must be inspected by an authorised inspector when they return." checked={inspectionRules.returnInspectionRequired} onChange={(value) => updateSetting(setInspectionRules)('returnInspectionRequired', value)} />
            <div className="space-y-1.5"><Label>Periodic Inspection Interval</Label><StyledSelect value={String(inspectionRules.periodicInspectionDays)} onChange={(event) => updateSetting(setInspectionRules)('periodicInspectionDays', Number(event.target.value))}><option value="14">Every 14 days</option><option value="30">Every 30 days</option><option value="60">Every 60 days</option><option value="90">Every 90 days</option></StyledSelect></div>
          </div>
        );

      case 7:
        return (
          <div className="space-y-4">
            <SectionIntro title="Notification Preferences" subtitle="Choose default delivery channels for tenant operational notifications." />
            <ToggleRow label="Email Notifications" description="Send eligible approval, trip and outcome notifications by email." checked={notificationPrefs.emailNotifications} onChange={(value) => updateSetting(setNotificationPrefs)('emailNotifications', value)} />
            <ToggleRow label="SMS Notifications" description="Use SMS for configured critical alerts when SMS delivery is available." checked={notificationPrefs.smsNotifications} onChange={(value) => updateSetting(setNotificationPrefs)('smsNotifications', value)} />
            <div className="space-y-1.5"><Label>Digest Frequency</Label><StyledSelect value={notificationPrefs.digestFrequency} onChange={(event) => updateSetting(setNotificationPrefs)('digestFrequency', event.target.value)}><option value="immediate">Immediate</option><option value="daily">Daily digest</option><option value="weekly">Weekly digest</option></StyledSelect></div>
          </div>
        );

      case 8:
        return (
          <div className="space-y-4">
            <SectionIntro title="Role Assignments" subtitle="Configure default role provisioning and user-account notifications." />
            <ToggleRow label="Auto-Assign Tenant Administrator" description="Grant the Tenant Administrator role to the account owner during initial setup." checked={roleAssignments.autoAssignTenantAdmin} onChange={(value) => updateSetting(setRoleAssignments)('autoAssignTenantAdmin', value)} />
            <ToggleRow label="Create Default Roles" description="Provision the standard system roles used by GovFleet workflows." checked={roleAssignments.createDefaultRoles} onChange={(value) => updateSetting(setRoleAssignments)('createDefaultRoles', value)} />
            <ToggleRow label="Notify New Users" description="Send an account notification when a new user is created." checked={roleAssignments.notifyNewUsers} onChange={(value) => updateSetting(setRoleAssignments)('notifyNewUsers', value)} />
          </div>
        );

      case 9:
        return (
          <div className="space-y-4">
            <SectionIntro title="Workspace Branding" subtitle="Set tenant colours and contact details used by the workspace and generated documents." />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Primary Colour</Label><div className="flex items-center gap-2"><div className="border-border h-10 w-10 shrink-0 rounded-[6px] border" style={{ backgroundColor: branding.primaryColor }} /><Input type="text" value={branding.primaryColor} onChange={(event) => updateSetting(setBranding)('primaryColor', event.target.value)} className="min-w-0 flex-1 font-mono" /></div></div>
              <div className="space-y-1.5"><Label>Accent Colour</Label><div className="flex items-center gap-2"><div className="border-border h-10 w-10 shrink-0 rounded-[6px] border" style={{ backgroundColor: branding.accentColor }} /><Input type="text" value={branding.accentColor} onChange={(event) => updateSetting(setBranding)('accentColor', event.target.value)} className="min-w-0 flex-1 font-mono" /></div></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Contact Email</Label><Input type="email" placeholder="transport@organisation.gov.na" value={branding.contactEmail} onChange={(event) => updateSetting(setBranding)('contactEmail', event.target.value)} /></div>
              <div className="space-y-1.5"><Label>Contact Phone</Label><Input placeholder="+264 …" value={branding.contactPhone} onChange={(event) => updateSetting(setBranding)('contactPhone', event.target.value)} /></div>
            </div>
          </div>
        );

      case 10:
        return (
          <div className="space-y-5 sm:space-y-6">
            <div className="text-center">
              <div className="bg-brand-50 text-brand-700 mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full sm:h-14 sm:w-14"><Sparkles className="h-6 w-6 sm:h-7 sm:w-7" /></div>
              <h3 className="text-ink-950 text-lg font-semibold">Review workspace setup</h3>
              <p className="text-ink-500 mt-1 text-sm">Confirm the initial configuration before submitting it for platform review.</p>
            </div>
            <section aria-label="Setup summary" className="border-border grid grid-cols-3 gap-px overflow-hidden rounded-[10px] border bg-border">
              {[
                ['Offices', offices.filter((office) => office.name.trim()).length],
                ['Departments', departments.filter((department) => department.name.trim()).length],
                ['Steps', `${completedSteps.length}/${TOTAL_STEPS - 1}`],
              ].map(([label, value]) => <div key={String(label)} className="bg-surface px-2 py-3 text-center sm:px-4"><p className="text-brand-700 text-xl font-semibold tabular-nums">{value}</p><p className="text-ink-500 mt-0.5 text-[11px]">{label}</p></div>)}
            </section>
            <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Configuration Summary</CardTitle></CardHeader><CardContent><dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2"><div><dt className="text-ink-500 text-xs">Fuel type</dt><dd className="text-ink-900 mt-0.5 capitalize">{vehicleDefaults.defaultFuelType}</dd></div><div><dt className="text-ink-500 text-xs">Odometer</dt><dd className="text-ink-900 mt-0.5">{vehicleDefaults.odometerUnit}</dd></div><div><dt className="text-ink-500 text-xs">Inspection interval</dt><dd className="text-ink-900 mt-0.5">{inspectionRules.periodicInspectionDays} days</dd></div><div><dt className="text-ink-500 text-xs">Email notifications</dt><dd className="text-ink-900 mt-0.5">{notificationPrefs.emailNotifications ? 'Enabled' : 'Disabled'}</dd></div><div><dt className="text-ink-500 text-xs">Licence verification</dt><dd className="text-ink-900 mt-0.5">{driverSetup.requireLicenceVerification ? 'Required' : 'Not required'}</dd></div><div><dt className="text-ink-500 text-xs">Primary colour</dt><dd className="text-ink-900 mt-0.5 flex items-center gap-2"><span className="border-border inline-block h-3 w-3 rounded-full border" style={{ backgroundColor: branding.primaryColor }} />{branding.primaryColor}</dd></div></dl></CardContent></Card>
            <div className="border-brand-200 bg-brand-50/50 dark:border-brand-900/60 dark:bg-brand-950/20 rounded-[8px] border p-4"><div className="flex items-start gap-3"><CheckCircle2 className="text-brand-700 mt-0.5 h-5 w-5 shrink-0" /><div><p className="text-ink-950 text-sm font-medium">Ready for review</p><p className="text-ink-600 mt-1 text-xs leading-5">Completing setup submits this tenant configuration for platform review. Tenant settings can still be managed later after activation.</p></div></div></div>
          </div>
        );

      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="text-ink-500 flex min-h-[55dvh] items-center justify-center gap-2 text-sm" role="status">
        <Loader2 className="text-brand-700 h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Loading workspace setup…
      </div>
    );
  }

  const progress = Math.round(((completedSteps.length + (currentStep === TOTAL_STEPS - 1 ? 1 : 0)) / TOTAL_STEPS) * 100);
  const activeStep = STEPS[currentStep];

  return (
    <div className="mx-auto max-w-3xl space-y-5 sm:space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Workspace Setup' }]} />
      <PageHeader title="Workspace Setup" description="Configure the tenant workspace before it enters operational use" />

      <section aria-label="Setup progress" className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-ink-600 text-xs font-medium">Step {currentStep + 1} of {TOTAL_STEPS} · {activeStep.label}</p>
          <p className="text-ink-500 text-xs tabular-nums">{progress}%</p>
        </div>
        <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
          <div className="bg-brand-700 h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
        </div>
      </section>

      <div className="-mx-1 overflow-x-auto px-1 pb-1" aria-label="Setup steps">
        <div className="flex min-w-max gap-1.5">
          {STEPS.map((step, index) => {
            const completed = completedSteps.includes(index);
            const active = currentStep === index;
            const navigable = completed || active;
            const StepIcon = step.icon;
            return (
              <button
                key={step.label}
                type="button"
                disabled={!navigable || saving}
                onClick={() => { if (completed && !active) void jumpToStep(index); }}
                aria-current={active ? 'step' : undefined}
                className={`focus-ring flex min-h-11 items-center gap-2 rounded-[7px] border px-3 text-xs font-medium transition-colors motion-reduce:transition-none ${
                  active
                    ? 'border-brand-700 bg-brand-700 text-white'
                    : completed
                      ? 'border-brand-200 bg-brand-50/60 text-brand-800 dark:border-brand-900/60 dark:bg-brand-950/20 dark:text-brand-200'
                      : 'border-border bg-surface text-ink-400'
                } disabled:cursor-default`}
              >
                {completed && !active ? <CheckCircle2 className="h-3.5 w-3.5" /> : <StepIcon className="h-3.5 w-3.5" />}
                <span>{index + 1}. {step.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-start gap-3">
            <div className="bg-brand-50 text-brand-700 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] dark:bg-brand-950/30 dark:text-brand-300"><activeStep.icon className="h-4 w-4" /></div>
            <div className="min-w-0"><CardTitle>{activeStep.label}</CardTitle><p className="text-ink-500 mt-1 text-sm">{activeStep.description}</p></div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {error && <div className="border-status-error-border bg-status-error-bg text-status-error-text rounded-[8px] border px-3 py-2.5 text-sm" role="alert">{error}</div>}
          {renderStep()}
          <div className="mobile-action-bar border-border mt-6 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="secondary" size="sm" onClick={goBack} disabled={currentStep === 0 || saving} className="w-full sm:w-auto"><ChevronLeft className="h-4 w-4" /> Back</Button>
              <Button variant="secondary" size="sm" onClick={() => void saveProgress({ currentStep, completedSteps, stepData: gatherStepData() })} disabled={saving} className="w-full sm:w-auto">{saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Save className="h-4 w-4" />} Save Progress</Button>
            </div>
            {currentStep < TOTAL_STEPS - 1 ? (
              <Button variant="primary" size="sm" onClick={() => void goNext()} disabled={!canProceed() || saving} className="w-full sm:w-auto">{saving && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />} Continue <ChevronRight className="h-4 w-4" /></Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => void handleComplete()} disabled={saving} className="w-full sm:w-auto">{saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <CheckCircle2 className="h-4 w-4" />} Complete Setup</Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}