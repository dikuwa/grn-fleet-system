'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useSession } from '@/lib/auth-client';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, FieldWrapper, Label } from '@/components/ui/input';
import { StyledDateInput, StyledSelect } from '@/components/ui/styled-select';
import {
  Loader2,
  Save,
  Bell,
  Shield,
  Mail,
  Palette,
  Image as ImageIcon,
  AlertCircle,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { fetchWithRetry } from '@/lib/fetch-with-retry';

export default function SettingsPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'general' | 'notifications' | 'security' | 'branding'>(
    'general',
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [error, setError] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [orgName, setOrgName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [address, setAddress] = useState('');
  const [timezone, setTimezone] = useState('Africa/Windhoek (CAT, UTC+2)');
  const [primaryColor, setPrimaryColor] = useState('#1F4E8C');
  const [accentColor, setAccentColor] = useState('#0F766E');
  const [documentFooter, setDocumentFooter] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [inAppNotifs, setInAppNotifs] = useState(true);
  const [quietStart, setQuietStart] = useState('20:00');
  const [quietEnd, setQuietEnd] = useState('07:00');
  const [emergencyBypass, setEmergencyBypass] = useState(true);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    fetchWithRetry('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.success) {
          const { tenant, branding, notificationPreferences } = data.data;
          setOrgName(tenant.name || '');
          setTimezone(tenant.timezone || 'Africa/Windhoek (CAT, UTC+2)');
          if (branding) {
            setLogoUrl(branding.logoUrl ? `/api/settings/logo?v=${Date.now()}` : '');
            setContactEmail(branding.contactEmail || '');
            setContactPhone(branding.contactPhone || '');
            setAddress(branding.address || '');
            setPrimaryColor(branding.primaryColor || '#1F4E8C');
            setAccentColor(branding.accentColor || '#0F766E');
            setDocumentFooter(branding.documentFooter || '');
            setSenderName(branding.senderName || '');
            setSenderEmail(branding.senderEmail || '');
          }
          if (notificationPreferences) {
            setEmailNotifs(notificationPreferences.emailNotifications !== false);
            setInAppNotifs(notificationPreferences.inAppNotifications !== false);
            setQuietStart(notificationPreferences.quietHoursStart || '20:00');
            setQuietEnd(notificationPreferences.quietHoursEnd || '07:00');
            setEmergencyBypass(notificationPreferences.emergencyBypassQuietHours !== false);
          }
        } else {
          setError('Failed to load settings');
        }
      })
      .catch(() => setError('Failed to load settings'))
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    setError('');
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant: { name: orgName, timezone },
          branding: {
            contactEmail,
            contactPhone,
            address,
            primaryColor,
            accentColor,
            documentFooter,
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      toast({
        title: 'Settings saved',
        description: 'Your preferences have been updated',
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Failed to save',
        description: err instanceof Error ? err.message : 'Failed to save settings',
        variant: 'error',
      });
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }, [
    orgName,
    contactEmail,
    contactPhone,
    address,
    timezone,
    primaryColor,
    accentColor,
    documentFooter,
    senderName,
    senderEmail,
    emailNotifs,
    inAppNotifs,
    quietStart,
    quietEnd,
    emergencyBypass,
    isSaving,
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
        setLogoUrl(result.data.logoUrl);
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="text-ink-400 h-6 w-6 animate-spin" />
      </div>
    );
  }

  const tabs = [
    { value: 'general' as const, label: 'General', icon: <Shield className="h-4 w-4" /> },
    { value: 'notifications' as const, label: 'Notifications', icon: <Bell className="h-4 w-4" /> },
    { value: 'branding' as const, label: 'Branding', icon: <Palette className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Settings' }]} />
      <PageHeader
        title="Settings"
        description="Configure application preferences and tenant settings"
      >
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          loading={isSaving}
          disabled={isSaving}
        >
          <Save className="h-4 w-4" /> Save Changes
        </Button>
      </PageHeader>

      {error && (
        <div className="border-status-error-bg bg-status-error-bg/20 rounded-[8px] border px-4 py-3">
          <p className="text-status-error-text flex items-center gap-2 text-sm font-medium">
            <AlertCircle className="h-4 w-4" />
            {error}
          </p>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.value
                ? 'bg-brand-800 text-white'
                : 'bg-muted text-ink-700 hover:bg-border'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'general' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Tenant Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Organisation Name" required>
                  <Input
                    aria-label="Organisation Name"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                  />
                </FieldWrapper>
                <FieldWrapper label="Tenant Status">
                  <Input
                    aria-label="Tenant Status"
                    value="Active"
                    disabled
                    className="opacity-60"
                  />
                </FieldWrapper>
                <FieldWrapper label="Contact Email">
                  <Input
                    aria-label="Contact Email"
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                  />
                </FieldWrapper>
                <FieldWrapper label="Contact Phone">
                  <Input
                    aria-label="Contact Phone"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                  />
                </FieldWrapper>
                <FieldWrapper label="Physical Address" className="sm:col-span-2">
                  <Input
                    aria-label="Physical Address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </FieldWrapper>
                <FieldWrapper label="Timezone">
                  <StyledSelect
                    aria-label="Timezone"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                  >
                    <option value="Africa/Windhoek (CAT, UTC+2)">
                      Africa/Windhoek (CAT, UTC+2)
                    </option>
                  </StyledSelect>
                </FieldWrapper>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'notifications' && (
        <Card>
          <CardHeader>
            <CardTitle>Notification Preferences</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <h4 className="text-ink-950 text-sm font-medium">Delivery Channels</h4>
              <div className="space-y-3">
                <label className="border-border hover:bg-muted/50 flex cursor-pointer items-center justify-between rounded-[8px] border p-3 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                      <Bell className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-ink-950 text-sm font-medium">In-App Notifications</p>
                      <p className="text-ink-500 text-xs">Notifications within the dashboard</p>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={inAppNotifs}
                    onChange={(e) => setInAppNotifs(e.target.checked)}
                    className="border-border text-brand-800 focus:ring-brand-600 h-4 w-4 rounded"
                  />
                </label>
                <label className="border-border hover:bg-muted/50 flex cursor-pointer items-center justify-between rounded-[8px] border p-3 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-ink-950 text-sm font-medium">Email Notifications</p>
                      <p className="text-ink-500 text-xs">Send notifications via email</p>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={emailNotifs}
                    onChange={(e) => setEmailNotifs(e.target.checked)}
                    className="border-border text-brand-800 focus:ring-brand-600 h-4 w-4 rounded"
                  />
                </label>
              </div>
            </div>
            <div className="space-y-4">
              <h4 className="text-ink-950 text-sm font-medium">Quiet Hours</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Quiet Hours Start">
                  <StyledDateInput
                    type="time"
                    value={quietStart}
                    onChange={(e) => setQuietStart(e.target.value)}
                  />
                </FieldWrapper>
                <FieldWrapper label="Quiet Hours End">
                  <StyledDateInput
                    type="time"
                    value={quietEnd}
                    onChange={(e) => setQuietEnd(e.target.value)}
                  />
                </FieldWrapper>
              </div>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={emergencyBypass}
                  onChange={(e) => setEmergencyBypass(e.target.checked)}
                  className="border-border text-brand-800 focus:ring-brand-600 h-4 w-4 rounded"
                />
                <span className="text-ink-700 text-sm">
                  Emergency notifications bypass quiet hours
                </span>
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'branding' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Tenant Branding</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div
                data-testid="branding-top-layout"
                className="grid gap-6 lg:grid-cols-[minmax(240px,0.8fr)_minmax(320px,1.2fr)] lg:items-start"
              >
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="tenant-logo-input">Organisation Logo</Label>
                  <input
                    id="tenant-logo-input"
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    aria-label="Choose tenant logo"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadLogo(file);
                    }}
                  />
                  <div
                    data-testid="tenant-logo-preview"
                    className="border-border bg-muted/40 mx-auto flex h-44 w-full max-w-[260px] items-center justify-center rounded-[8px] border p-5 lg:mx-0"
                  >
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logoUrl}
                        alt="Current tenant logo"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="text-ink-500 flex flex-col items-center gap-2">
                        <ImageIcon className="h-6 w-6" />
                        <span className="text-center text-xs">PNG, JPEG or WebP · max 3 MB</span>
                      </div>
                    )}
                  </div>
                  <div className="mx-auto flex w-full max-w-[260px] flex-wrap gap-2 pt-1 lg:mx-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      loading={logoBusy}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      {logoUrl ? 'Replace logo' : 'Upload logo'}
                    </Button>
                    {logoUrl && (
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={logoBusy}
                        onClick={removeLogo}
                      >
                        Remove logo
                      </Button>
                    )}
                  </div>
                </div>
                <div className="min-w-0 space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="primary-colour">Primary Colour</Label>
                    <div className="flex min-w-0 items-center gap-2">
                      <input
                        type="color"
                        aria-label="Choose primary colour"
                        value={primaryColor}
                        onChange={(event) => setPrimaryColor(event.target.value.toUpperCase())}
                        className="border-border bg-surface h-10 w-10 shrink-0 cursor-pointer rounded-[8px] border p-1 focus:outline-none focus:ring-2 focus:ring-brand-600"
                      />
                      <Input
                        id="primary-colour"
                        aria-label="Primary Colour"
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="accent-colour">Accent Colour</Label>
                    <div className="flex min-w-0 items-center gap-2">
                      <input
                        type="color"
                        aria-label="Choose accent colour"
                        value={accentColor}
                        onChange={(event) => setAccentColor(event.target.value.toUpperCase())}
                        className="border-border bg-surface h-10 w-10 shrink-0 cursor-pointer rounded-[8px] border p-1 focus:outline-none focus:ring-2 focus:ring-brand-600"
                      />
                      <Input
                        id="accent-colour"
                        aria-label="Accent Colour"
                        value={accentColor}
                        onChange={(e) => setAccentColor(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="document-footer">Document Footer Text</Label>
                <Input
                  id="document-footer"
                  aria-label="Document Footer Text"
                  value={documentFooter}
                  onChange={(e) => setDocumentFooter(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email-sender-name">Email Sender Name</Label>
                <Input
                  id="email-sender-name"
                  aria-label="Email Sender Name"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email-sender-address">Email Sender Address</Label>
                <Input
                  id="email-sender-address"
                  aria-label="Email Sender Address"
                  type="email"
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
