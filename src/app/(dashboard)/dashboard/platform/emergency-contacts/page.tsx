'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StyledSelect } from '@/components/ui/styled-select';
import { Input, Label } from '@/components/ui/input';
import {
  PhoneCall,
  Plus,
  RefreshCw,
  Loader2,
  Phone,
  Building2,
  Trash2,
  Power,
  PowerOff,
  MapPin,
  Pencil,
  X,
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
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [roleFilter, setRoleFilter] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const fetchTenants = useCallback(async () => {
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
    }
  }, [toast]);

  useEffect(() => {
    fetchTenants();
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
    fetchContacts();
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
        sortOrder: form.sortOrder ? Number(form.sortOrder) : 0,
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

  const toggleActive = async (id: string, isActive: boolean) => {
    if (!selectedTenantId) return;
    try {
      const res = await fetch(`/api/emergency-contacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: selectedTenantId, isActive }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Status update failed');
      await fetchContacts();
    } catch (err) {
      toast({
        title: 'Could not update status',
        description: err instanceof Error ? err.message : 'Status update failed',
        variant: 'error',
      });
    }
  };

  const deleteContact = async (id: string, name: string) => {
    if (!selectedTenantId || !window.confirm(`Delete contact "${name}"?`)) return;
    try {
      const params = new URLSearchParams({ tenantId: selectedTenantId });
      const res = await fetch(`/api/emergency-contacts/${id}?${params}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      toast({ title: 'Contact deleted', description: `${name} removed`, variant: 'success' });
      await fetchContacts();
    } catch (err) {
      toast({
        title: 'Could not delete contact',
        description: err instanceof Error ? err.message : 'Delete failed',
        variant: 'error',
      });
    }
  };

  const selectedTenantName = tenants.find((tenant) => tenant.id === selectedTenantId)?.name;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Platform', href: '/dashboard/platform' },
          { label: 'Emergency Contacts' },
        ]}
      />

      <PageHeader
        title="Emergency Contacts"
        description="Maintain tenant-specific emergency service contacts used during incident reporting."
      >
        <Button size="sm" onClick={openCreate} disabled={!selectedTenantId}>
          <Plus className="h-4 w-4" /> Add Contact
        </Button>
      </PageHeader>

      <div className="grid gap-3 border-y border-border py-4 md:grid-cols-[minmax(0,1fr)_220px_auto_auto] md:items-end">
        <div className="space-y-1.5">
          <Label>Select tenant</Label>
          <div className="relative">
            <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <StyledSelect
              value={selectedTenantId}
              onChange={(e) => setSelectedTenantId(e.target.value)}
              className="pl-9"
            >
              <option value="">Choose a tenant...</option>
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name} ({tenant.code})
                </option>
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

        <label className="flex min-h-10 items-center gap-2 text-sm text-ink-600">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-700"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Include inactive
        </label>

        <Button
          variant="secondary"
          size="sm"
          onClick={fetchContacts}
          disabled={!selectedTenantId || loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {selectedTenantId ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">
                  {selectedTenantName || 'Selected tenant'}
                </CardTitle>
                <p className="mt-1 text-xs text-ink-500">
                  {contacts.length} contact{contacts.length === 1 ? '' : 's'} in the current view
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
                <span className="ml-2 text-sm text-ink-500">Loading contacts...</span>
              </div>
            ) : contacts.length === 0 ? (
              <div className="py-12 text-center">
                <PhoneCall className="mx-auto mb-3 h-10 w-10 text-ink-300" />
                <p className="text-sm font-medium text-ink-800">No emergency contacts found</p>
                <p className="mt-1 text-xs text-ink-500">
                  Add a contact for this tenant or adjust the current filters.
                </p>
                <Button size="sm" onClick={openCreate} className="mt-4">
                  <Plus className="h-4 w-4" /> Add First Contact
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-3 py-3 text-left font-medium text-ink-500">Name</th>
                      <th className="px-3 py-3 text-left font-medium text-ink-500">Phone</th>
                      <th className="px-3 py-3 text-left font-medium text-ink-500">Role</th>
                      <th className="px-3 py-3 text-left font-medium text-ink-500">Region</th>
                      <th className="px-3 py-3 text-left font-medium text-ink-500">Status</th>
                      <th className="px-3 py-3 text-right font-medium text-ink-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {contacts.map((contact) => (
                      <tr key={contact.id} className="transition-colors hover:bg-surface-hover">
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <Phone className="h-4 w-4 text-ink-400" />
                            <span className="font-medium text-ink-900">{contact.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 font-mono text-sm">{contact.phone}</td>
                        <td className="px-3 py-3">
                          <Badge variant="info" size="sm">
                            {emergencyContactRoleLabel(contact.role as EmergencyContactRole)}
                          </Badge>
                        </td>
                        <td className="px-3 py-3">
                          {contact.region ? (
                            <span className="flex items-center gap-1 text-sm">
                              <MapPin className="h-3 w-3 text-ink-400" /> {contact.region}
                            </span>
                          ) : (
                            <span className="text-xs italic text-ink-400">All regions</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant={contact.isActive ? 'success' : 'default'} size="sm">
                            {contact.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="compact"
                              title={contact.isActive ? 'Deactivate' : 'Activate'}
                              onClick={() => toggleActive(contact.id, !contact.isActive)}
                            >
                              {contact.isActive ? (
                                <PowerOff className="h-4 w-4 text-ink-400" />
                              ) : (
                                <Power className="h-4 w-4 text-status-success-text" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="compact"
                              title="Edit"
                              onClick={() => openEdit(contact)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="compact"
                              title="Delete"
                              onClick={() => deleteContact(contact.id, contact.name)}
                              className="text-status-error-text"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-[10px] border border-dashed border-border bg-surface px-6 py-12 text-center">
          <Building2 className="mx-auto h-10 w-10 text-ink-300" />
          <p className="mt-3 text-sm font-medium text-ink-800">Choose a tenant to manage contacts</p>
        </div>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={editingId ? 'Edit emergency contact' : 'Create emergency contact'}
        >
          <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[16px] border border-border bg-surface p-5 shadow-xl sm:rounded-[12px] sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-ink-900">
                  {editingId ? 'Edit Contact' : 'New Emergency Contact'}
                </h3>
                <p className="mt-1 text-xs text-ink-500">{selectedTenantName}</p>
              </div>
              <Button variant="ghost" size="compact" onClick={closeModal} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label required>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Katutura Hospital"
                />
              </div>

              <div className="space-y-1.5">
                <Label required>Phone number</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+264 61 200 0000"
                />
              </div>

              <div className="space-y-1.5">
                <Label required>Role</Label>
                <StyledSelect
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  {EMERGENCY_CONTACT_ROLES.map((role) => (
                    <option key={role} value={role}>{emergencyContactRoleLabel(role)}</option>
                  ))}
                </StyledSelect>
              </div>

              <div className="space-y-1.5">
                <Label>Region <span className="text-xs text-ink-400">(blank = all regions)</span></Label>
                <Input
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                  placeholder="e.g. Khomas, Erongo"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Sort order</Label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                  className="w-28"
                />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-border pt-4">
              <Button variant="secondary" size="sm" onClick={closeModal} disabled={submitting}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={saveContact}
                disabled={submitting || !form.name.trim() || !form.phone.trim()}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                {editingId ? 'Update Contact' : 'Create Contact'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
