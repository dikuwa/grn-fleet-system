'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StyledSelect } from '@/components/ui/styled-select';
import { Input, Label, Textarea } from '@/components/ui/input';
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
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import {
  emergencyContactRoleLabel,
  EMERGENCY_CONTACT_ROLES,
} from '@/lib/incidents/emergency-contacts';
import type { EmergencyContactRole } from '@/lib/incidents/emergency-contacts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  ...EMERGENCY_CONTACT_ROLES.map((r) => ({ value: r, label: emergencyContactRoleLabel(r as EmergencyContactRole) })),
];

const EMPTY_FORM: {
  name: string;
  phone: string;
  role: string;
  region: string;
  sortOrder: string;
} = { name: '', phone: '', role: 'internal', region: '', sortOrder: '0' };

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PlatformEmergencyContactsPage() {
  const { toast } = useToast();

  // Tenant selector
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');

  // Contacts
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [roleFilter, setRoleFilter] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  // -----------------------------------------------------------------------
  // Fetch tenants
  // -----------------------------------------------------------------------

  const fetchTenants = useCallback(async () => {
    try {
      const res = await fetch('/api/platform/tenants?limit=100');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setTenants(json.data.tenants);
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to load tenants', variant: 'error' });
    }
  }, [toast]);

  useEffect(() => { fetchTenants(); }, [fetchTenants]);

  // -----------------------------------------------------------------------
  // Fetch contacts
  // -----------------------------------------------------------------------

  const fetchContacts = useCallback(async () => {
    if (!selectedTenantId) { setContacts([]); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ tenantId: selectedTenantId });
      if (roleFilter) params.set('role', roleFilter);
      if (includeInactive) params.set('includeInactive', 'true');
      const res = await fetch(`/api/emergency-contacts?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch');
      setContacts(json.data);
    } catch {
      toast({ title: 'Error', description: 'Failed to load contacts', variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [selectedTenantId, roleFilter, includeInactive, toast]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
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

  const saveContact = async () => {
    if (!selectedTenantId) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/emergency-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          tenantId: selectedTenantId,
          sortOrder: form.sortOrder ? Number(form.sortOrder) : 0,
          region: form.region.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      toast({
        title: editingId ? 'Contact updated' : 'Contact created',
        description: `${form.name} has been saved.`,
        variant: 'success',
      });
      setModalOpen(false);
      fetchContacts();
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Save failed', variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/emergency-contacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error('Toggle failed');
      fetchContacts();
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to toggle status', variant: 'error' });
    }
  };

  const deleteContact = async (id: string, name: string) => {
    if (!window.confirm(`Delete contact "${name}"?`)) return;
    try {
      const res = await fetch(`/api/emergency-contacts/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      toast({ title: 'Deleted', description: `${name} removed`, variant: 'success' });
      fetchContacts();
    } catch {
      toast({ title: 'Error', description: 'Delete failed', variant: 'error' });
    }
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const selectedTenantName = tenants.find((t) => t.id === selectedTenantId)?.name;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Platform', href: '/dashboard/platform' },
        { label: 'Emergency Contacts' },
      ]} />

      <PageHeader
        title="Emergency Contacts"
        description="Manage cached emergency service contacts for incident reporting by region"
      />

      {/* Tenant selector */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <Building2 className="h-4 w-4 text-ink-400" />
            <Label className="text-sm font-medium">Select tenant</Label>
            <StyledSelect
              value={selectedTenantId}
              onChange={(e) => setSelectedTenantId(e.target.value)}
              className="max-w-xs"
            >
              <option value="">Choose a tenant...</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
              ))}
            </StyledSelect>
            <Button variant="secondary" size="compact" onClick={fetchContacts} disabled={!selectedTenantId}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {selectedTenantId && (
        <>
          {/* Filters + Add */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                  <PhoneCall className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                  <div className="pl-9">
                    <Label className="text-sm font-medium">{selectedTenantName} — {contacts.length} contact{contacts.length === 1 ? '' : 's'}</Label>
                  </div>
                </div>
                <StyledSelect
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="w-48"
                >
                  {ROLE_FILTER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </StyledSelect>
                <label className="flex items-center gap-2 text-sm text-ink-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-700"
                    checked={includeInactive}
                    onChange={(e) => setIncludeInactive(e.target.checked)}
                  />
                  Include inactive
                </label>
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4 mr-1" /> Add Contact
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Contacts table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Contacts for {selectedTenantName}</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
                  <span className="ml-2 text-sm text-ink-500">Loading contacts...</span>
                </div>
              ) : contacts.length === 0 ? (
                <div className="text-center py-12">
                  <PhoneCall className="h-12 w-12 text-ink-300 mx-auto mb-3" />
                  <p className="text-sm text-ink-500">No emergency contacts configured for this tenant</p>
                  <Button size="sm" onClick={openCreate} className="mt-3">
                    <Plus className="h-4 w-4 mr-1" /> Add First Contact
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-3 font-medium text-ink-500">Name</th>
                        <th className="text-left py-3 px-3 font-medium text-ink-500">Phone</th>
                        <th className="text-left py-3 px-3 font-medium text-ink-500">Role</th>
                        <th className="text-left py-3 px-3 font-medium text-ink-500">Region</th>
                        <th className="text-left py-3 px-3 font-medium text-ink-500">Status</th>
                        <th className="text-right py-3 px-3 font-medium text-ink-500">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {contacts.map((c) => (
                        <tr key={c.id} className="hover:bg-surface-hover transition-colors">
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2">
                              <Phone className="h-4 w-4 text-ink-400" />
                              <span className="font-medium text-ink-900">{c.name}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3 font-mono text-sm">{c.phone}</td>
                          <td className="py-3 px-3">
                            <Badge variant="info" size="sm">{emergencyContactRoleLabel(c.role as EmergencyContactRole)}</Badge>
                          </td>
                          <td className="py-3 px-3">
                            {c.region ? (
                              <span className="flex items-center gap-1 text-sm"><MapPin className="h-3 w-3 text-ink-400" />{c.region}</span>
                            ) : (
                              <span className="text-ink-400 text-xs italic">All regions</span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <Badge variant={c.isActive ? 'success' : 'default'} size="sm">
                              {c.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </td>
                          <td className="py-3 px-3 text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="compact"
                                title={c.isActive ? 'Deactivate' : 'Activate'}
                                onClick={() => toggleActive(c.id, !c.isActive)}
                              >
                                {c.isActive
                                  ? <PowerOff className="h-4 w-4 text-ink-400" />
                                  : <Power className="h-4 w-4 text-status-success-text" />
                                }
                              </Button>
                              <Button variant="ghost" size="compact" title="Edit" onClick={() => openEdit(c)}>
                                <Phone className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="compact"
                                title="Delete"
                                onClick={() => deleteContact(c.id, c.name)}
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
        </>
      )}

      {/* Create / Edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface rounded-[12px] border border-border shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-ink-900">
                {editingId ? 'Edit Contact' : 'New Emergency Contact'}
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-ink-400 hover:text-ink-600">
                &times;
              </button>
            </div>

            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Katutura Hospital"
              />
            </div>

            <div className="space-y-2">
              <Label>Phone number</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+264 61 200 0000"
              />
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <StyledSelect value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {EMERGENCY_CONTACT_ROLES.map((r) => (
                  <option key={r} value={r}>{emergencyContactRoleLabel(r)}</option>
                ))}
              </StyledSelect>
            </div>

            <div className="space-y-2">
              <Label>Region <span className="text-ink-400 text-xs">(leave blank for all regions)</span></Label>
              <Input
                value={form.region}
                onChange={(e) => setForm({ ...form, region: e.target.value })}
                placeholder="e.g. Khomas, Erongo"
              />
            </div>

            <div className="space-y-2">
              <Label>Sort order</Label>
              <Input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                className="w-24"
              />
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <Button variant="secondary" size="compact" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="compact"
                onClick={saveContact}
                disabled={submitting || !form.name.trim() || !form.phone.trim()}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <PhoneCall className="h-4 w-4 mr-1" />}
                {editingId ? 'Update' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
