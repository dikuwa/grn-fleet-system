'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Label } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/lib/use-toast';
import {
  emergencyContactRoleLabel,
  EMERGENCY_CONTACT_ROLES,
  type EmergencyContactRole,
} from '@/lib/incidents/emergency-contact-constants';

interface Tenant {
  id: string;
  name: string;
  code: string;
  lifecycleStatus: string;
}

interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  role: EmergencyContactRole;
  region: string | null;
  isActive: boolean;
  sortOrder: number;
}

interface ContactForm {
  name: string;
  phone: string;
  role: EmergencyContactRole;
  region: string;
  sortOrder: string;
}

const EMPTY_FORM: ContactForm = {
  name: '',
  phone: '',
  role: 'internal',
  region: '',
  sortOrder: '0',
};

export default function PlatformEmergencyContactsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EmergencyContact | null>(null);
  const [form, setForm] = useState<ContactForm>({ ...EMPTY_FORM });

  const tenantsQuery = useQuery<Tenant[]>({
    queryKey: ['platform-emergency-contact-tenants'],
    queryFn: async () => {
      const res = await fetch('/api/platform/tenants?limit=100');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load tenants');
      return (json.data?.tenants ?? []) as Tenant[];
    },
    staleTime: 60_000,
  });

  const tenantId = selectedTenantId || tenantsQuery.data?.[0]?.id || '';

  const contactsQuery = useQuery<EmergencyContact[]>({
    queryKey: ['platform-emergency-contacts', tenantId, roleFilter, includeInactive],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const params = new URLSearchParams({ tenantId });
      if (roleFilter !== 'all') params.set('role', roleFilter);
      if (includeInactive) params.set('includeInactive', 'true');
      const res = await fetch(`/api/emergency-contacts?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load emergency contacts');
      return (json.data ?? []) as EmergencyContact[];
    },
    staleTime: 15_000,
  });

  const selectedTenant = useMemo(
    () => tenantsQuery.data?.find((tenant) => tenant.id === tenantId) ?? null,
    [tenantId, tenantsQuery.data],
  );

  const invalidateContacts = async () => {
    await queryClient.invalidateQueries({ queryKey: ['platform-emergency-contacts'] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error('Select a tenant first');
      if (!form.name.trim() || !form.phone.trim()) throw new Error('Name and phone are required');
      const body = {
        tenantId,
        name: form.name.trim(),
        phone: form.phone.trim(),
        role: form.role,
        region: form.region.trim() || null,
        sortOrder: Number.parseInt(form.sortOrder || '0', 10) || 0,
      };
      const res = await fetch(editing ? `/api/emergency-contacts/${editing.id}` : '/api/emergency-contacts', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save contact');
      return json.data as EmergencyContact;
    },
    onSuccess: async (saved) => {
      toast({ title: editing ? 'Contact updated' : 'Contact created', description: saved.name, variant: 'success' });
      setModalOpen(false);
      setEditing(null);
      setForm({ ...EMPTY_FORM });
      await invalidateContacts();
    },
    onError: (error) => toast({ title: 'Could not save contact', description: error instanceof Error ? error.message : 'Save failed', variant: 'error' }),
  });

  const toggleMutation = useMutation({
    mutationFn: async (contact: EmergencyContact) => {
      const res = await fetch(`/api/emergency-contacts/${contact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, isActive: !contact.isActive }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Status update failed');
      return json.data as EmergencyContact;
    },
    onSuccess: async (contact) => {
      toast({ title: contact.isActive ? 'Contact activated' : 'Contact deactivated', description: contact.name, variant: 'success' });
      await invalidateContacts();
    },
    onError: (error) => toast({ title: 'Could not update contact', description: error instanceof Error ? error.message : 'Status update failed', variant: 'error' }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (contact: EmergencyContact) => {
      const params = new URLSearchParams({ tenantId });
      const res = await fetch(`/api/emergency-contacts/${contact.id}?${params}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      return contact;
    },
    onSuccess: async (contact) => {
      toast({ title: 'Contact deleted', description: contact.name, variant: 'success' });
      await invalidateContacts();
    },
    onError: (error) => toast({ title: 'Could not delete contact', description: error instanceof Error ? error.message : 'Delete failed', variant: 'error' }),
  });

  const defaultsMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error('Select a tenant first');
      const defaults = [
        { name: 'Namibian Police Emergency', phone: '10111', role: 'police', region: null, sortOrder: 10 },
        { name: 'MVA Fund Accident Response', phone: '9682', role: 'insurance', region: null, sortOrder: 20 },
      ];
      for (const contact of defaults) {
        const res = await fetch('/api/emergency-contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, ...contact }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Could not add ${contact.name}`);
      }
    },
    onSuccess: async () => {
      toast({ title: 'National contacts added', description: 'Police 10111 and MVA Fund 9682 are now available to this tenant.', variant: 'success' });
      await invalidateContacts();
    },
    onError: (error) => toast({ title: 'Could not add defaults', description: error instanceof Error ? error.message : 'Default contact setup failed', variant: 'error' }),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
  };

  const openEdit = (contact: EmergencyContact) => {
    setEditing(contact);
    setForm({
      name: contact.name,
      phone: contact.phone,
      role: contact.role,
      region: contact.region ?? '',
      sortOrder: String(contact.sortOrder),
    });
    setModalOpen(true);
  };

  const requestDelete = (contact: EmergencyContact) => {
    confirm({
      title: `Delete ${contact.name}?`,
      description: 'This permanently removes the contact from the selected tenant. Deactivate it instead if it may be needed later.',
      confirmLabel: 'Delete contact',
      variant: 'destructive',
      onConfirm: async () => { await deleteMutation.mutateAsync(contact); },
    });
  };

  const contacts = contactsQuery.data ?? [];
  const tenantError = tenantsQuery.error instanceof Error ? tenantsQuery.error.message : null;
  const contactError = contactsQuery.error instanceof Error ? contactsQuery.error.message : null;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Platform', href: '/dashboard/platform' }, { label: 'Emergency Contacts' }]} />
      <PageHeader title="Emergency Contacts" description="Contacts are tenant-specific and appear in the driver incident workspace for the selected tenant.">
        <div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={() => defaultsMutation.mutate()} loading={defaultsMutation.isPending} disabled={!tenantId}>Add Namibia defaults</Button><Button size="sm" onClick={openCreate} disabled={!tenantId}><Plus className="h-4 w-4" /> Add contact</Button></div>
      </PageHeader>

      <section className="grid gap-3 border-y border-border py-4 sm:grid-cols-2 lg:grid-cols-[minmax(260px,1fr)_220px_auto_auto] lg:items-end" aria-label="Emergency contact filters">
        <div className="space-y-1.5">
          <Label htmlFor="emergency-contact-tenant">Tenant</Label>
          <StyledSelect id="emergency-contact-tenant" value={tenantId} onChange={(event) => setSelectedTenantId(event.target.value)} disabled={tenantsQuery.isLoading || !(tenantsQuery.data?.length)}>
            {tenantsQuery.data?.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name} ({tenant.code})</option>)}
          </StyledSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="emergency-contact-role">Role</Label>
          <StyledSelect id="emergency-contact-role" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="all">All roles</option>
            {EMERGENCY_CONTACT_ROLES.map((role) => <option key={role} value={role}>{emergencyContactRoleLabel(role)}</option>)}
          </StyledSelect>
        </div>
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-ink-600">
          <Checkbox checked={includeInactive} onCheckedChange={(checked) => setIncludeInactive(checked === true)} /> Include inactive
        </label>
        <Button variant="secondary" size="sm" onClick={() => void contactsQuery.refetch()} loading={contactsQuery.isFetching} disabled={!tenantId}><RefreshCw className="h-4 w-4" /> Refresh</Button>
      </section>

      {tenantsQuery.isLoading ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-ink-500" role="status"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> Loading tenants…</div>
      ) : tenantError ? (
        <EmptyState icon={<Building2 className="h-6 w-6" />} title="Could not load tenants" description={tenantError} action={{ label: 'Retry', onClick: () => tenantsQuery.refetch() }} />
      ) : !tenantId ? (
        <EmptyState icon={<Building2 className="h-6 w-6" />} title="No tenant available" description="Create or onboard a tenant before adding emergency contacts." />
      ) : contactsQuery.isLoading ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-ink-500" role="status"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> Loading contacts…</div>
      ) : contactError ? (
        <EmptyState icon={<PhoneCall className="h-6 w-6" />} title="Could not load contacts" description={contactError} action={{ label: 'Retry', onClick: () => contactsQuery.refetch() }} />
      ) : contacts.length === 0 ? (
        <EmptyState icon={<PhoneCall className="h-6 w-6" />} title="No emergency contacts" description={`No contacts match the current filters for ${selectedTenant?.name ?? 'this tenant'}.`} action={{ label: 'Add contact', onClick: openCreate }} />
      ) : (
        <div className="space-y-3">
          <div><h2 className="text-sm font-semibold text-ink-950">{selectedTenant?.name}</h2><p className="text-xs text-ink-500">{contacts.length} contact{contacts.length === 1 ? '' : 's'} in this view</p></div>
          <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
            {contacts.map((contact) => (
              <article key={contact.id} className="grid gap-3 border-b border-border px-4 py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.8fr)_auto] md:items-center sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><Phone className="h-4 w-4 text-ink-400" /><h3 className="text-sm font-semibold text-ink-950">{contact.name}</h3><Badge variant={contact.isActive ? 'success' : 'default'} size="sm">{contact.isActive ? 'Active' : 'Inactive'}</Badge></div>
                  <a href={`tel:${contact.phone.replace(/\s+/g, '')}`} className="mt-1 inline-block text-sm font-medium text-brand-700 hover:underline">{contact.phone}</a>
                </div>
                <div className="space-y-1 text-xs"><Badge variant="info" size="sm">{emergencyContactRoleLabel(contact.role)}</Badge><p className="flex items-center gap-1 text-ink-500"><MapPin className="h-3 w-3" />{contact.region || 'All regions'}</p></div>
                <div className="flex flex-wrap gap-1 md:justify-end">
                  <Button variant="ghost" size="sm" onClick={() => toggleMutation.mutate(contact)} disabled={toggleMutation.isPending}>{contact.isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}{contact.isActive ? 'Deactivate' : 'Activate'}</Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(contact)}><Pencil className="h-4 w-4" /> Edit</Button>
                  <Button variant="ghost" size="sm" className="text-status-error-text" onClick={() => requestDelete(contact)}><Trash2 className="h-4 w-4" /> Delete</Button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={(open) => { if (!saveMutation.isPending) setModalOpen(open); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Edit emergency contact' : 'New emergency contact'}</DialogTitle><DialogDescription>{selectedTenant ? `This contact belongs to ${selectedTenant.name}.` : 'Select a tenant before saving.'}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="contact-name" required>Name</Label><Input id="contact-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="contact-phone" required>Phone</Label><Input id="contact-phone" type="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="contact-role" required>Role</Label><StyledSelect id="contact-role" value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as EmergencyContactRole }))}>{EMERGENCY_CONTACT_ROLES.map((role) => <option key={role} value={role}>{emergencyContactRoleLabel(role)}</option>)}</StyledSelect></div>
            <div className="space-y-1.5"><Label htmlFor="contact-region">Region / coverage</Label><Input id="contact-region" value={form.region} onChange={(event) => setForm((current) => ({ ...current, region: event.target.value }))} placeholder="Leave blank for all regions" /></div>
            <div className="space-y-1.5"><Label htmlFor="contact-sort">Sort order</Label><Input id="contact-sort" inputMode="numeric" value={form.sortOrder} onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))} /></div>
          </div>
          <DialogFooter><Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saveMutation.isPending}>Cancel</Button><Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>{editing ? 'Save changes' : 'Create contact'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
