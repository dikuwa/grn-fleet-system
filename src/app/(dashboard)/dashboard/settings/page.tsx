'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldWrapper, Input, Label } from '@/components/ui/input';
import { StyledDateInput, StyledSelect } from '@/components/ui/styled-select';
import {
  AlertCircle,
  Bell,
  Image as ImageIcon,
  Loader2,
  Mail,
  Palette,
  Save,
  Shield,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { fetchWithRetry } from '@/lib/fetch-with-retry';

type SettingsTab = 'general' | 'notifications' | 'branding';

export default function SettingsPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [error, setError] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const logoInputRef = useRef<HTMLInputElement>(null);

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
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.success) {
          setError('Failed to load settings');
          return;
        }

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
      const response = await fetch('/api/settings', {
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
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save');
      toast({
        title: 'Settings saved',
        description: 'Tenant settings and notification preferences have been updated.',
        variant: 'success',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save settings';
      setError(message);
      toast({ title: 'Failed to save', description: message, variant: 'error' });
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

  const tabs = [
    { value: 'general' as const, label: 'General', icon: Shield },
    { value: 'notifications' as const, label: 'Notifications', icon: Bell },
    { value: 'branding' as const, label: 'Branding', icon: Palette },
  ];

  if (isLoading) {
    return (
      <div className="text-ink-500 flex items-center justify-center gap-2 py-16 text-sm" role="status">
        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Loading tenant settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Settings' }]} />
      <PageHeader title="Tenant Settings" description="Manage organisation details, notifications and tenant branding">
        <Button variant="primary" size="sm" onClick={() => void handleSave()} loading={isSaving} disabled={isSaving}>
          <Save className="h-4 w-4" aria-hidden="true" /> Save Changes
        </Button>
      </PageHeader>

      {error && (
        <div className="border-status-error-border bg-status-error-bg rounded-[8px] border px-4 py-3" role="alert">
          <p className="text-status-error-text flex items-center gap-2 text-sm font-medium">
            <AlertCircle className="h-4 w-4" aria-hidden="true" /> {error}
          </p>
        </div>
      )}

      <div className="border-border overflow-x-auto border-b" role="tablist" aria-label="Tenant settings sections">
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
                className={`focus-ring -mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors motion-reduce:transition-none ${
                  selected
                    ? 'border-brand-700 text-brand-700'
                    : 'border-transparent text-ink-500 hover:text-ink-800'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'general' && (
        <div id="settings-panel-general" role="tabpanel" className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Tenant Information</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Organisation Name" required>
                  <Input aria-label="Organisation Name" value={orgName} onChange={(event) => setOrgName(event.target.value)} />
                </FieldWrapper>
                <FieldWrapper label="Tenant Status">
                  <Input aria-label="Tenant Status" value="Active" disabled className="opacity-60" />
                </FieldWrapper>
                <FieldWrapper label="Contact Email">
                  <Input aria-label="Contact Email" type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} />
                </FieldWrapper>
                <FieldWrapper label="Contact Phone">
                  <Input aria-label="Contact Phone" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} />
                </FieldWrapper>
                <FieldWrapper label="Physical Address" className="sm:col-span-2">
                  <Input aria-label="Physical Address" value={address} onChange={(event) => setAddress(event.target.value)} />
                </FieldWrapper>
                <FieldWrapper label="Timezone">
                  <StyledSelect aria-label="Timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                    <option value="Africa/Windhoek (CAT, UTC+2)">Africa/Windhoek (CAT, UTC+2)</option>
                  </StyledSelect>
                </FieldWrapper>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'notifications' && (
        <div id="settings-panel-notifications" role="tabpanel">
          <Card>
            <CardHeader><CardTitle>Notification Preferences</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <section aria-labelledby="delivery-channels-heading" className="space-y-3">
                <h3 id="delivery-channels-heading" className="text-ink-950 text-sm font-medium">Delivery Channels</h3>
                <div className="grid gap-3 lg:grid-cols-2">
                  <label className="border-border hover:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-[8px] border p-4 transition-colors motion-reduce:transition-none">
                    <Checkbox checked={inAppNotifs} onCheckedChange={(checked) => setInAppNotifs(checked === true)} aria-label="In-app notifications" />
                    <span className="min-w-0"><span className="text-ink-950 flex items-center gap-2 text-sm font-medium"><Bell className="text-brand-700 h-4 w-4" aria-hidden="true" />In-App Notifications</span><span className="text-ink-500 mt-1 block text-xs">Show notifications within the authenticated workspace.</span></span>
                  </label>
                  <label className="border-border hover:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-[8px] border p-4 transition-colors motion-reduce:transition-none">
                    <Checkbox checked={emailNotifs} onCheckedChange={(checked) => setEmailNotifs(checked === true)} aria-label="Email notifications" />
                    <span className="min-w-0"><span className="text-ink-950 flex items-center gap-2 text-sm font-medium"><Mail className="text-brand-700 h-4 w-4" aria-hidden="true" />Email Notifications</span><span className="text-ink-500 mt-1 block text-xs">Send eligible notification deliveries to your email address.</span></span>
                  </label>
                </div>
              </section>

              <section aria-labelledby="quiet-hours-heading" className="border-border space-y-4 border-t pt-5">
                <div><h3 id="quiet-hours-heading" className="text-ink-950 text-sm font-medium">Quiet Hours</h3><p className="text-ink-500 mt-1 text-xs">Set the period when non-emergency deliveries should be deferred.</p></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldWrapper label="Quiet Hours Start">
                    <StyledDateInput type="time" value={quietStart} onChange={(event) => setQuietStart(event.target.value)} />
                  </FieldWrapper>
                  <FieldWrapper label="Quiet Hours End">
                    <StyledDateInput type="time" value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} />
                  </FieldWrapper>
                </div>
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox checked={emergencyBypass} onCheckedChange={(checked) => setEmergencyBypass(checked === true)} aria-label="Emergency notifications bypass quiet hours" />
                  <span className="text-ink-700 text-sm">Emergency notifications bypass quiet hours</span>
                </label>
              </section>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'branding' && (
        <div id="settings-panel-branding" role="tabpanel" className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Tenant Branding</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div data-testid="branding-top-layout" className="grid gap-6 lg:grid-cols-[minmax(240px,0.8fr)_minmax(320px,1.2fr)] lg:items-start">
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
                  <div data-testid="tenant-logo-preview" className="border-border bg-muted/40 mx-auto flex h-44 w-full max-w-[260px] items-center justify-center rounded-[8px] border p-5 lg:mx-0">
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- authenticated tenant logo endpoint may return a signed/streamed image.
                      <img src={logoUrl} alt="Current tenant logo" className="h-full w-full object-contain" />
                    ) : (
                      <div className="text-ink-500 flex flex-col items-center gap-2"><ImageIcon className="h-6 w-6" aria-hidden="true" /><span className="text-center text-xs">PNG, JPEG or WebP · max 3 MB</span></div>
                    )}
                  </div>
                  <div className="mx-auto flex w-full max-w-[260px] flex-wrap gap-2 pt-1 lg:mx-0">
                    <Button type="button" size="sm" variant="secondary" loading={logoBusy} onClick={() => logoInputRef.current?.click()}>{logoUrl ? 'Replace logo' : 'Upload logo'}</Button>
                    {logoUrl && <Button type="button" size="sm" variant="destructive" disabled={logoBusy} onClick={() => void removeLogo()}>Remove logo</Button>}
                  </div>
                </div>

                <div className="min-w-0 space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="primary-colour">Primary Colour</Label>
                    <div className="flex min-w-0 items-center gap-2">
                      <input type="color" aria-label="Choose primary colour" value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value.toUpperCase())} className="border-border bg-surface focus:ring-brand-600 h-10 w-10 shrink-0 cursor-pointer rounded-[8px] border p-1 focus:ring-2 focus:outline-none" />
                      <Input id="primary-colour" aria-label="Primary Colour" value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="accent-colour">Accent Colour</Label>
                    <div className="flex min-w-0 items-center gap-2">
                      <input type="color" aria-label="Choose accent colour" value={accentColor} onChange={(event) => setAccentColor(event.target.value.toUpperCase())} className="border-border bg-surface focus:ring-brand-600 h-10 w-10 shrink-0 cursor-pointer rounded-[8px] border p-1 focus:ring-2 focus:outline-none" />
                      <Input id="accent-colour" aria-label="Accent Colour" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5"><Label htmlFor="document-footer">Document Footer Text</Label><Input id="document-footer" aria-label="Document Footer Text" value={documentFooter} onChange={(event) => setDocumentFooter(event.target.value)} /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="email-sender-name">Email Sender Name</Label><Input id="email-sender-name" aria-label="Email Sender Name" value={senderName} onChange={(event) => setSenderName(event.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="email-sender-address">Email Sender Address</Label><Input id="email-sender-address" aria-label="Email Sender Address" type="email" value={senderEmail} onChange={(event) => setSenderEmail(event.target.value)} /></div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
