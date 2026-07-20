'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useSession } from '@/lib/auth-client';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, FieldWrapper } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, Bell, Shield, Mail, Smartphone, Palette, Image as ImageIcon, CheckCircle2, AlertCircle, XCircle, Key, LogOut, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/lib/use-toast';

export default function SettingsPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'general' | 'notifications' | 'security' | 'branding'>('general');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

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

    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.success) {
          const { tenant, branding, notificationPreferences } = data.data;
          setOrgName(tenant.name || '');
          setTimezone(tenant.timezone || 'Africa/Windhoek (CAT, UTC+2)');
          if (branding) {
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
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, [session]);

  const handleSave = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant: { name: orgName, timezone },
          branding: { contactEmail, contactPhone, address, primaryColor, accentColor, documentFooter, senderName, senderEmail },
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
      toast({ title: 'Settings saved', description: 'Your preferences have been updated', variant: 'success' });
    } catch (err) {
      toast({ title: 'Failed to save', description: err instanceof Error ? err.message : 'Failed to save settings', variant: 'error' });
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    }
  }, [orgName, contactEmail, contactPhone, address, timezone, primaryColor, accentColor, documentFooter, senderName, senderEmail, emailNotifs, inAppNotifs, quietStart, quietEnd, emergencyBypass]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
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
      <PageHeader title="Settings" description="Configure application preferences and tenant settings">
        <Button variant="primary" size="sm" onClick={handleSave}>
          <Save className="h-4 w-4" /> Save Changes
        </Button>
      </PageHeader>

      {error && (
        <div className="rounded-[8px] border border-status-error-bg bg-status-error-bg/20 px-4 py-3">
          <p className="text-sm font-medium text-status-error-text flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</p>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.value ? 'bg-brand-800 text-white' : 'bg-muted text-ink-700 hover:bg-border'
            }`}
          >{tab.icon}{tab.label}</button>
        ))}
      </div>

      {activeTab === 'general' && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Tenant Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Organisation Name" required>
                  <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} />
                </FieldWrapper>
                <FieldWrapper label="Tenant Status">
                  <Input value="Active" disabled className="opacity-60" />
                </FieldWrapper>
                <FieldWrapper label="Contact Email">
                  <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
                </FieldWrapper>
                <FieldWrapper label="Contact Phone">
                  <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
                </FieldWrapper>
                <FieldWrapper label="Physical Address" className="sm:col-span-2">
                  <Input value={address} onChange={(e) => setAddress(e.target.value)} />
                </FieldWrapper>
                <FieldWrapper label="Timezone">
                  <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                    <option value="Africa/Windhoek (CAT, UTC+2)">Africa/Windhoek (CAT, UTC+2)</option>
                  </select>
                </FieldWrapper>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'notifications' && (
        <Card>
          <CardHeader><CardTitle>Notification Preferences</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-ink-950">Delivery Channels</h4>
              <div className="space-y-3">
                <label className="flex items-center justify-between rounded-[8px] border border-border p-3 hover:bg-muted/50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-700"><Bell className="h-4 w-4" /></div>
                    <div><p className="text-sm font-medium text-ink-950">In-App Notifications</p><p className="text-xs text-ink-500">Notifications within the dashboard</p></div>
                  </div>
                  <input type="checkbox" checked={inAppNotifs} onChange={(e) => setInAppNotifs(e.target.checked)} className="h-4 w-4 rounded border-border text-brand-800 focus:ring-brand-600" />
                </label>
                <label className="flex items-center justify-between rounded-[8px] border border-border p-3 hover:bg-muted/50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-amber-700"><Mail className="h-4 w-4" /></div>
                    <div><p className="text-sm font-medium text-ink-950">Email Notifications</p><p className="text-xs text-ink-500">Send notifications via email</p></div>
                  </div>
                  <input type="checkbox" checked={emailNotifs} onChange={(e) => setEmailNotifs(e.target.checked)} className="h-4 w-4 rounded border-border text-brand-800 focus:ring-brand-600" />
                </label>
              </div>
            </div>
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-ink-950">Quiet Hours</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Quiet Hours Start"><Input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} /></FieldWrapper>
                <FieldWrapper label="Quiet Hours End"><Input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} /></FieldWrapper>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={emergencyBypass} onChange={(e) => setEmergencyBypass(e.target.checked)} className="h-4 w-4 rounded border-border text-brand-800 focus:ring-brand-600" />
                <span className="text-sm text-ink-700">Emergency notifications bypass quiet hours</span>
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'branding' && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Tenant Branding</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Organisation Logo">
                  <div className="flex h-32 items-center justify-center rounded-[8px] border-2 border-dashed border-border bg-muted">
                    <div className="flex flex-col items-center gap-2 text-ink-500">
                      <ImageIcon className="h-6 w-6" />
                      <span className="text-xs">Upload logo (PNG, SVG)</span>
                    </div>
                  </div>
                </FieldWrapper>
                <div className="space-y-4">
                  <FieldWrapper label="Primary Colour">
                    <div className="flex items-center gap-2">
                      <div className="h-10 w-10 rounded-[8px] border border-border" style={{ backgroundColor: primaryColor }} />
                      <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
                    </div>
                  </FieldWrapper>
                  <FieldWrapper label="Accent Colour">
                    <div className="flex items-center gap-2">
                      <div className="h-10 w-10 rounded-[8px] border border-border" style={{ backgroundColor: accentColor }} />
                      <Input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} />
                    </div>
                  </FieldWrapper>
                </div>
              </div>
              <FieldWrapper label="Document Footer Text"><Input value={documentFooter} onChange={(e) => setDocumentFooter(e.target.value)} /></FieldWrapper>
              <FieldWrapper label="Email Sender Name"><Input value={senderName} onChange={(e) => setSenderName(e.target.value)} /></FieldWrapper>
              <FieldWrapper label="Email Sender Address"><Input type="email" value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} /></FieldWrapper>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
