'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  Archive,
  Building2,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Database,
  Globe2,
  Palette,
  Save,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldWrapper, Input, Label, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { TenantActivityLog } from './TenantActivityLog';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/lib/use-toast';
import { fetchUserProfile, userProfileQueryKey } from '@/lib/user-profile';
import { SystemRoles } from '@/lib/workspaces';

interface TenantDetail {
  id: string;
  name: string;
  code: string;
  slug: string;
  type: string;
  status: string;
  lifecycleStatus: string;
  lifecycleReason: string | null;
  timezone: string;
  locale: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  branding: {
    contactEmail: string | null;
    contactPhone: string | null;
    address: string | null;
    primaryColor: string | null;
    accentColor: string | null;
    documentFooter: string | null;
    senderName: string | null;
  } | null;
  stats: { memberCount: number };
  deletion: {
    canDelete: boolean;
    substantiveRecordCount: number;
    blockers: Record<string, number>;
  };
}

type TabId = 'general' | 'branding' | 'activity';

const tabs: Array<{ id: TabId; label: string; icon: typeof Building2 }> = [
  { id: 'general', label: 'General', icon: Building2 },
  { id: 'branding', label: 'Branding & Contact', icon: Palette },
  { id: 'activity', label: 'Activity Log', icon: Activity },
];

function statusBadge(status: string) {
  const normalised = status.toUpperCase();
  const variant = normalised === 'ACTIVE' ? 'success' : normalised === 'SUSPENDED' ? 'error' : 'default';
  return <Badge variant={variant} size="sm">{normalised.charAt(0) + normalised.slice(1).toLowerCase()}</Badge>;
}

function lifecycleBadge(status: string) {
  const variant = status === 'ACTIVE' ? 'success' : status === 'ONBOARDING_FAILED' ? 'error' : status === 'PENDING_PLATFORM_REVIEW' ? 'warning' : 'info';
  return <Badge variant={variant} size="sm">{status.replace(/_/g, ' ').toLowerCase()}</Badge>;
}

