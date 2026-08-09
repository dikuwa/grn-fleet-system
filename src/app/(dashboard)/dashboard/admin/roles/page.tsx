'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Shield, Plus, Loader2, Save, Pencil, LayoutGrid, Table2, LockKeyhole } from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { ClientFilterReset } from '@/components/ui/client-filter-reset';
import { Permissions, isPermissionAvailableInWorkspace, type PermissionCode } from '@/lib/permissions';
import { WorkspaceIds } from '@/lib/workspaces';

interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionCodes: string[];
  memberCount?: number;
  editable?: boolean;
}

type PermissionItem = { code: PermissionCode; label: string; group: string };

const GROUP_LABELS: Record<string, string> = {
  request: 'Transport Requests',
  programme: 'Programmes',
  staff: 'Staff & Organisation',
  user: 'User Accounts',
  driver: 'Driver Administration',
  incident: 'Incidents',
  tripIncident: 'Trip Incidents',
  emergencyContacts: 'Emergency Contacts',
  delegation: 'Delegations',
  audit: 'Audit',
  report: 'Reports',
  file: 'Files',
  tenant: 'Tenant Administration',
};

function permissionLabel(code: string) {
  const [, action = code] = code.split(':');
  return action
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function permissionGroup(code: string) {
  const prefix = code.split(':')[0];
  if (prefix === 'tripIncident') return 'tripIncident';
  if (prefix === 'emergencyContacts') return 'emergencyContacts';
  return prefix;
}

const TENANT_PERMISSION_ITEMS: PermissionItem[] = (Object.values(Permissions) as PermissionCode[])
  .filter((permission) => isPermissionAvailableInWorkspace(permission, WorkspaceIds.TENANT_ADMIN))
  .map((code) => ({ code, label: permissionLabel(code), group: permissionGroup(code) }))
  .sort((a, b) => {
    const groupCompare = (GROUP_LABELS[a.group] || a.group).localeCompare(GROUP_LABELS[b.group] || b.group);
    return groupCompare || a.label.localeCompare(b.label);
  });

function PermissionSelector({
  selected,
  onChange,
  disabled = false,
}: {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, PermissionItem[]>();
    for (const item of TENANT_PERMISSION_ITEMS) {
      const current = map.get(item.group) ?? [];
      current.push(item);
      map.set(item.group, current);
    }
    return [...map.entries()];
  }, []);

  return (
    <div className="max-h-[48dvh] space-y-5 overflow-y-auto pr-1">
      {grouped.map(([group, items]) => (
        <section key={group} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">{GROUP_LABELS[group] || permissionLabel(group)}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {items.map((item) => {
              const checked = selected.has(item.code);
              return (
                <label key={item.code} className={`flex items-start gap-3 rounded-[8px] border border-border p-3 ${disabled ? 'cursor-default bg-muted/30' : 'cursor-pointer hover:bg-muted/40'}`}>
                  <Checkbox
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(value) => {
                      const next = new Set(selected);
                      if (value === true) next.add(item.code);
                      else next.delete(item.code);
                      onChange(next);
                    }}
                    aria-label={`${checked ? 'Remove' : 'Grant'} ${item.label}`}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink-800">{item.label}</span>
                    <span className="mt-0.5 block break-all font-mono text-[10px] text-ink-400">{item.code}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function AdminRolesPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState<'cards' | 'matrix'>('cards');
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPermissions, setEditPermissions] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPermissions, setNewPermissions] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: async () => {
      const res = await fetch('/api/admin/roles', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load roles');
      return json.data as { roles: Role[] };
    },
  });

  const roles = data?.roles ?? [];
  const visibleRoles = roles.filter((role) => {
    const needle = searchQuery.trim().toLowerCase();
    return !needle || role.name.toLowerCase().includes(needle) || role.description?.toLowerCase().includes(needle);
  });

  const openEdit = (role: Role) => {
    if (role.isSystem) return;
    setEditRole(role);
    setEditName(role.name);
    setEditDescription(role.description || '');
    setEditPermissions(new Set(role.permissionCodes));
  };

  const saveRole = async () => {
    if (!editRole || !editName.trim()) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roleId: editRole.id,
          name: editName.trim(),
          description: editDescription.trim(),
          permissionCodes: [...editPermissions],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update role');
      toast({ title: 'Role updated', description: editName.trim(), variant: 'success' });
      setEditRole(null);
      await refetch();
    } catch (err) {
      toast({ title: 'Failed to update role', description: err instanceof Error ? err.message : 'Update failed', variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const createRole = async () => {
    if (!newName.trim()) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim(),
          permissionCodes: [...newPermissions],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create role');
      toast({ title: 'Custom role created', description: newName.trim(), variant: 'success' });
      setShowCreate(false);
      setNewName('');
      setNewDescription('');
      setNewPermissions(new Set());
      await refetch();
    } catch (err) {
      toast({ title: 'Failed to create role', description: err instanceof Error ? err.message : 'Create failed', variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Administration' },
        { label: 'Roles & Permissions' },
      ]} />
      <PageHeader title="Roles & Permissions" description={`${roles.length} tenant role${roles.length === 1 ? '' : 's'} configured. Built-in GovFleet roles are protected; custom roles are tenant-editable.`}>
        <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Create custom role</Button>
      </PageHeader>

      <section className="rounded-[10px] border border-brand-200 bg-brand-50/40 p-4 dark:border-brand-800/50 dark:bg-brand-950/20">
        <div className="flex items-start gap-3">
          <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-brand-700 dark:text-brand-300" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-ink-950">System roles are protected contracts</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-600">Assign or remove built-in roles from users in User Management. Their permission definitions cannot be edited by a tenant, preventing accidental loss of core workflow access.</p>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-3 border-y border-border py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search roles…" aria-label="Search roles" className="max-w-sm" />
          <ClientFilterReset isFiltered={Boolean(searchQuery)} onClear={() => setSearchQuery('')} />
        </div>
        <div className="flex gap-1 rounded-[8px] border border-border p-1" aria-label="Role view">
          <Button variant={view === 'cards' ? 'primary' : 'ghost'} size="compact" onClick={() => setView('cards')} aria-pressed={view === 'cards'}><LayoutGrid className="h-4 w-4" aria-hidden="true" /> Cards</Button>
          <Button variant={view === 'matrix' ? 'primary' : 'ghost'} size="compact" onClick={() => setView('matrix')} aria-pressed={view === 'matrix'}><Table2 className="h-4 w-4" aria-hidden="true" /> Matrix</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500" role="status"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading roles…</div>
      ) : error ? (
        <EmptyState icon={<Shield className="h-6 w-6" />} title="Unable to load roles" description={error instanceof Error ? error.message : 'Role data could not be loaded.'} action={{ label: 'Retry', onClick: () => void refetch() }} />
      ) : visibleRoles.length === 0 ? (
        <EmptyState icon={<Shield className="h-6 w-6" />} title="No roles found" description={searchQuery ? 'No matching roles. Clear the search to view all roles.' : 'Create a custom tenant role when a responsibility does not fit a built-in role.'} />
      ) : view === 'cards' ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleRoles.map((role) => (
            <article key={role.id} className="rounded-[10px] border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-ink-950">{role.name}</h2>
                    <Badge variant={role.isSystem ? 'info' : 'default'} size="sm">{role.isSystem ? 'System' : 'Custom'}</Badge>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-500">{role.description || (role.isSystem ? 'GovFleet managed role.' : 'Tenant custom role.')}</p>
                </div>
                {role.isSystem ? <LockKeyhole className="h-4 w-4 shrink-0 text-ink-400" aria-label="System role locked" /> : <Button variant="ghost" size="compact" onClick={() => openEdit(role)} aria-label={`Edit ${role.name}`}><Pencil className="h-4 w-4" /></Button>}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
                <div><p className="text-ink-400">Active members</p><p className="mt-1 font-semibold tabular-nums text-ink-800">{role.memberCount ?? 0}</p></div>
                <div><p className="text-ink-400">Permissions</p><p className="mt-1 font-semibold tabular-nums text-ink-800">{role.permissionCodes.length}</p></div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[10px] border border-border bg-surface">
          <table className="min-w-[760px] w-full text-sm">
            <thead><tr className="border-b border-border bg-muted/40"><th className="px-4 py-3 text-left text-xs font-medium text-ink-500">Role</th><th className="px-4 py-3 text-left text-xs font-medium text-ink-500">Type</th><th className="px-4 py-3 text-right text-xs font-medium text-ink-500">Active members</th><th className="px-4 py-3 text-right text-xs font-medium text-ink-500">Permissions</th><th className="px-4 py-3 text-right text-xs font-medium text-ink-500">Action</th></tr></thead>
            <tbody className="divide-y divide-border">
              {visibleRoles.map((role) => (
                <tr key={role.id}>
                  <td className="px-4 py-3"><p className="font-medium text-ink-900">{role.name}</p><p className="mt-0.5 max-w-xl text-xs text-ink-400">{role.description || '—'}</p></td>
                  <td className="px-4 py-3"><Badge variant={role.isSystem ? 'info' : 'default'} size="sm">{role.isSystem ? 'System' : 'Custom'}</Badge></td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-600">{role.memberCount ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-600">{role.permissionCodes.length}</td>
                  <td className="px-4 py-3 text-right">{role.isSystem ? <span className="inline-flex items-center gap-1 text-xs text-ink-400"><LockKeyhole className="h-3.5 w-3.5" /> Locked</span> : <Button variant="secondary" size="compact" onClick={() => openEdit(role)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>Create custom role</DialogTitle><DialogDescription>Choose only the tenant capabilities needed for this responsibility. Platform-level capabilities are never available here.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label required>Role name</Label><Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Programme Reviewer" /></div><div className="space-y-1.5"><Label>Description</Label><Input value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder="What this role is responsible for" /></div></div>
            <PermissionSelector selected={newPermissions} onChange={setNewPermissions} />
          </div>
          <DialogFooter><Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={() => void createRole()} loading={isSaving} disabled={!newName.trim()}><Plus className="h-4 w-4" /> Create role</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editRole)} onOpenChange={(open) => !open && setEditRole(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>Edit custom role</DialogTitle><DialogDescription>Changes apply to every active member who holds this custom role.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label required>Role name</Label><Input value={editName} onChange={(event) => setEditName(event.target.value)} /></div><div className="space-y-1.5"><Label>Description</Label><Input value={editDescription} onChange={(event) => setEditDescription(event.target.value)} /></div></div>
            <PermissionSelector selected={editPermissions} onChange={setEditPermissions} />
          </div>
          <DialogFooter><Button variant="secondary" onClick={() => setEditRole(null)}>Cancel</Button><Button onClick={() => void saveRole()} loading={isSaving} disabled={!editName.trim()}><Save className="h-4 w-4" /> Save role</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
