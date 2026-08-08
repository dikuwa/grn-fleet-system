'use client';

import { useCallback, useEffect, useState } from 'react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { StyledSelect } from '@/components/ui/styled-select';
import { Input, Label } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { useConfirm } from '@/components/ui/confirm-dialog';
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
import { useToast } from '@/lib/use-toast';
import {
  emergencyContactRoleLabel,
  EMERGENCY_CONTACT_ROLES,
} from '@/lib/incidents/emergency-contact-constants';
import type { EmergencyContactRole } from '@/lib/incidents/emergency-contact-constants';

interface Tenant {
  id: string;
  name: string;
  code: string;
  slug: string;
  lifecycleStatus: string;
  memberCount: number;
}

interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  role: string;
  region: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

const ROLE_FILTER_OPTIONS = [
  { value: '', label: 'All roles' },
  ...EMERGENCY_CONTACT_ROLES.map((role) => ({
    value: role,
    label: emergencyContactRoleLabel(role as EmergencyContactRole),
  })),
];

const EMPTY_FORM = {
  name: '',
  phone: '',
  role: 'internal',
  region: '',
  sortOrder: '0',
};

export default function PlatformEmergencyContactsPage() {
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [loadingTenants, setLoadingTenants] = useState(true);
  const [loading, setLoading] = useState(false);
  const [roleFilter, setRoleFilter] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchTenants = useCallback(async () => {
    setLoadingTenants(true);
    try {
      const res = await fetch('/api/platform/tenants?limit=100');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load tenants');
      const rows = (json.data?.tenants ?? []) as Tenant[];
      setTenants(rows);
      setSelectedTenantId((current) => current || rows[0]?.id || '');
    } catch (err) {
      toast({
        title: 'Could not load tenants',
        description: err instanceof Error ? err.message : 'Failed to load tenants',
        variant: 'error',
      });
    } finally {
      setLoadingTenants(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchTenants();
  }, [fetchTenants]);

  const fetchContacts = useCallback(async () => {
    if (!selectedTenantId) {
      setContacts([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ tenantId: selectedTenantId });
      if (roleFilter) params.set('role', roleFilter);
      if (includeInactive) params.set('includeInactive', 'true');
      const res = await fetch(`/api/emergency-contacts?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch contacts');
      setContacts(json.data ?? []);
    } catch (err) {
      toast({
        title: 'Could not load contacts',
        description: err instanceof Error ? err.message : 'Failed to load contacts',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [selectedTenantId, roleFilter, includeInactive, toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchContacts(), 100);
    return () => window.clearTimeout(timer);
  }, [fetchContacts]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
  };

  const openEdit = (contact: EmergencyContact) => {
    setEditingId(contact.id);
    setForm({
      name: contact.name,
      phone: contact.phone,
      role: contact.role,
      region: contact.region || '',
      sortOrder: String(contact.sortOrder),
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setModalOpen(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
  };

  const saveContact = async () => {
    if (!selectedTenantId || !form.name.trim() || !form.phone.trim()) return;
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        tenantId: selectedTenantId,
        sortOrder: Number.parseInt(form.sortOrder || '0', 10) || 0,
        region: form.region.trim() || null,
      };
      const res = await fetch(
        editingId ? `/api/emergency-contacts/${editingId}` : '/api/emergency-contacts',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save contact');
      toast({
        title: editingId ? 'Contact updated' : 'Contact created',
        description: `${form.name.trim()} has been saved.`,
        variant: 'success',
      });
      closeModal();
      await fetchContacts();
    } catch (err) {
      toast({
        title: 'Could not save contact',
        description: err instanceof Error ? err.message : 'Save failed',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (contact: EmergencyContact) => {
    if (!selectedTenantId || updatingId) return;
    setUpdatingId(contact.id);
    try {
      const res = await fetch(`/api/emergency-contacts/${contact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: selectedTenantId, isActive: !contact.isActive }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Status update failed');
      toast({
        title: contact.isActive ? 'Contact deactivated' : 'Contact activated',
        description: contact.name,
        variant: 'success',
      });
      await fetchContacts();
    } catch (err) {
      toast({
        title: 'Could not update status',
        description: err instanceof Error ? err.message : 'Status update failed',
        variant: 'error',
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const requestDelete = (contact: EmergencyContact) => {
    if (!selectedTenantId) return;
    confirm({
      title: `Delete ${contact.name}?`,
      description: 'This removes the contact from the selected tenant. Use Deactivate instead if the contact may be needed later.',
      confirmLabel: 'Delete Contact',
      variant: 'destructive',
      onConfirm: async () => {
        const params = new URLSearchParams({ tenantId: selectedTenantId });
        const res = await fetch(`/api/emergency-contacts/${contact.id}?${params}`, { method: 'DELETE' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Delete failed');
        toast({ title: 'Contact deleted', description: contact.name, variant: 'success' });
        await fetchContacts();
      },
    });
  };

  const selectedTenantName = tenants.find((tenant) => tenant.id === selectedTenantId)?.name;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Platform', href: '/dashboard/platform' }, { label: 'Emergency Contacts' }]} />
      <PageHeader
        title="Emergency Contacts"
        description="Maintain tenant-specific emergency service contacts used during incident reporting."
      >
        <Button size="sm" onClick={openCreate} disabled={!selectedTenantId}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add Contact
        </Button>
      </PageHeader>

      <div className="border-border grid gap-3 border-y py-4 sm:grid-cols-2 lg:grid-cols-[minmax(260px,1fr)_220px_auto_auto] lg:items-end">
        <div className="space-y-1.5">
          <Label>Select tenant</Label>
          <div className="relative">
            <Building2 className="text-ink-400 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" aria-hidden="true" />
            <StyledSelect
              value={selectedTenantId}
              onChange={(e) => setSelectedTenantId(e.target.value)}
              className="pl-9"
              disabled={loadingTenants}
            >
              <option value="">Choose a tenant...</option>
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>{tenant.name} ({tenant.code})</option>
              ))}
            </StyledSelect>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Role</Label>
          <StyledSelect value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            {ROLE_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </StyledSelect>
        </div>

        <label className="text-ink-600 flex min-h-10 cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={includeInactive} onCheckedChange={(checked) => setIncludeInactive(checked === true)} />
          Include inactive
        </label>

        <Button variant="secondary" size="sm" onClick={() => void fetchContacts()} loading={loading} disabled={!selectedTenantId}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </Button>
      </div>

      {!selectedTenantId ? (
        <EmptyState
          icon={<Building2 className="h-6 w-6" />}
          title={loadingTenants ? 'Loading tenants…' : 'Choose a tenant'}
          description="Select a tenant above to manage its emergency contact directory."
        />
      ) : loading ? (
        <div className="text-ink-500 flex items-center justify-center gap-2 py-14 text-sm">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading contacts…
        </div>
      ) : contacts.length === 0 ? (
        <EmptyState
          icon={<PhoneCall className="h-6 w-6" />}
          title="No emergency contacts found"
          description="Add a contact for this tenant or adjust the current filters."
          action={{ label: 'Add Contact', onClick: openCreate }}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-ink-950 text-sm font-semibold">{selectedTenantName}</h2>
              <p className="text-ink-500 text-xs">{contacts.length} contact{contacts.length === 1 ? '' : 's'} in this view</p>
            </div>
          </div>

          <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
            {contacts.map((contact) => (
              <div key={contact.id} className="border-border grid gap-3 border-b px-4 py-4 last:border-b-0 sm:px-5 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.8fr)_auto] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Phone className="text-ink-400 h-4 w-4" aria-hidden="true" />
                    <h3 className="text-ink-950 text-sm font-semibold">{contact.name}</h3>
                    <Badge variant={contact.isActive ? 'success' : 'default'} size="sm">
                      {contact.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <a href={`tel:${contact.phone.replace(/\s+/g, '')}`} className="text-brand-700 mt-1 inline-block text-sm font-medium hover:underline">
                    {contact.phone}
                  </a>
                </div>

                <div className="space-y-1 text-xs">
                  <Badge variant="info" size="sm">{emergencyContactRoleLabel(contact.role as EmergencyContactRole)}</Badge>
                  <p className="text-ink-500 flex items-center gap-1">
                    <MapPin className="h-3 w-3" aria-hidden="true" /> {contact.region || 'All regions'}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1 md:justify-end">
                  <Button variant="ghost" size="sm" onClick={() => void toggleActive(contact)} disabled={updatingId === contact.id}>
                    {updatingId === contact.id ? (
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    ) : contact.isActive ? (
                      <PowerOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Power className="h-4 w-4" aria-hidden="true" />
                    )}
                    {contact.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(contact)}>
                    <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => requestDelete(contact)} className="text-status-error-text">
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={(open) => !submitting && (open ? setModalOpen(true) : closeModal())}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit emergency contact' : 'New emergency contact'}</DialogTitle>
            <DialogDescription>{selectedTenantName ? `This contact will be available to ${selectedTenantName}.` : 'Select a tenant before saving.'}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label required>Name</Label>
              <Input value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} placeholder="Katutura Hospital" />
            </div>
            <div className="space-y-1.5">
              <Label required>Phone number</Label>
              <Input type="tel" value={form.phone} onChange={(e) => setForm((current) => ({ ...current, phone: e.target.value }))} placeholder="+264 61 200 0000" />
            </div>
            <div className="space-y-1.5">
              <Label required>Role</Label>
              <StyledSelect value={form.role} onChange={(e) => setForm((current) => ({ ...current, role: e.target.value }))}>
                {EMERGENCY_CONTACT_ROLES.map((role) => (
                  <option key={role} value={role}>{emergencyContactRoleLabel(role)}</option>
                ))}
              </StyledSelect>
            </div>
            <div className="space-y-1.5">
              <Label>Region</Label>
              <Input value={form.region} onChange={(e) => setForm((current) => ({ ...current, region: e.target.value }))} placeholder="Blank means all regions" />
            </div>
            <div className="space-y-1.5">
              <Label>Sort order</Label>
              <Input inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm((current) => ({ ...current, sortOrder: e.target.value.replace(/[^0-9-]/g, '') }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={closeModal} disabled={submitting}>Cancel</Button>
            <Button onClick={() => void saveContact()} loading={submitting} disabled={!form.name.trim() || !form.phone.trim()}>
              <PhoneCall className="h-4 w-4" aria-hidden="true" /> {editingId ? 'Save Changes' : 'Create Contact'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
