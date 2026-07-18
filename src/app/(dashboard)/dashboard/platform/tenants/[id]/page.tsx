'use client';

import { useState, use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldWrapper } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Building2, Loader2, ChevronLeft, Save, CheckCircle2, Database,
  Globe, Clock, Users, Palette, Mail, Phone, MapPin, Image as ImageIcon,
} from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';

interface TenantDetail {
  id: string;
  name: string;
  code: string;
  slug: string;
  type: string;
  status: string;
  timezone: string;
  locale: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  branding: {
    id: string;
    primaryColor: string;
    accentColor: string;
    logoUrl: string | null;
    logoDarkUrl: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    address: string | null;
    documentFooter: string | null;
    senderName: string | null;
    senderEmail: string | null;
  } | null;
  stats: {
    memberCount: number;
  };
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function PlatformTenantDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const [activeTab, setActiveTab] = useState<'general' | 'branding'>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Editable fields
  const [editName, setEditName] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editTimezone, setEditTimezone] = useState('');

  // Branding fields
  const [editContactEmail, setEditContactEmail] = useState('');
  const [editContactPhone, setEditContactPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editPrimaryColor, setEditPrimaryColor] = useState('#1F4E8C');
  const [editAccentColor, setEditAccentColor] = useState('#0F766E');
  const [editDocumentFooter, setEditDocumentFooter] = useState('');
  const [editSenderName, setEditSenderName] = useState('');

  const { data: tenant, isLoading, error, refetch } = useQuery({
    queryKey: ['platform-tenant', id],
    queryFn: async () => {
      const res = await fetch(`/api/platform/tenants/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load tenant');
      const data = json.data as TenantDetail;
      // Populate edit fields on load
      setEditName(data.name);
      setEditStatus(data.status);
      setEditTimezone(data.timezone);
      setEditContactEmail(data.branding?.contactEmail || '');
      setEditContactPhone(data.branding?.contactPhone || '');
      setEditAddress(data.branding?.address || '');
      setEditPrimaryColor(data.branding?.primaryColor || '#1F4E8C');
      setEditAccentColor(data.branding?.accentColor || '#0F766E');
      setEditDocumentFooter(data.branding?.documentFooter || '');
      setEditSenderName(data.branding?.senderName || '');
      return data;
    },
  });

  const handleSave = async () => {
    if (!tenant) return;
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const res = await fetch(`/api/platform/tenants/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          status: editStatus,
          timezone: editTimezone,
          contactEmail: editContactEmail,
          contactPhone: editContactPhone,
          address: editAddress,
          primaryColor: editPrimaryColor,
          accentColor: editAccentColor,
          documentFooter: editDocumentFooter,
          senderName: editSenderName,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update');

      refetch();
      setSaveMessage('Tenant updated successfully');
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
      </div>
    );
  }

  if (error || !tenant) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Tenant Management', href: '/dashboard/platform/tenants' },
          { label: 'Tenant' },
        ]} />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title={error instanceof Error ? error.message : 'Tenant not found'}
        />
        <Link href="/dashboard/platform/tenants">
          <Button variant="secondary" size="sm">
            <ChevronLeft className="h-4 w-4" /> Back to Tenants
          </Button>
        </Link>
      </div>
    );
  }

  const tabs = [
    { value: 'general' as const, label: 'General', icon: <Building2 className="h-4 w-4" /> },
    { value: 'branding' as const, label: 'Branding & Contact', icon: <Palette className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Tenant Management', href: '/dashboard/platform/tenants' },
        { label: tenant.name },
      ]} />
      <PageHeader
        title={tenant.name}
        description={`Code: ${tenant.code} · Slug: ${tenant.slug}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-500">
            <Clock className="inline h-3 w-3 mr-1" />
            Created {formatDate(tenant.createdAt)}
          </span>
          {saveMessage && (
            <span className={`flex items-center gap-1 text-xs ${
              saveMessage.includes('successfully') ? 'text-status-success-text' : 'text-status-error-text'
            }`}>
              <CheckCircle2 className="h-3 w-3" />
              {saveMessage}
            </span>
          )}
          <Button variant="primary" size="sm" onClick={handleSave} loading={isSaving}>
            <Save className="h-4 w-4" /> Save Changes
          </Button>
        </div>
      </PageHeader>

      {/* Stats bar */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink-950">{tenant.stats.memberCount}</p>
              <p className="text-xs text-ink-500">Members</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50 text-green-700">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-ink-950 capitalize">{tenant.type.replace(/_/g, ' ')}</p>
              <p className="text-xs text-ink-500">Type</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-ink-950">{tenant.timezone}</p>
              <p className="text-xs text-ink-500">Timezone</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50 text-purple-700">
              <Badge variant={
                tenant.status === 'active' ? 'success' :
                tenant.status === 'suspended' ? 'error' : 'cancelled'
              }>{tenant.status}</Badge>
            </div>
            <div>
              <p className="text-xs text-ink-500">Status</p>
            </div>
          </CardContent>
        </Card>
      </div>

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
        <Card>
          <CardHeader>
            <CardTitle>General Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldWrapper label="Organisation Name" required>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </FieldWrapper>
              <FieldWrapper label="Tenant Code">
                <Input value={tenant.code} disabled className="opacity-60" />
              </FieldWrapper>
              <FieldWrapper label="Status">
                <select
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="inactive">Inactive</option>
                </select>
              </FieldWrapper>
              <FieldWrapper label="Timezone">
                <select
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  value={editTimezone}
                  onChange={(e) => setEditTimezone(e.target.value)}
                >
                  <option value="Africa/Windhoek">Africa/Windhoek (CAT, UTC+2)</option>
                  <option value="Africa/Windhoek">Africa/Windhoek</option>
                </select>
              </FieldWrapper>
              <FieldWrapper label="Type">
                <select
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  value={tenant.type}
                  disabled
                >
                  <option value="regional_council">Regional Council</option>
                  <option value="ministry">Ministry / Department</option>
                  <option value="agency">Government Agency</option>
                  <option value="municipality">Municipality</option>
                </select>
              </FieldWrapper>
              <FieldWrapper label="URL Slug">
                <Input value={tenant.slug} disabled className="opacity-60" />
              </FieldWrapper>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Branding & Contact */}
      {activeTab === 'branding' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Contact Email">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-ink-400" />
                    <Input
                      type="email"
                      value={editContactEmail}
                      onChange={(e) => setEditContactEmail(e.target.value)}
                      placeholder="fleet@organisation.gov.na"
                    />
                  </div>
                </FieldWrapper>
                <FieldWrapper label="Contact Phone">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-ink-400" />
                    <Input
                      value={editContactPhone}
                      onChange={(e) => setEditContactPhone(e.target.value)}
                      placeholder="+264 61 123 4567"
                    />
                  </div>
                </FieldWrapper>
                <FieldWrapper label="Physical Address" className="sm:col-span-2">
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-ink-400 mt-3" />
                    <Input
                      value={editAddress}
                      onChange={(e) => setEditAddress(e.target.value)}
                      placeholder="Private Bag XXXX, City, Region"
                    />
                  </div>
                </FieldWrapper>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Branding & Styling</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Primary Colour">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-10 w-10 rounded-[8px] border border-border shrink-0"
                      style={{ backgroundColor: editPrimaryColor }}
                    />
                    <Input
                      value={editPrimaryColor}
                      onChange={(e) => setEditPrimaryColor(e.target.value)}
                      placeholder="#1F4E8C"
                    />
                  </div>
                </FieldWrapper>
                <FieldWrapper label="Accent Colour">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-10 w-10 rounded-[8px] border border-border shrink-0"
                      style={{ backgroundColor: editAccentColor }}
                    />
                    <Input
                      value={editAccentColor}
                      onChange={(e) => setEditAccentColor(e.target.value)}
                      placeholder="#0F766E"
                    />
                  </div>
                </FieldWrapper>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Logo URL (Light)">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="h-4 w-4 text-ink-400" />
                    <Input value={tenant.branding?.logoUrl || ''} disabled className="opacity-60" placeholder="Upload via file storage" />
                  </div>
                </FieldWrapper>
                <FieldWrapper label="Logo URL (Dark)">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="h-4 w-4 text-ink-400" />
                    <Input value={tenant.branding?.logoDarkUrl || ''} disabled className="opacity-60" placeholder="Upload via file storage" />
                  </div>
                </FieldWrapper>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Document & Email Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Sender Name" className="sm:col-span-2">
                  <Input
                    value={editSenderName}
                    onChange={(e) => setEditSenderName(e.target.value)}
                    placeholder="Organisation Name"
                  />
                </FieldWrapper>
                <FieldWrapper label="Document Footer" className="sm:col-span-2">
                  <Input
                    value={editDocumentFooter}
                    onChange={(e) => setEditDocumentFooter(e.target.value)}
                    placeholder="Organisation Name — Fleet Management Division"
                  />
                </FieldWrapper>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
