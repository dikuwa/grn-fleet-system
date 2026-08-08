'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SetupWizardPage() {
  const router = useRouter();
  const { toast } = useToast();

  // Loading state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Wizard state
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [stepData, setStepData] = useState<StepData>({});
  const [saving, setSaving] = useState(false);

  // Form state
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

  // Offices & Departments
  const [offices, setOffices] = useState<OfficeInput[]>([]);
  const [departments, setDepartments] = useState<DepartmentInput[]>([]);

  // Step-specific settings
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

  // -----------------------------------------------------------------------
  // Load initial state
  // -----------------------------------------------------------------------

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

        // Restore progress
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

        // Seed default offices if none
        if ((data.offices?.length ?? 0) === 0) {
          setOffices([{ name: 'Head Office', code: 'HO', type: 'head_office', address: '' }]);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load setup');
          toast({ title: 'Failed to Load', description: 'Could not load setup progress.', variant: 'error' });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [toast]);

  // -----------------------------------------------------------------------
  // Save progress
  // -----------------------------------------------------------------------

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
      toast({ title: 'Save Failed', description: err instanceof Error ? err.message : 'Could not save progress.', variant: 'error' });
      return false;
    } finally {
      setSaving(false);
    }
  }, [toast]);

  // -----------------------------------------------------------------------
  // Step completion / navigation
  // -----------------------------------------------------------------------

  const gatherStepData = useCallback((): StepData => {
    return {
      ...stepData,
      vehicleDefaults,
      driverSetup,
      fuelSettings,
      inspectionRules,
      notificationPrefs,
      roleAssignments,
      branding,
      offices: offices.filter((o) => o.name.trim()),
      departments: departments.filter((d) => d.name.trim()),
    };
  }, [stepData, vehicleDefaults, driverSetup, fuelSettings, inspectionRules, notificationPrefs, roleAssignments, branding, offices, departments]);

  const completeStep = useCallback(async (step: number) => {
    const updated = completedSteps.includes(step)
      ? completedSteps
      : [...completedSteps, step].sort((a, b) => a - b);
    const data = {
      currentStep: step,
      completedSteps: updated,
      stepData: gatherStepData(),
    };
    const ok = await saveProgress(data);
    setCompletedSteps(updated);
    setStepData(data.stepData);
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
    // Save progress of current step before jumping
    const data = {
      currentStep: target,
      completedSteps,
      stepData: gatherStepData(),
    };
    await saveProgress(data);
    setStepData(data.stepData);
    setCurrentStep(target);
    setError(null);
  }, [currentStep, completedSteps, gatherStepData, saveProgress]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handleComplete = useCallback(async () => {
    const data = {
      currentStep: TOTAL_STEPS - 1,
      completedSteps: Array.from({ length: TOTAL_STEPS - 1 }, (_, i) => i),
      stepData: gatherStepData(),
    };
    // Save final progress, then signal completion so the tenant lifecycle
    // flips to PENDING_PLATFORM_REVIEW.
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
      toast({
        title: 'Setup Complete',
        description: 'Your workspace has been submitted for platform review.',
        variant: 'success',
      });
      router.push('/dashboard');
    } catch (err) {
      toast({
        title: 'Finalise Failed',
        description: err instanceof Error ? err.message : 'Could not finalise setup.',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }, [gatherStepData, saveProgress, router, toast]);

  // Office handlers
  const updateOffice = useCallback((index: number, field: keyof OfficeInput, value: string) => {
    setOffices((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }, []);

  const addOffice = useCallback(() => {
    setOffices((prev) => [...prev, { name: '', code: '', type: 'constituency_office', address: '' }]);
  }, []);

  const removeOffice = useCallback((index: number) => {
    setOffices((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Department handlers
  const updateDept = useCallback((index: number, field: keyof DepartmentInput, value: string) => {
    setDepartments((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }, []);

  const addDept = useCallback(() => {
    setDepartments((prev) => [...prev, { name: '', code: '' }]);
  }, []);

  const removeDept = useCallback((index: number) => {
    setDepartments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Generic field updater
  const updateSetting = useCallback(
    <T,>(setter: React.Dispatch<React.SetStateAction<T>>) =>
      (key: keyof T, value: T[keyof T]) => {
        setter((prev) => ({ ...prev, [key]: value }));
      },
    [],
  );

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  const canProceed = useCallback((): boolean => {
    switch (currentStep) {
      case 0: return !!tenantInfo;
      case 1: return true; // Departments optional
      case 2: return offices.some((o) => o.name.trim());
      case 3: return true;
      case 4: return true;
      case 5: return true;
      case 6: return true;
      case 7: return true;
      case 8: return true;
      case 9: return true;
      case 10: return true;
      default: return false;
    }
  }, [currentStep, tenantInfo, offices]);

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const SectionIntro = ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      <p className="text-xs text-ink-500">{subtitle}</p>
    </div>
  );

  const ToggleRow = ({ label, description, checked, onChange }: {
    label: string;
    description: string;
    checked: boolean;
    onChange: (v: boolean) => void;
  }) => (
    <label className="flex items-start justify-between gap-4 rounded-[8px] border border-border bg-surface p-4 cursor-pointer transition-colors hover:border-ink-300">
      <div>
        <p className="text-sm font-medium text-ink-900">{label}</p>
        <p className="text-xs text-ink-500 mt-0.5">{description}</p>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
      />
    </label>
  );

  // -----------------------------------------------------------------------
  // Render step
  // -----------------------------------------------------------------------

  const renderStep = () => {
    switch (currentStep) {
      // --- Step 0: Organisation Profile ---
      case 0:
        return (
          <div className="space-y-4">
            <SectionIntro title="Organisation Profile" subtitle="This information was collected during onboarding. Review and adjust as needed." />
            <div className="rounded-[8px] border border-border bg-surface divide-y divide-border">
              <div className="flex justify-between px-4 py-3 text-sm">
                <span className="text-ink-500">Organisation Name</span>
                <span className="font-medium text-ink-900">{tenantInfo?.name}</span>
              </div>
              <div className="flex justify-between px-4 py-3 text-sm">
                <span className="text-ink-500">Code</span>
                <span className="font-medium text-ink-900">{tenantInfo?.code}</span>
              </div>
              <div className="flex justify-between px-4 py-3 text-sm">
                <span className="text-ink-500">Slug</span>
                <span className="font-medium text-ink-900 font-mono">{tenantInfo?.slug}</span>
              </div>
              <div className="flex justify-between px-4 py-3 text-sm">
                <span className="text-ink-500">Type</span>
                <span className="font-medium text-ink-900">
                  {ORG_TYPES.find((t) => t.value === tenantInfo?.type)?.label ?? tenantInfo?.type}
                </span>
              </div>
              <div className="flex justify-between px-4 py-3 text-sm">
                <span className="text-ink-500">Timezone</span>
                <span className="font-medium text-ink-900">{tenantInfo?.timezone}</span>
              </div>
              <div className="flex justify-between px-4 py-3 text-sm">
                <span className="text-ink-500">Lifecycle Status</span>
                <span>
                  <Badge variant="info" size="sm">{tenantInfo?.lifecycleStatus?.replace(/_/g, ' ')}</Badge>
                </span>
              </div>
            </div>
          </div>
        );

      // --- Step 1: Departments ---
      case 1:
        return (
          <div className="space-y-4">
            <SectionIntro title="Departments & Units" subtitle="Optional — add departments to structure your organisation. Can be managed later." />
            {departments.map((dept, i) => (
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
                <button onClick={() => removeDept(i)} className="text-ink-400 hover:text-status-error-text transition-colors shrink-0" aria-label="Remove department">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button variant="secondary" size="compact" onClick={addDept} className="w-full">
              <Plus className="h-4 w-4" /> Add Department
            </Button>
          </div>
        );

      // --- Step 2: Offices ---
      case 2:
        return (
          <div className="space-y-4">
            <SectionIntro title="Offices & Depots" subtitle="Add your organisation's offices, depots and workshops." />
            {offices.map((office, i) => (
              <div key={i} className="rounded-[8px] border border-border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink-500 uppercase">Office {i + 1}</span>
                  {offices.length > 1 && (
                    <button onClick={() => removeOffice(i)} className="text-ink-400 hover:text-status-error-text transition-colors" aria-label="Remove office">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Office name" value={office.name} onChange={(e) => updateOffice(i, 'name', e.target.value)} className="h-10" />
                  <Input placeholder="Code" value={office.code} onChange={(e) => updateOffice(i, 'code', e.target.value.toUpperCase())} className="h-10 font-mono" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <StyledSelect value={office.type} onChange={(e) => updateOffice(i, 'type', e.target.value)}>
                    <option value="head_office">Head Office</option>
                    <option value="constituency_office">Constituency Office</option>
                    <option value="settlement_office">Settlement Office</option>
                    <option value="depot">Depot / Workshop</option>
                  </StyledSelect>
                  <Input placeholder="Address (optional)" value={office.address} onChange={(e) => updateOffice(i, 'address', e.target.value)} className="h-10" />
                </div>
              </div>
            ))}
            <Button variant="secondary" size="compact" onClick={addOffice} className="w-full">
              <Plus className="h-4 w-4" /> Add Office
            </Button>
          </div>
        );

      // --- Step 3: Vehicle Defaults ---
      case 3:
        return (
          <div className="space-y-4">
            <SectionIntro title="Fleet Defaults" subtitle="Configure default settings for fleet vehicles." />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Default Fuel Type</Label>
                <StyledSelect value={vehicleDefaults.defaultFuelType} onChange={(e) => updateSetting(setVehicleDefaults)('defaultFuelType', e.target.value)}>
                  <option value="diesel">Diesel</option>
                  <option value="petrol">Petrol</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="electric">Electric</option>
                </StyledSelect>
              </div>
              <div className="space-y-1.5">
                <Label>Odometer Unit</Label>
                <StyledSelect value={vehicleDefaults.odometerUnit} onChange={(e) => updateSetting(setVehicleDefaults)('odometerUnit', e.target.value)}>
                  <option value="km">Kilometres (km)</option>
                  <option value="mi">Miles (mi)</option>
                </StyledSelect>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Default Service Interval</Label>
              <Input
                type="number"
                value={vehicleDefaults.defaultServiceIntervalKm}
                onChange={(e) => updateSetting(setVehicleDefaults)('defaultServiceIntervalKm', e.target.value)}
                className="h-11"
              />
              <p className="text-xs text-ink-400">Kilometres between scheduled services</p>
            </div>
            <ToggleRow
              label="Require Pre-Trip Inspection"
              description="Vehicles must pass an inspection before being released for a trip"
              checked={vehicleDefaults.requirePreTripInspection}
              onChange={(v) => updateSetting(setVehicleDefaults)('requirePreTripInspection', v)}
            />
          </div>
        );

      // --- Step 4: Driver Setup ---
      case 4:
        return (
          <div className="space-y-4">
            <SectionIntro title="Driver Management" subtitle="Configure how drivers are managed in your workspace." />
            <ToggleRow
              label="Require Licence Verification"
              description="Driver licences must be uploaded and verified before they can be assigned"
              checked={driverSetup.requireLicenceVerification}
              onChange={(v) => updateSetting(setDriverSetup)('requireLicenceVerification', v)}
            />
            <ToggleRow
              label="Auto-Assign on Allocation"
              description="Assign the primary driver automatically when a vehicle is allocated"
              checked={driverSetup.autoAssignOnAllocation}
              onChange={(v) => updateSetting(setDriverSetup)('autoAssignOnAllocation', v)}
            />
            <div className="space-y-1.5">
              <Label>Max Concurrent Trips per Driver</Label>
              <StyledSelect value={String(driverSetup.maxConcurrentTrips)} onChange={(e) => updateSetting(setDriverSetup)('maxConcurrentTrips', Number(e.target.value))}>
                <option value="1">1 trip</option>
                <option value="2">2 trips</option>
                <option value="3">3 trips</option>
              </StyledSelect>
            </div>
          </div>
        );

      // --- Step 5: Fuel & Odometer ---
      case 5:
        return (
          <div className="space-y-4">
            <SectionIntro title="Fuel Tracking" subtitle="Configure fuel entry tracking and warnings." />
            <ToggleRow
              label="Track Fuel Entries"
              description="Allow drivers and administrators to record fuel purchases"
              checked={fuelSettings.trackFuelEntries}
              onChange={(v) => updateSetting(setFuelSettings)('trackFuelEntries', v)}
            />
            <ToggleRow
              label="Require Fuel Receipt"
              description="Fuel entries require a receipt or proof of purchase"
              checked={fuelSettings.requireFuelReceipt}
              onChange={(v) => updateSetting(setFuelSettings)('requireFuelReceipt', v)}
            />
            <div className="space-y-1.5">
              <Label>Fuel Limit Warning (%)</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={String(fuelSettings.fuelLimitWarningPct)}
                onChange={(e) => updateSetting(setFuelSettings)('fuelLimitWarningPct', Number(e.target.value))}
                className="h-11"
              />
              <p className="text-xs text-ink-400">Warn when fuel level drops below this percentage</p>
            </div>
          </div>
        );

      // --- Step 6: Inspection Rules ---
      case 6:
        return (
          <div className="space-y-4">
            <SectionIntro title="Inspection Policies" subtitle="Configure when inspections are required." />
            <ToggleRow
              label="Departure Inspection Required"
              description="Vehicles must be inspected before departure"
              checked={inspectionRules.departureInspectionRequired}
              onChange={(v) => updateSetting(setInspectionRules)('departureInspectionRequired', v)}
            />
            <ToggleRow
              label="Return Inspection Required"
              description="Vehicles must be inspected upon return"
              checked={inspectionRules.returnInspectionRequired}
              onChange={(v) => updateSetting(setInspectionRules)('returnInspectionRequired', v)}
            />
            <div className="space-y-1.5">
              <Label>Periodic Inspection Interval</Label>
              <StyledSelect value={String(inspectionRules.periodicInspectionDays)} onChange={(e) => updateSetting(setInspectionRules)('periodicInspectionDays', Number(e.target.value))}>
                <option value="14">Every 14 days</option>
                <option value="30">Every 30 days</option>
                <option value="60">Every 60 days</option>
                <option value="90">Every 90 days</option>
              </StyledSelect>
            </div>
          </div>
        );

      // --- Step 7: Notifications ---
      case 7:
        return (
          <div className="space-y-4">
            <SectionIntro title="Notification Preferences" subtitle="Choose how your team receives notifications." />
            <ToggleRow
              label="Email Notifications"
              description="Send email notifications for approvals, trips and updates"
              checked={notificationPrefs.emailNotifications}
              onChange={(v) => updateSetting(setNotificationPrefs)('emailNotifications', v)}
            />
            <ToggleRow
              label="SMS Notifications"
              description="Send SMS notifications for critical alerts"
              checked={notificationPrefs.smsNotifications}
              onChange={(v) => updateSetting(setNotificationPrefs)('smsNotifications', v)}
            />
            <div className="space-y-1.5">
              <Label>Digest Frequency</Label>
              <StyledSelect value={notificationPrefs.digestFrequency} onChange={(e) => updateSetting(setNotificationPrefs)('digestFrequency', e.target.value)}>
                <option value="immediate">Immediate</option>
                <option value="daily">Daily digest</option>
                <option value="weekly">Weekly digest</option>
              </StyledSelect>
            </div>
          </div>
        );

      // --- Step 8: Roles ---
      case 8:
        return (
          <div className="space-y-4">
            <SectionIntro title="Role Assignments" subtitle="Configure default roles and user management settings." />
            <ToggleRow
              label="Auto-Assign Tenant Administrator"
              description="Grant the Tenant Administrator role to the account owner"
              checked={roleAssignments.autoAssignTenantAdmin}
              onChange={(v) => updateSetting(setRoleAssignments)('autoAssignTenantAdmin', v)}
            />
            <ToggleRow
              label="Create Default Roles"
              description="Provision the standard set of roles (Requester, Supervisor, Driver, etc.)"
              checked={roleAssignments.createDefaultRoles}
              onChange={(v) => updateSetting(setRoleAssignments)('createDefaultRoles', v)}
            />
            <ToggleRow
              label="Notify New Users"
              description="Send an email notification when new users are created"
              checked={roleAssignments.notifyNewUsers}
              onChange={(v) => updateSetting(setRoleAssignments)('notifyNewUsers', v)}
            />
          </div>
        );

      // --- Step 9: Branding ---
      case 9:
        return (
          <div className="space-y-4">
            <SectionIntro title="Workspace Branding" subtitle="Customise the appearance of your workspace." />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Primary Colour</Label>
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-[6px] border border-border shrink-0" style={{ backgroundColor: branding.primaryColor }} />
                  <Input
                    type="text"
                    value={branding.primaryColor}
                    onChange={(e) => updateSetting(setBranding)('primaryColor', e.target.value)}
                    className="h-11 font-mono flex-1"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Accent Colour</Label>
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-[6px] border border-border shrink-0" style={{ backgroundColor: branding.accentColor }} />
                  <Input
                    type="text"
                    value={branding.accentColor}
                    onChange={(e) => updateSetting(setBranding)('accentColor', e.target.value)}
                    className="h-11 font-mono flex-1"
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Contact Email</Label>
                <Input
                  type="email"
                  placeholder="transport@council.gov.na"
                  value={branding.contactEmail}
                  onChange={(e) => updateSetting(setBranding)('contactEmail', e.target.value)}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Contact Phone</Label>
                <Input
                  placeholder="+264 61 123 456"
                  value={branding.contactPhone}
                  onChange={(e) => updateSetting(setBranding)('contactPhone', e.target.value)}
                  className="h-11"
                />
              </div>
            </div>
          </div>
        );

      // --- Step 10: Review & Complete ---
      case 10:
        return (
          <div className="space-y-6">
            <div className="text-center pb-2">
              <div className="mx-auto h-14 w-14 rounded-full bg-brand-50 flex items-center justify-center mb-3">
                <Sparkles className="h-7 w-7 text-brand-600" />
              </div>
              <h3 className="text-lg font-medium text-ink-900">You&apos;re almost done!</h3>
              <p className="text-sm text-ink-500">Review your configuration and complete setup.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Card>
                <CardContent className="pt-6 text-center">
                  <p className="text-2xl font-semibold text-brand-600">{offices.filter((o) => o.name.trim()).length}</p>
                  <p className="text-xs text-ink-500 mt-1">Offices</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6 text-center">
                  <p className="text-2xl font-semibold text-brand-600">{departments.filter((d) => d.name.trim()).length}</p>
                  <p className="text-xs text-ink-500 mt-1">Departments</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6 text-center">
                  <p className="text-2xl font-semibold text-brand-600">{completedSteps.length}/{TOTAL_STEPS - 1}</p>
                  <p className="text-xs text-ink-500 mt-1">Steps Completed</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle className="text-sm">Configuration Summary</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p><span className="text-ink-500">Fuel Type:</span> {vehicleDefaults.defaultFuelType}</p>
                <p><span className="text-ink-500">Odometer:</span> {vehicleDefaults.odometerUnit}</p>
                <p><span className="text-ink-500">Inspection Interval:</span> {inspectionRules.periodicInspectionDays} days</p>
                <p><span className="text-ink-500">Email Notifications:</span> {notificationPrefs.emailNotifications ? 'Enabled' : 'Disabled'}</p>
                <p><span className="text-ink-500">Licence Verification:</span> {driverSetup.requireLicenceVerification ? 'Required' : 'Not required'}</p>
                <p><span className="text-ink-500">Branding:</span> <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full border border-border" style={{ backgroundColor: branding.primaryColor }} />{branding.primaryColor}</span></p>
              </CardContent>
            </Card>

            <div className="rounded-[8px] bg-brand-50 border border-brand-200 p-4 text-sm">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-brand-600 mt-0.5" />
                <div>
                  <p className="font-medium text-brand-800">Ready to launch</p>
                  <p className="text-brand-700 mt-1">
                    Completing setup will finalise your workspace configuration. You can
                    adjust any of these settings later from the Administration area.
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

  // -----------------------------------------------------------------------
  // Main render
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
          <span className="text-sm text-ink-500">Loading workspace setup…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Workspace Setup' },
      ]} />
      <PageHeader
        title="Workspace Setup"
        description="Complete the setup of your organisation's fleet management workspace"
      />

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-ink-500">Setup Progress</p>
          <p className="text-xs text-ink-500">{Math.round(((completedSteps.length + (currentStep === TOTAL_STEPS - 1 ? 1 : 0)) / TOTAL_STEPS) * 100)}%</p>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-brand-600 transition-all duration-300"
            style={{ width: `${Math.round(((completedSteps.length + (currentStep === TOTAL_STEPS - 1 ? 1 : 0)) / TOTAL_STEPS) * 100)}%` }}
          />
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-0 overflow-x-auto pb-2">
        {STEPS.map((step, index) => (
          <div key={index} className="flex items-center gap-0">
            <button
              onClick={() => completedSteps.includes(index) && jumpToStep(index)}
              className={`flex flex-col items-center gap-1 px-2.5 py-2 rounded-[8px] transition-all min-w-[72px] ${
                index === currentStep
                  ? 'bg-brand-600 text-white shadow-sm'
                  : completedSteps.includes(index)
                    ? 'bg-brand-100 text-brand-700 hover:bg-brand-200 cursor-pointer'
                    : index < currentStep
                      ? 'bg-brand-50 text-brand-400'
                      : 'bg-muted text-ink-400'
              }`}
              aria-label={step.label}
            >
              <step.icon className="h-4 w-4" />
              <span className="text-[10px] font-medium whitespace-nowrap">{step.label}</span>
            </button>
            {index < STEPS.length - 1 && (
              <div className={`h-px w-3 ${index < currentStep || completedSteps.includes(index) ? 'bg-brand-400' : 'bg-muted'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            {(() => {
              const step = STEPS[currentStep];
              return (
                <>
                  <step.icon className="h-5 w-5 text-brand-600" />
                  <CardTitle>{step.label}</CardTitle>
                </>
              );
            })()}
          </div>
          <p className="text-sm text-ink-500 mt-1">{STEPS[currentStep]?.description}</p>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-[8px] bg-status-error-bg p-3 text-sm text-status-error-text">
              {error}
            </div>
          )}

          {renderStep()}

          {/* Navigation */}
          <div className="mt-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="tertiary" size="default" onClick={goBack} disabled={currentStep === 0 || saving}>
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                variant="secondary"
                size="default"
                onClick={() => saveProgress({ currentStep, completedSteps, stepData: gatherStepData() })}
                disabled={saving}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Progress
              </Button>
            </div>

            {currentStep < TOTAL_STEPS - 1 ? (
              <Button
                variant="primary"
                size="default"
                onClick={goNext}
                disabled={!canProceed() || saving}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Continue
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="primary"
                size="default"
                onClick={handleComplete}
                disabled={saving}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Complete Setup
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}