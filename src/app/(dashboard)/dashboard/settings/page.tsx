'use client';

import { useState, useCallback } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, FieldWrapper } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Settings,
  Save,
  Bell,
  Shield,
  Mail,
  Smartphone,
  Palette,
  Image as ImageIcon,
  CheckCircle2,
  Eye,
  EyeOff,
  Key,
  LogOut,
} from 'lucide-react';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'general' | 'notifications' | 'security' | 'branding'>('general');
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    // Placeholder — would call API
    console.log('Settings saved');
  }, []);

  const tabs = [
    { value: 'general' as const, label: 'General', icon: <Settings className="h-4 w-4" /> },
    { value: 'notifications' as const, label: 'Notifications', icon: <Bell className="h-4 w-4" /> },
    { value: 'security' as const, label: 'Security', icon: <Shield className="h-4 w-4" /> },
    { value: 'branding' as const, label: 'Branding', icon: <Palette className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Settings' },
      ]} />
      <PageHeader
        title="Settings"
        description="Configure application preferences and tenant settings"
      >
        <Button variant="primary" size="sm" onClick={handleSave}>
          {saved ? (
            <>
              <CheckCircle2 className="h-4 w-4" />
              Saved
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save Changes
            </>
          )}
        </Button>
      </PageHeader>

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

      {/* General Settings */}
      {activeTab === 'general' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Tenant Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Organisation Name" required>
                  <Input defaultValue="Kavango East Regional Council" />
                </FieldWrapper>
                <FieldWrapper label="Tenant Code" required>
                  <Input defaultValue="KAV-EAST" disabled className="opacity-60" />
                </FieldWrapper>
                <FieldWrapper label="Contact Email">
                  <Input type="email" defaultValue="fleet@kavangoeastrc.gov.na" />
                </FieldWrapper>
                <FieldWrapper label="Contact Phone">
                  <Input defaultValue="+264 66 123 4567" />
                </FieldWrapper>
                <FieldWrapper label="Physical Address" className="sm:col-span-2">
                  <Input defaultValue="Private Bag 1234, Rundu, Kavango East, Namibia" />
                </FieldWrapper>
                <FieldWrapper label="Timezone">
                  <select className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                    <option>Africa/Windhoek (CAT, UTC+2)</option>
                    <option>Africa/Windhoek</option>
                  </select>
                </FieldWrapper>
                <FieldWrapper label="Locale">
                  <select className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                    <option>English (Namibia) — en-NA</option>
                    <option>English (Namibia)</option>
                  </select>
                </FieldWrapper>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Regional Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Default Trip Scope">
                  <select className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                    <option>Regional</option>
                    <option>National</option>
                  </select>
                </FieldWrapper>
                <FieldWrapper label="Max Authorised Kilometres (Regional)">
                  <Input type="number" defaultValue="500" />
                </FieldWrapper>
                <FieldWrapper label="Fuel Card Default">
                  <select className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                    <option>Engen Fleet Card</option>
                    <option>Total Energies Card</option>
                    <option>Government Fuel Card</option>
                  </select>
                </FieldWrapper>
                <FieldWrapper label="Odometer Variance Threshold (km)">
                  <Input type="number" defaultValue="50" />
                </FieldWrapper>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Notification Settings */}
      {activeTab === 'notifications' && (
        <Card>
          <CardHeader>
            <CardTitle>Notification Preferences</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-ink-950">Delivery Channels</h4>
              <div className="space-y-3">
                <label className="flex items-center justify-between rounded-[8px] border border-border p-3 hover:bg-muted/50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-700">
                      <Bell className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-ink-950">In-App Notifications</p>
                      <p className="text-xs text-ink-500">Notifications within the dashboard</p>
                    </div>
                  </div>
                  <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-border text-brand-800 focus:ring-brand-600" />
                </label>

                <label className="flex items-center justify-between rounded-[8px] border border-border p-3 hover:bg-muted/50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-amber-700">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-ink-950">Email Notifications</p>
                      <p className="text-xs text-ink-500">Send notifications via email</p>
                    </div>
                  </div>
                  <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-border text-brand-800 focus:ring-brand-600" />
                </label>

                <label className="flex items-center justify-between rounded-[8px] border border-border p-3 hover:bg-muted/50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-50 text-green-700">
                      <Smartphone className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-ink-950">SMS Notifications</p>
                      <p className="text-xs text-ink-500">Critical alerts via SMS (requires SMS provider)</p>
                    </div>
                  </div>
                  <input type="checkbox" className="h-4 w-4 rounded border-border text-brand-800 focus:ring-brand-600" />
                </label>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-medium text-ink-950">Notification Types</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: 'Action Required', desc: 'Approvals, verifications needed', defaultChecked: true },
                  { label: 'Outcomes', desc: 'Request approved, trip closed', defaultChecked: true },
                  { label: 'Reminders', desc: 'Upcoming deadlines, renewals', defaultChecked: true },
                  { label: 'System Alerts', desc: 'Maintenance, status changes', defaultChecked: true },
                  { label: 'Escalations', desc: 'Overdue items escalated', defaultChecked: true },
                  { label: 'Awareness', desc: 'General informational updates', defaultChecked: false },
                ].map((nt) => (
                  <label key={nt.label} className="flex items-start gap-3 rounded-[8px] border border-border p-3 hover:bg-muted/50 transition-colors cursor-pointer">
                    <input type="checkbox" defaultChecked={nt.defaultChecked} className="mt-0.5 h-4 w-4 rounded border-border text-brand-800 focus:ring-brand-600" />
                    <div>
                      <p className="text-sm font-medium text-ink-950">{nt.label}</p>
                      <p className="text-xs text-ink-500">{nt.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-medium text-ink-950">Quiet Hours</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Quiet Hours Start">
                  <Input type="time" defaultValue="20:00" />
                </FieldWrapper>
                <FieldWrapper label="Quiet Hours End">
                  <Input type="time" defaultValue="07:00" />
                </FieldWrapper>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-border text-brand-800 focus:ring-brand-600" />
                <span className="text-sm text-ink-700">
                  Emergency notifications bypass quiet hours
                </span>
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Security Settings */}
      {activeTab === 'security' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Password & Session</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Current Password">
                  <Input type="password" placeholder="Enter current password" />
                </FieldWrapper>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="New Password">
                  <Input type="password" placeholder="Enter new password" />
                </FieldWrapper>
                <FieldWrapper label="Confirm New Password">
                  <Input type="password" placeholder="Confirm new password" />
                </FieldWrapper>
              </div>
              <div className="flex items-center justify-end">
                <Button variant="primary" size="sm">
                  <Key className="h-4 w-4" />
                  Update Password
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Active Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { device: 'Chrome on macOS', ip: '192.168.1.45', lastActive: 'Now', current: true },
                  { device: 'Safari on iPhone', ip: '192.168.1.67', lastActive: '2 hours ago', current: false },
                ].map((session, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-[8px] border border-border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-ink-500">
                        {session.current ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-ink-950">
                          {session.device}
                          {session.current && (
                            <Badge variant="success" size="sm" className="ml-2">Current</Badge>
                          )}
                        </p>
                        <p className="text-xs text-ink-500">
                          IP: {session.ip} &middot; Last active: {session.lastActive}
                        </p>
                      </div>
                    </div>
                    {!session.current && (
                      <Button variant="tertiary" size="compact">
                        <LogOut className="h-3.5 w-3.5" />
                        Revoke
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit Log Access</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-ink-500 mb-3">
                Audit log access is controlled by system permissions. Contact your Platform Administrator
                to request changes to your access level.
              </p>
              <div className="flex items-center gap-2">
                <Badge variant="info">Audit: Read Only</Badge>
                <Badge variant="default">Export: Disabled</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Branding Settings */}
      {activeTab === 'branding' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Tenant Branding</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Organisation Logo">
                  <div className="flex h-32 items-center justify-center rounded-[8px] border-2 border-dashed border-border bg-muted">
                    <div className="flex flex-col items-center gap-2 text-ink-500">
                      <ImageIcon className="h-6 w-6" aria-hidden="true" />
                      <span className="text-xs">Upload logo (PNG, SVG)</span>
                    </div>
                  </div>
                </FieldWrapper>
                <div className="space-y-4">
                  <FieldWrapper label="Primary Colour">
                    <div className="flex items-center gap-2">
                      <div className="h-10 w-10 rounded-[8px] border border-border" style={{ backgroundColor: '#1F4E8C' }} />
                      <Input defaultValue="#1F4E8C" />
                    </div>
                  </FieldWrapper>
                  <FieldWrapper label="Accent Colour">
                    <div className="flex items-center gap-2">
                      <div className="h-10 w-10 rounded-[8px] border border-border" style={{ backgroundColor: '#0F766E' }} />
                      <Input defaultValue="#0F766E" />
                    </div>
                  </FieldWrapper>
                </div>
              </div>

              <div className="space-y-3">
                <FieldWrapper label="Document Footer Text">
                  <Input defaultValue="Kavango East Regional Council — Fleet Management Division" />
                </FieldWrapper>
                <FieldWrapper label="Email Sender Name">
                  <Input defaultValue="GovFleet Namibia" />
                </FieldWrapper>
                <FieldWrapper label="Email Sender Address">
                  <Input type="email" defaultValue="noreply@govfleet.gov.na" />
                </FieldWrapper>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