function colourPickerValue(value: string, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export default function PlatformTenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const profileQuery = useQuery({ queryKey: userProfileQueryKey, queryFn: ({ signal }) => fetchUserProfile(signal) });
  const canManage = profileQuery.data?.roles.some((role) => role.roleName === SystemRoles.PLATFORM_ADMIN) === true;
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [saving, setSaving] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [isApproving, setIsApproving] = useState(false);

  const [editName, setEditName] = useState('');
  const [editStatus, setEditStatus] = useState('ACTIVE');
  const [editTimezone, setEditTimezone] = useState('Africa/Windhoek');
  const [editContactEmail, setEditContactEmail] = useState('');
  const [editContactPhone, setEditContactPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editPrimaryColor, setEditPrimaryColor] = useState('#1F4E8C');
  const [editAccentColor, setEditAccentColor] = useState('#0F766E');
  const [editDocumentFooter, setEditDocumentFooter] = useState('');
  const [editSenderName, setEditSenderName] = useState('');

  const tenantQuery = useQuery<TenantDetail>({
    queryKey: ['platform-tenant', id],
    queryFn: async () => {
      const res = await fetch(`/api/platform/tenants/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load tenant');
      return json.data as TenantDetail;
    },
  });

  const tenant = tenantQuery.data;

  useEffect(() => {
    if (!tenant) return;
    const timer = window.setTimeout(() => {
      setEditName(tenant.name);
      setEditStatus(tenant.status.toUpperCase());
      setEditTimezone(tenant.timezone);
      setEditContactEmail(tenant.branding?.contactEmail ?? '');
      setEditContactPhone(tenant.branding?.contactPhone ?? '');
      setEditAddress(tenant.branding?.address ?? '');
      setEditPrimaryColor(tenant.branding?.primaryColor ?? '#1F4E8C');
      setEditAccentColor(tenant.branding?.accentColor ?? '#0F766E');
      setEditDocumentFooter(tenant.branding?.documentFooter ?? '');
      setEditSenderName(tenant.branding?.senderName ?? '');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tenant]);

  const deletionBlockers = useMemo(() => {
    if (!tenant) return [];
    return Object.entries(tenant.deletion.blockers).filter(([, value]) => value > 0);
  }, [tenant]);

  const handleSave = async () => {
    if (!tenant) return;
    setSaving(true);
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
      if (!res.ok) throw new Error(json.error || 'Failed to update tenant');
      toast({ title: 'Tenant updated', description: 'Changes have been saved.', variant: 'success' });
      await tenantQuery.refetch();
    } catch (error) {
      toast({ title: 'Update failed', description: error instanceof Error ? error.message : 'Failed to update tenant', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleLifecycleChange = async (target: string) => {
    if (!tenant) return;
    setIsApproving(true);
    try {
      const res = await fetch(`/api/platform/tenants/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lifecycleStatus: target, lifecycleReason: lifecycleReason.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update lifecycle');
      toast({ title: 'Lifecycle updated', description: `Tenant moved to ${target.replace(/_/g, ' ').toLowerCase()}.`, variant: 'success' });
      setLifecycleReason('');
      setReviewDialogOpen(false);
      await tenantQuery.refetch();
    } catch (error) {
      toast({ title: 'Lifecycle update failed', description: error instanceof Error ? error.message : 'Could not update lifecycle', variant: 'error' });
    } finally {
      setIsApproving(false);
    }
  };

  const toggleSuspension = async () => {
    if (!tenant) return;
    const nextStatus = tenant.status.toUpperCase() === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/tenants/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Status update failed');
      toast({ title: nextStatus === 'ACTIVE' ? 'Tenant activated' : 'Tenant suspended', variant: 'success' });
      setStatusDialogOpen(false);
      await tenantQuery.refetch();
    } catch (error) {
      toast({ title: 'Status update failed', description: error instanceof Error ? error.message : 'Could not update tenant status', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const permanentlyDelete = async () => {
    if (!tenant) return;
    const expected = tenant.deletion.canDelete ? tenant.code : `DELETE ${tenant.code}`;
    if (deleteConfirmation !== expected) return;
    setDeleting(true);
    try {
      const params = new URLSearchParams({ confirm: expected });
      if (!tenant.deletion.canDelete) params.set('force', 'true');
      const res = await fetch(`/api/platform/tenants/${id}?${params}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Tenant deletion failed');
      toast({ title: 'Tenant permanently deleted', description: `${tenant.name} and its tenant-owned data were removed.`, variant: 'success' });
      router.replace('/dashboard/platform/tenants');
      router.refresh();
    } catch (error) {
      toast({ title: 'Tenant was not deleted', description: error instanceof Error ? error.message : 'Protected records prevent deletion.', variant: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  if (tenantQuery.isLoading) {
    return <div className="flex min-h-48 items-center justify-center text-sm text-ink-500" role="status">Loading tenant…</div>;
  }

  if (tenantQuery.error || !tenant) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Platform', href: '/dashboard/platform' }, { label: 'Tenants', href: '/dashboard/platform/tenants' }, { label: 'Tenant' }]} />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Tenant unavailable" description={tenantQuery.error instanceof Error ? tenantQuery.error.message : 'Tenant not found.'} />
        <Button variant="secondary" size="sm" asChild><Link href="/dashboard/platform/tenants"><ChevronLeft className="h-4 w-4" /> Back to tenants</Link></Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Platform', href: '/dashboard/platform' }, { label: 'Tenants', href: '/dashboard/platform/tenants' }, { label: tenant.name }]} />
      <PageHeader title={tenant.name} description={`${tenant.code} · ${tenant.slug}`}>
        {canManage && <div className="flex flex-wrap gap-2">
          {tenant.lifecycleStatus === 'PENDING_PLATFORM_REVIEW' && <Button size="sm" onClick={() => setReviewDialogOpen(true)}><CheckCircle2 className="h-4 w-4" /> Review setup</Button>}
          {tenant.lifecycleStatus === 'READY_FOR_ACTIVATION' && <Button size="sm" onClick={() => void handleLifecycleChange('ACTIVE')} loading={isApproving}><ShieldCheck className="h-4 w-4" /> Activate</Button>}
          <Button variant="secondary" size="sm" onClick={() => setStatusDialogOpen(true)}>
            {tenant.status.toUpperCase() === 'SUSPENDED' ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            {tenant.status.toUpperCase() === 'SUSPENDED' ? 'Activate' : 'Suspend'}
          </Button>
          <Button size="sm" onClick={() => void handleSave()} loading={saving}><Save className="h-4 w-4" /> Save changes</Button>
        </div>}
      </PageHeader>

      {!canManage && <div className="rounded-[8px] border border-brand-200 bg-brand-50/40 px-4 py-3 text-sm text-ink-700 dark:bg-brand-950/20">Read-only platform oversight. Tenant changes require the Platform Super Administrator role.</div>}

      <section className="overflow-hidden rounded-[10px] border border-border bg-border" aria-label="Tenant summary">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-surface px-4 py-4">
            <div className="flex items-center gap-2"><Users className="h-4 w-4 text-brand-700" /><span className="text-xs text-ink-500">Members</span></div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-ink-950">{tenant.stats.memberCount}</p>
          </div>
          <div className="border-t border-border bg-surface px-4 py-4 sm:border-l sm:border-t-0">
            <div className="flex items-center gap-2"><Globe2 className="h-4 w-4 text-brand-700" /><span className="text-xs text-ink-500">Organisation type</span></div>
            <p className="mt-2 text-sm font-semibold capitalize text-ink-950">{tenant.type.replace(/_/g, ' ')}</p>
          </div>
          <div className="border-t border-border bg-surface px-4 py-4 lg:border-l lg:border-t-0">
            <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-brand-700" /><span className="text-xs text-ink-500">Created</span></div>
            <p className="mt-2 text-sm font-semibold text-ink-950">{formatDate(tenant.createdAt)}</p>
          </div>
          <div className="border-t border-border bg-surface px-4 py-4 sm:border-l lg:border-t-0">
            <p className="text-xs text-ink-500">Account & onboarding</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">{statusBadge(tenant.status)}{lifecycleBadge(tenant.lifecycleStatus)}</div>
          </div>
        </div>
      </section>

      <div className="scrollbar-thin flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Tenant sections">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button key={tab.id} type="button" role="tab" aria-selected={active} onClick={() => setActiveTab(tab.id)} className={`focus-ring inline-flex min-h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors ${active ? 'border-brand-700 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800'}`}>
              <Icon className="h-4 w-4" />{tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'general' && (
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>General configuration</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FieldWrapper label="Organisation name" required><Input value={editName} onChange={(event) => setEditName(event.target.value)} disabled={!canManage} /></FieldWrapper>
              <FieldWrapper label="Tenant code"><Input value={tenant.code} disabled /></FieldWrapper>
              <FieldWrapper label="Account status">
                <StyledSelect value={editStatus} onChange={(event) => setEditStatus(event.target.value)} disabled={!canManage}>
                  <option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="TRIAL">Trial</option><option value="ARCHIVED">Archived</option>
                </StyledSelect>
              </FieldWrapper>
              <FieldWrapper label="Timezone"><StyledSelect value={editTimezone} onChange={(event) => setEditTimezone(event.target.value)} disabled={!canManage}><option value="Africa/Windhoek">Africa/Windhoek (UTC+2)</option></StyledSelect></FieldWrapper>
              <FieldWrapper label="Type"><Input value={tenant.type.replace(/_/g, ' ')} disabled className="capitalize" /></FieldWrapper>
              <FieldWrapper label="URL slug"><Input value={tenant.slug} disabled /></FieldWrapper>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Tenant lifecycle</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2">{lifecycleBadge(tenant.lifecycleStatus)}{tenant.lifecycleReason && <span className="text-xs text-ink-500">{tenant.lifecycleReason}</span>}</div>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-500">Lifecycle status tracks onboarding, activation, restriction and archival. Account suspension can be used without deleting historical operational records.</p>
            </CardContent>
          </Card>

          {canManage && <Card className={tenant.deletion.canDelete ? 'border-status-warning-text/30' : ''}>
            <CardHeader><CardTitle>Retention & removal</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {tenant.deletion.canDelete ? (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink-950">This tenant has no protected operational records.</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-500">It can be permanently removed. Configuration records belonging only to this tenant will be removed with it.</p>
                  </div>
                  <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}><Trash2 className="h-4 w-4" /> Delete empty tenant</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-3"><Archive className="mt-0.5 h-5 w-5 text-ink-400" /><div><p className="text-sm font-semibold text-ink-950">This tenant contains records.</p><p className="mt-1 text-xs text-ink-500">Suspend or archive it first. A Platform Administrator can then permanently remove the tenant and all tenant-owned records with an elevated confirmation.</p></div></div>
                  <div className="flex flex-wrap gap-2">{deletionBlockers.map(([label, value]) => <Badge key={label} variant="default" size="sm">{label.replace(/([A-Z])/g, ' $1')}: {value}</Badge>)}</div>
                  <div className="flex flex-wrap gap-2">
                    {tenant.lifecycleStatus !== 'ARCHIVED' && <Button variant="secondary" size="sm" onClick={() => void handleLifecycleChange('ARCHIVED')} loading={isApproving}><Archive className="h-4 w-4" /> Archive tenant</Button>}
                    {(tenant.status.toUpperCase() === 'SUSPENDED' || tenant.status.toUpperCase() === 'ARCHIVED' || tenant.lifecycleStatus === 'ARCHIVED') && <Button variant="ghost" size="sm" className="text-status-error-text" onClick={() => setDeleteDialogOpen(true)}><Trash2 className="h-4 w-4" /> Delete tenant and records</Button>}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>}
        </div>
      )}

      {activeTab === 'branding' && (
        <Card>
          <CardHeader><CardTitle>Tenant branding & contact</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldWrapper label="Contact email"><Input type="email" value={editContactEmail} onChange={(event) => setEditContactEmail(event.target.value)} /></FieldWrapper>
              <FieldWrapper label="Contact phone"><Input value={editContactPhone} onChange={(event) => setEditContactPhone(event.target.value)} /></FieldWrapper>
              <FieldWrapper label="Primary colour">
                <div className="flex items-center gap-2">
                  <input type="color" aria-label="Choose primary colour" value={colourPickerValue(editPrimaryColor, '#1F4E8C')} onChange={(event) => setEditPrimaryColor(event.target.value.toUpperCase())} className="h-10 w-12 cursor-pointer rounded-[7px] border border-border bg-surface p-1" />
                  <Input value={editPrimaryColor} onChange={(event) => setEditPrimaryColor(event.target.value)} placeholder="#1F4E8C" className="font-mono" />
                </div>
              </FieldWrapper>
              <FieldWrapper label="Accent colour">
                <div className="flex items-center gap-2">
                  <input type="color" aria-label="Choose accent colour" value={colourPickerValue(editAccentColor, '#0F766E')} onChange={(event) => setEditAccentColor(event.target.value.toUpperCase())} className="h-10 w-12 cursor-pointer rounded-[7px] border border-border bg-surface p-1" />
                  <Input value={editAccentColor} onChange={(event) => setEditAccentColor(event.target.value)} placeholder="#0F766E" className="font-mono" />
                </div>
              </FieldWrapper>
              <FieldWrapper label="Sender name"><Input value={editSenderName} onChange={(event) => setEditSenderName(event.target.value)} /></FieldWrapper>
              <FieldWrapper label="Physical address"><Input value={editAddress} onChange={(event) => setEditAddress(event.target.value)} /></FieldWrapper>
            </div>
            <div className="space-y-1.5"><Label htmlFor="tenant-document-footer">Document footer</Label><Textarea id="tenant-document-footer" rows={3} value={editDocumentFooter} onChange={(event) => setEditDocumentFooter(event.target.value)} /></div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'activity' && <TenantActivityLog tenantId={tenant.id} />}

      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{tenant.status.toUpperCase() === 'SUSPENDED' ? 'Activate tenant?' : 'Suspend tenant?'}</DialogTitle><DialogDescription>{tenant.status.toUpperCase() === 'SUSPENDED' ? 'Users can regain access according to their existing roles and subscription.' : 'Suspension preserves all tenant data while blocking normal operation.'}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="secondary" onClick={() => setStatusDialogOpen(false)}>Cancel</Button><Button variant={tenant.status.toUpperCase() === 'SUSPENDED' ? 'primary' : 'destructive'} onClick={() => void toggleSuspension()} loading={saving}>{tenant.status.toUpperCase() === 'SUSPENDED' ? 'Activate tenant' : 'Suspend tenant'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Review tenant setup</DialogTitle><DialogDescription>Record a review note and decide whether this tenant is ready for activation.</DialogDescription></DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="lifecycle-review-note">Review note</Label><Textarea id="lifecycle-review-note" rows={4} value={lifecycleReason} onChange={(event) => setLifecycleReason(event.target.value)} /></div>
          <DialogFooter className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => void handleLifecycleChange('ONBOARDING_FAILED')} loading={isApproving}>Return / fail setup</Button><Button onClick={() => void handleLifecycleChange('READY_FOR_ACTIVATION')} loading={isApproving}>Ready for activation</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={(open) => { setDeleteDialogOpen(open); if (!open) setDeleteConfirmation(''); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Permanently delete {tenant.name}?</DialogTitle><DialogDescription>{tenant.deletion.canDelete ? 'The dependency check found no members, staff, vehicles, requests, trips or programmes.' : `This permanently removes the tenant and its ${tenant.deletion.substantiveRecordCount} assessed tenant-owned records.`} This cannot be undone.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-[8px] border border-status-warning-text/30 bg-status-warning-bg/30 p-3 text-xs text-ink-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning-text" />Tenant-only configuration and setup records will also be removed.</div>
            <div className="space-y-1.5"><Label htmlFor="delete-tenant-confirm">Type {tenant.deletion.canDelete ? tenant.code : `DELETE ${tenant.code}`} to confirm</Label><Input id="delete-tenant-confirm" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value.toUpperCase())} autoComplete="off" /></div>
          </div>
          <DialogFooter><Button variant="secondary" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button><Button variant="ghost" className="text-status-error-text" disabled={deleteConfirmation !== (tenant.deletion.canDelete ? tenant.code : `DELETE ${tenant.code}`)} loading={deleting} onClick={() => void permanentlyDelete()}><Trash2 className="h-4 w-4" /> Delete permanently</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
