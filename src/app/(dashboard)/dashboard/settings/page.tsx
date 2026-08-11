'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useSession } from '@/lib/auth-client';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldWrapper, Input, Label, Textarea } from '@/components/ui/input';
import { StyledDateInput, StyledSelect } from '@/components/ui/styled-select';
import {
  AlertCircle,
  Bell,
  Building2,
  Image as ImageIcon,
  Loader2,
  Mail,
  Palette,
  Save,
  Shield,
  Trash2,
  Upload,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { fetchWithRetry } from '@/lib/fetch-with-retry';

type SettingsTab = 'general' | 'notifications' | 'branding';
const WINDHOEK_TIMEZONE = 'Africa/Windhoek';

export default function SettingsPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [error, setError] = useState('');

  const [orgName, setOrgName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [address, setAddress] = useState('');
  const [timezone, setTimezone] = useState(WINDHOEK_TIMEZONE);
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#1F4E8C');
  const [accentColor, setAccentColor] = useState('#0F766E');
  const [documentFooter, setDocumentFooter] = useState('');
  const [executiveSignatoryName, setExecutiveSignatoryName] = useState('');
  const [executiveSignatoryTitle, setExecutiveSignatoryTitle] = useState('Chief Executive Officer');
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [inAppNotifs, setInAppNotifs] = useState(true);
  const [quietStart, setQuietStart] = useState('20:00');
  const [quietEnd, setQuietEnd] = useState('07:00');
  const [emergencyBypass, setEmergencyBypass] = useState(true);

  const loadSettings = useCallback(async () => {
    if (!session) return;
    setIsLoading(true);
    setError('');
    try {
      const response = await fetchWithRetry('/api/settings');
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to load settings');
      const { tenant, branding, notificationPreferences } = data.data;
      setOrgName(tenant.name || '');
      setTimezone(
        tenant.timezone === 'Africa/Windhoek (CAT, UTC+2)'
          ? WINDHOEK_TIMEZONE
          : tenant.timezone || WINDHOEK_TIMEZONE,
      );
      setLogoUrl(branding?.logoUrl ? `/api/settings/logo?v=${Date.now()}` : '');
      setContactEmail(branding?.contactEmail || '');
      setContactPhone(branding?.contactPhone || '');
      setAddress(branding?.address || '');
      setPrimaryColor(branding?.primaryColor || '#1F4E8C');
      setAccentColor(branding?.accentColor || '#0F766E');
      setDocumentFooter(branding?.documentFooter || '');
      setExecutiveSignatoryName(branding?.executiveSignatoryName || '');
      setExecutiveSignatoryTitle(branding?.executiveSignatoryTitle || 'Chief Executive Officer');
      setSenderName(branding?.senderName || '');
      setSenderEmail(branding?.senderEmail || '');
      setEmailNotifs(notificationPreferences?.emailNotifications !== false);
      setInAppNotifs(notificationPreferences?.inAppNotifications !== false);
      setQuietStart(notificationPreferences?.quietHoursStart || '20:00');
      setQuietEnd(notificationPreferences?.quietHoursEnd || '07:00');
      setEmergencyBypass(notificationPreferences?.emergencyBypassQuietHours !== false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadSettings(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadSettings]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    setError('');
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant: { name: orgName, timezone, locale: 'en-NA' },
          branding: {
            contactEmail,
            contactPhone,
            address,
            primaryColor,
            accentColor,
            documentFooter,
            executiveSignatoryName,
            executiveSignatoryTitle,
            senderName,
            senderEmail,
          },
          notificationPreferences: {
            emailNotifications: emailNotifs,
            inAppNotifications: inAppNotifs,
            quietHoursStart: quietStart,
            quietHoursEnd: quietEnd,
            emergencyBypassQuietHours: emergencyBypass,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save settings');
      toast({
        title: 'Tenant settings saved',
        description: 'Organisation, branding and notification preferences are up to date.',
        variant: 'success',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save settings';
      setError(message);
      toast({ title: 'Failed to save settings', description: message, variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  }, [
    accentColor,
    address,
    contactEmail,
    contactPhone,
    documentFooter,
    emailNotifs,
    emergencyBypass,
    executiveSignatoryName,
    executiveSignatoryTitle,
    inAppNotifs,
    isSaving,
    orgName,
    primaryColor,
    quietEnd,
    quietStart,
    senderEmail,
    senderName,
    timezone,
    toast,
  ]);

  const uploadLogo = useCallback(
    async (file: File) => {
      setLogoBusy(true);
      try {
        const form = new FormData();
        form.append('file', file);
        const response = await fetch('/api/settings/logo', { method: 'POST', body: form });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Logo upload failed');
        setLogoUrl(
          `${result.data.logoUrl}${result.data.logoUrl.includes('?') ? '&' : '?'}v=${Date.now()}`,
        );
        toast({ title: 'Tenant logo updated', variant: 'success' });
      } catch (err) {
        toast({
          title: 'Logo upload failed',
          description: err instanceof Error ? err.message : 'Please try again.',
          variant: 'error',
        });
      } finally {
        setLogoBusy(false);
        if (logoInputRef.current) logoInputRef.current.value = '';
      }
    },
    [toast],
  );

  const removeLogo = useCallback(async () => {
    setLogoBusy(true);
    try {
      const response = await fetch('/api/settings/logo', { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Logo removal failed');
      setLogoUrl('');
      toast({ title: 'Tenant logo removed', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Logo removal failed',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'error',
      });
    } finally {
      setLogoBusy(false);
    }
  }, [toast]);

  const tabs = [
    { value: 'general' as const, label: 'General', icon: Building2 },
    { value: 'notifications' as const, label: 'Notifications', icon: Bell },
    { value: 'branding' as const, label: 'Branding', icon: Palette },
  ];

  if (isLoading) {
    return (
      <div
        className="text-ink-500 flex items-center justify-center gap-2 py-16 text-sm"
        role="status"
      >
        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{' '}
        Loading tenant settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Settings' }]} />
      <PageHeader
        title="Tenant Settings"
        description="Manage organisation details, notification preferences and tenant branding."
      >
        <Button size="sm" onClick={() => void handleSave()} loading={isSaving} disabled={isSaving}>
          <Save className="h-4 w-4" aria-hidden="true" /> Save changes
        </Button>
      </PageHeader>

      {error && (
        <div
          className="border-status-error-border bg-status-error-bg rounded-[8px] border px-4 py-3"
          role="alert"
        >
          <p className="text-status-error-text flex items-center gap-2 text-sm font-medium">
            <AlertCircle className="h-4 w-4" aria-hidden="true" /> {error}
          </p>
        </div>
      )}

      <div
        className="border-border overflow-x-auto border-b"
        role="tablist"
        aria-label="Tenant settings sections"
      >
        <div className="flex min-w-max gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`settings-panel-${tab.value}`}
                onClick={() => setActiveTab(tab.value)}
                className={`focus-ring -mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors motion-reduce:transition-none ${selected ? 'border-brand-700 text-brand-700' : 'text-ink-500 hover:text-ink-800 border-transparent'}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'general' && (
        <section id="settings-panel-general" role="tabpanel" className="space-y-5">
          <div className="border-border bg-surface rounded-[10px] border p-5">
            <div className="mb-5 flex items-start gap-3">
              <Shield className="text-brand-700 mt-0.5 h-5 w-5" aria-hidden="true" />
              <div>
                <h2 className="text-ink-950 text-sm font-semibold">Organisation profile</h2>
                <p className="text-ink-500 mt-1 text-xs">
                  These details identify the tenant in the authenticated workspace and official
                  documents.
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldWrapper label="Organisation name" required>
                <Input value={orgName} onChange={(event) => setOrgName(event.target.value)} />
              </FieldWrapper>
              <FieldWrapper label="Timezone">
                <StyledSelect
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                >
                  <option value={WINDHOEK_TIMEZONE}>Africa/Windhoek (CAT, UTC+2)</option>
                </StyledSelect>
              </FieldWrapper>
              <FieldWrapper label="Contact email">
                <Input
                  type="email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                />
              </FieldWrapper>
              <FieldWrapper label="Contact phone">
                <Input
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                />
              </FieldWrapper>
              <FieldWrapper label="Physical address" className="sm:col-span-2">
                <Input value={address} onChange={(event) => setAddress(event.target.value)} />
              </FieldWrapper>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'notifications' && (
        <section id="settings-panel-notifications" role="tabpanel" className="space-y-5">
          <div className="border-border bg-surface rounded-[10px] border p-5">
            <div className="mb-5">
              <h2 className="text-ink-950 text-sm font-semibold">
                Your Tenant Administrator notification preferences
              </h2>
              <p className="text-ink-500 mt-1 text-xs">
                These preferences apply to your own account. They do not disable mandatory workflow
                notifications for other tenant users.
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="border-border hover:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-[8px] border p-4">
                <Checkbox
                  checked={inAppNotifs}
                  onCheckedChange={(checked) => setInAppNotifs(checked === true)}
                  aria-label="In-app notifications"
                />
                <span>
                  <span className="text-ink-950 flex items-center gap-2 text-sm font-medium">
                    <Bell className="text-brand-700 h-4 w-4" aria-hidden="true" />
                    In-app notifications
                  </span>
                  <span className="text-ink-500 mt-1 block text-xs">
                    Show eligible alerts in the authenticated workspace and notification bell.
                  </span>
                </span>
              </label>
              <label className="border-border hover:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-[8px] border p-4">
                <Checkbox
                  checked={emailNotifs}
                  onCheckedChange={(checked) => setEmailNotifs(checked === true)}
                  aria-label="Email notifications"
                />
                <span>
                  <span className="text-ink-950 flex items-center gap-2 text-sm font-medium">
                    <Mail className="text-brand-700 h-4 w-4" aria-hidden="true" />
                    Email notifications
                  </span>
                  <span className="text-ink-500 mt-1 block text-xs">
                    Send eligible notification deliveries to your account email.
                  </span>
                </span>
              </label>
            </div>
            <div className="border-border mt-5 border-t pt-5">
              <h3 className="text-ink-950 text-sm font-medium">Quiet hours</h3>
              <p className="text-ink-500 mt-1 text-xs">
                Non-emergency email/SMS delivery may be deferred during this period.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Start">
                  <StyledDateInput
                    type="time"
                    value={quietStart}
                    onChange={(event) => setQuietStart(event.target.value)}
                  />
                </FieldWrapper>
                <FieldWrapper label="End">
                  <StyledDateInput
                    type="time"
                    value={quietEnd}
                    onChange={(event) => setQuietEnd(event.target.value)}
                  />
                </FieldWrapper>
              </div>
              <label className="mt-4 flex cursor-pointer items-start gap-3">
                <Checkbox
                  checked={emergencyBypass}
                  onCheckedChange={(checked) => setEmergencyBypass(checked === true)}
                  aria-label="Emergency notifications bypass quiet hours"
                />
                <span className="text-ink-700 text-sm">
                  Emergency notifications bypass quiet hours
                </span>
              </label>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'branding' && (
        <section id="settings-panel-branding" role="tabpanel" className="space-y-5">
          <div className="border-border bg-surface rounded-[10px] border p-5">
            <div className="mb-5">
              <h2 className="text-ink-950 text-sm font-semibold">Tenant branding</h2>
              <p className="text-ink-500 mt-1 text-xs">
                Used on tenant-facing documents and selected authenticated surfaces.
                Platform/public-site branding is managed separately.
              </p>
            </div>
            <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
              <div className="space-y-3">
                <Label htmlFor="tenant-logo-input">Organisation logo</Label>
                <input
                  id="tenant-logo-input"
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadLogo(file);
                  }}
                />
                <div className="border-border bg-muted/20 flex min-h-36 items-center justify-center overflow-hidden rounded-[10px] border border-dashed p-4">
                  {logoUrl ? (
                    <Image
                      src={logoUrl}
                      alt="Tenant logo"
                      width={448}
                      height={112}
                      unoptimized
                      className="max-h-28 max-w-full object-contain"
                    />
                  ) : (
                    <div className="text-ink-400 text-center">
                      <ImageIcon className="mx-auto h-8 w-8" aria-hidden="true" />
                      <p className="mt-2 text-xs">No logo uploaded</p>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => logoInputRef.current?.click()}
                    loading={logoBusy}
                  >
                    <Upload className="h-4 w-4" /> {logoUrl ? 'Replace logo' : 'Upload logo'}
                  </Button>
                  {logoUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-status-error-text"
                      onClick={() => void removeLogo()}
                      disabled={logoBusy}
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </Button>
                  )}
                </div>
                <p className="text-ink-400 text-xs">
                  PNG, JPEG or WebP. Keep the source logo simple for official documents.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Primary colour">
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(event) => setPrimaryColor(event.target.value)}
                      className="border-border bg-surface h-10 w-12 cursor-pointer rounded-[8px] border p-1"
                      aria-label="Primary colour picker"
                    />
                    <Input
                      value={primaryColor}
                      onChange={(event) => setPrimaryColor(event.target.value)}
                    />
                  </div>
                </FieldWrapper>
                <FieldWrapper label="Accent colour">
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(event) => setAccentColor(event.target.value)}
                      className="border-border bg-surface h-10 w-12 cursor-pointer rounded-[8px] border p-1"
                      aria-label="Accent colour picker"
                    />
                    <Input
                      value={accentColor}
                      onChange={(event) => setAccentColor(event.target.value)}
                    />
                  </div>
                </FieldWrapper>
                <FieldWrapper label="Document sender name">
                  <Input
                    value={senderName}
                    onChange={(event) => setSenderName(event.target.value)}
                    placeholder={orgName || 'Organisation name'}
                  />
                </FieldWrapper>
                <FieldWrapper label="Document sender email">
                  <Input
                    type="email"
                    value={senderEmail}
                    onChange={(event) => setSenderEmail(event.target.value)}
                  />
                </FieldWrapper>
                <FieldWrapper label="Executive signatory">
                  <Input
                    value={executiveSignatoryName}
                    onChange={(event) => setExecutiveSignatoryName(event.target.value)}
                    placeholder="Full name"
                  />
                </FieldWrapper>
                <FieldWrapper label="Executive title">
                  <Input
                    value={executiveSignatoryTitle}
                    onChange={(event) => setExecutiveSignatoryTitle(event.target.value)}
                    placeholder="Chief Executive Officer"
                  />
                </FieldWrapper>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Document footer</Label>
                  <Textarea
                    rows={3}
                    value={documentFooter}
                    onChange={(event) => setDocumentFooter(event.target.value)}
                    placeholder="Optional official footer text shown on generated documents."
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
