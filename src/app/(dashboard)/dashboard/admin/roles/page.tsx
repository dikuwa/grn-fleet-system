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
import {
  Shield,
  ShieldCheck,
  Lock,
  Plus,
  Loader2,
  Save,
  Pencil,
  LayoutGrid,
  Table2,
  Eye,
  Users,
  KeyRound,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ClientFilterReset } from '@/components/ui/client-filter-reset';
import {
  Permissions,
  isPermissionAvailableInWorkspace,
  type PermissionCode,
} from '@/lib/permissions';
import { WorkspaceIds } from '@/lib/workspaces';
import {
  PROTECTED_ROLE_EDIT_PHRASE,
  permissionLabel,
  roleResponsibility,
  summarizeCurrentAccess,
} from '@/lib/role-metadata';
import { cn } from '@/lib/utils';

interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionCodes: string[];
  requiredPermissionCodes?: string[];
  memberCount?: number;
  editable?: boolean;
  nameEditable?: boolean;
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
    const groupCompare = (GROUP_LABELS[a.group] || a.group).localeCompare(
      GROUP_LABELS[b.group] || b.group,
    );
    return groupCompare || a.label.localeCompare(b.label);
  });

/** Human-readable "Current access" chips derived from the persisted permission set. */
function CurrentAccess({ codes, limit = 5 }: { codes: string[]; limit?: number }) {
  const areas = useMemo(() => summarizeCurrentAccess(codes), [codes]);
  if (areas.length === 0) {
    return <span className="text-ink-400 text-xs">No access configured yet</span>;
  }
  const visible = areas.slice(0, limit);
  const remaining = areas.length - visible.length;
  return (
    <span className="text-ink-600 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
      {visible.map((area, index) => (
        <span key={area} className="inline-flex items-center gap-1">
          {index > 0 && <span className="text-ink-300">·</span>}
          {area}
        </span>
      ))}
      {remaining > 0 && <span className="text-ink-400">+{remaining} more</span>}
    </span>
  );
}

function PermissionSelector({
  selected,
  onChange,
  locked = new Set<string>(),
}: {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  locked?: Set<string>;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, PermissionItem[]>();
    for (const item of TENANT_PERMISSION_ITEMS) {
      if (locked.has(item.code)) continue;
      const current = map.get(item.group) ?? [];
      current.push(item);
      map.set(item.group, current);
    }
    return [...map.entries()];
  }, [locked]);

  if (grouped.length === 0) {
    return (
      <p className="text-ink-400 border-border bg-muted/30 rounded-[8px] border p-4 text-center text-xs">
        No configurable permissions remain for this role.
      </p>
    );
  }

  return (
    <div className="max-h-[44dvh] space-y-5 overflow-y-auto pr-1">
      {grouped.map(([group, items]) => (
        <section key={group} className="space-y-2">
          <h3 className="text-ink-400 text-xs font-semibold tracking-wider uppercase">
            {GROUP_LABELS[group] || permissionLabel(group)}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {items.map((item) => {
              const checked = selected.has(item.code);
              const isLocked = locked.has(item.code);
              return (
                <label
                  key={item.code}
                  className={cn(
                    'border-border flex items-start gap-3 rounded-[8px] border p-3',
                    isLocked ? 'bg-muted/30 cursor-default' : 'hover:bg-muted/40 cursor-pointer',
                  )}
                >
                  <Checkbox
                    checked={checked}
                    disabled={isLocked}
                    onCheckedChange={(value) => {
                      const next = new Set(selected);
                      if (value === true) next.add(item.code);
                      else next.delete(item.code);
                      onChange(next);
                    }}
                    aria-label={`${checked ? 'Remove' : 'Grant'} ${item.label}`}
                  />
                  <span className="min-w-0">
                    <span className="text-ink-800 block text-sm font-medium">{item.label}</span>
                    {isLocked ? (
                      <span className="text-ink-400 mt-0.5 flex items-center gap-1 text-[11px] font-medium">
                        <Lock className="h-3 w-3" aria-hidden="true" /> Required by system workflow
                      </span>
                    ) : (
                      <span className="text-ink-400 mt-0.5 block font-mono text-[10px] break-all">
                        {item.code}
                      </span>
                    )}
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

/** System-required permission list — always checked and locked. */
function RequiredPermissionsList({ codes }: { codes: string[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const code of codes) {
      const group = permissionGroup(code);
      const current = map.get(group) ?? [];
      current.push(code);
      map.set(group, current);
    }
    return [...map.entries()];
  }, [codes]);

  if (codes.length === 0) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="text-ink-500 h-4 w-4" aria-hidden="true" />
        <div>
          <p className="text-ink-800 text-sm font-semibold">Required by system workflow</p>
          <p className="text-ink-500 text-xs">
            These capabilities keep the built-in role working across routing, approvals and
            notifications and cannot be removed.
          </p>
        </div>
      </div>
      <div className="max-h-[32dvh] space-y-4 overflow-y-auto pr-1">
        {grouped.map(([group, items]) => (
          <section key={group} className="space-y-2">
            <h3 className="text-ink-400 text-xs font-semibold tracking-wider uppercase">
              {GROUP_LABELS[group] || permissionLabel(group)}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map((code) => (
                <div
                  key={code}
                  className="border-border bg-muted/30 flex items-start gap-3 rounded-[8px] border p-3"
                >
                  <Checkbox checked disabled aria-label={`${permissionLabel(code)} (required)`} />
                  <span className="min-w-0">
                    <span className="text-ink-800 block text-sm font-medium">
                      {permissionLabel(code)}
                    </span>
                    <span className="text-ink-400 mt-0.5 flex items-center gap-1 text-[11px] font-medium">
                      <Lock className="h-3 w-3" aria-hidden="true" /> Required by system workflow
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default function AdminRolesPage() {
  const { toast } = useToast();
  const { confirm: confirmUnlock, dialog: unlockDialog } = useConfirm();
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState<'cards' | 'matrix'>('cards');
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
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

  const roleResponsibilityText = (role: Role) => roleResponsibility(role.name, role.description);

  const visibleRoles = roles.filter((role) => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return true;
    return (
      role.name.toLowerCase().includes(needle) ||
      role.description?.toLowerCase().includes(needle) ||
      roleResponsibilityText(role).toLowerCase().includes(needle)
    );
  });

  /** Read-only details first. Editing is only reached through an explicit action. */
  const openDetails = (role: Role) => {
    setSelectedRole(role);
  };

  const closeDetails = () => setSelectedRole(null);

  const openEditorFor = (role: Role) => {
    setEditRole(role);
    setEditName(role.name);
    setEditDescription(role.description || '');
    // Required system permissions are always included so the saved set can never
    // drop a workflow-critical grant.
    setEditPermissions(new Set([...role.permissionCodes, ...(role.requiredPermissionCodes ?? [])]));
  };

  /** Custom roles edit directly; built-in roles require the typed EDIT ROLE guard. */
  const beginEdit = (role: Role) => {
    if (role.isSystem) {
      confirmUnlock({
        title: 'Edit protected system role?',
        description:
          'This role is used by GovFleet system workflows. You may adjust configurable permissions, but the role\u2019s system identity and required workflow permissions cannot be changed.',
        confirmLabel: 'Continue',
        requireTypedConfirm: PROTECTED_ROLE_EDIT_PHRASE,
        onConfirm: () => openEditorFor(role),
      });
    } else {
      openEditorFor(role);
    }
  };

  const closeEditor = () => {
    setEditRole(null);
    setEditName('');
    setEditDescription('');
    setEditPermissions(new Set());
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
      toast({
        title: editRole.isSystem ? 'Protected role updated' : 'Role updated',
        description: editRole.isSystem
          ? 'Configurable permissions and description saved. System identity and required permissions were preserved.'
          : editName.trim(),
        variant: 'success',
      });
      closeEditor();
      setSelectedRole(null);
      await refetch();
    } catch (err) {
      toast({
        title: 'Failed to update role',
        description: err instanceof Error ? err.message : 'Update failed',
        variant: 'error',
      });
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
      toast({
        title: 'Failed to create role',
        description: err instanceof Error ? err.message : 'Create failed',
        variant: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const requiredSet = useMemo(() => new Set(editRole?.requiredPermissionCodes ?? []), [editRole]);

  const selectedGroupedPermissions = useMemo(() => {
    if (!selectedRole) return [];
    const map = new Map<string, string[]>();
    for (const code of selectedRole.permissionCodes) {
      const group = permissionGroup(code);
      const current = map.get(group) ?? [];
      current.push(code);
      map.set(group, current);
    }
    return [...map.entries()].sort((a, b) =>
      (GROUP_LABELS[a[0]] || a[0]).localeCompare(GROUP_LABELS[b[0]] || b[0]),
    );
  }, [selectedRole]);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Administration' },
          { label: 'Roles & Permissions' },
        ]}
      />
      <PageHeader
        title="Roles & Permissions"
        description={`${roles.length} tenant role${roles.length === 1 ? '' : 's'} configured. Built-in roles are protected: their system identity and required workflow permissions stay fixed.`}
      >
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Create custom role
        </Button>
      </PageHeader>

      <div className="border-border flex flex-col gap-3 border-y py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search roles, responsibilities…"
            aria-label="Search roles"
            className="max-w-sm"
          />
          <ClientFilterReset isFiltered={Boolean(searchQuery)} onClear={() => setSearchQuery('')} />
        </div>
        <div className="border-border flex gap-1 rounded-[8px] border p-1" aria-label="Role view">
          <Button
            variant={view === 'cards' ? 'primary' : 'ghost'}
            size="compact"
            onClick={() => setView('cards')}
            aria-pressed={view === 'cards'}
          >
            <LayoutGrid className="h-4 w-4" aria-hidden="true" /> Cards
          </Button>
          <Button
            variant={view === 'matrix' ? 'primary' : 'ghost'}
            size="compact"
            onClick={() => setView('matrix')}
            aria-pressed={view === 'matrix'}
          >
            <Table2 className="h-4 w-4" aria-hidden="true" /> Matrix
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div
          className="text-ink-500 flex items-center justify-center gap-2 py-16 text-sm"
          role="status"
        >
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{' '}
          Loading roles…
        </div>
      ) : error ? (
        <EmptyState
          icon={<Shield className="h-6 w-6" />}
          title="Unable to load roles"
          description={error instanceof Error ? error.message : 'Role data could not be loaded.'}
          action={{ label: 'Retry', onClick: () => void refetch() }}
        />
      ) : visibleRoles.length === 0 ? (
        <EmptyState
          icon={<Shield className="h-6 w-6" />}
          title="No roles found"
          description={
            searchQuery
              ? 'No matching roles. Clear the search to view all roles.'
              : 'Create a custom tenant role when a responsibility does not fit a built-in role.'
          }
        />
      ) : view === 'cards' ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleRoles.map((role) => (
            <article
              key={role.id}
              className="group focus-within:ring-brand-600/35 border-border bg-surface hover:border-ink-300 cursor-pointer rounded-[10px] border p-4 transition-[border-color,box-shadow] focus-within:ring-2 hover:shadow-sm focus:outline-none"
              onClick={() => openDetails(role)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openDetails(role);
                }
              }}
              tabIndex={0}
              aria-label={`View details for ${role.name}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {role.isSystem && (
                      <ShieldCheck className="text-ink-400 h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                    <h2 className="text-ink-950 text-sm font-semibold">{role.name}</h2>
                    <Badge variant={role.isSystem ? 'info' : 'default'} size="sm">
                      {role.isSystem ? 'System' : 'Custom'}
                    </Badge>
                    {role.isSystem && (
                      <Badge variant="warning" size="sm">
                        <Lock className="h-3 w-3" aria-hidden="true" /> Protected
                      </Badge>
                    )}
                  </div>
                  <p className="text-ink-500 mt-1 line-clamp-2 text-xs leading-relaxed">
                    {roleResponsibilityText(role)}
                  </p>
                  <div className="text-ink-400 mt-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase">
                    <KeyRound className="h-3 w-3" aria-hidden="true" /> Current access
                  </div>
                  <div className="mt-1">
                    <CurrentAccess codes={role.permissionCodes} />
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="compact"
                  className="group-focus-within:bg-muted shrink-0"
                  onClick={(event) => {
                    event.stopPropagation();
                    openDetails(role);
                  }}
                  aria-label={`View ${role.name} details`}
                >
                  <Eye className="h-4 w-4" />
                </Button>
              </div>
              <div className="border-border mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-xs">
                <div>
                  <p className="text-ink-400">Active members</p>
                  <p className="text-ink-800 mt-1 font-semibold tabular-nums">
                    {role.memberCount ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-ink-400">Permissions</p>
                  <p className="text-ink-800 mt-1 font-semibold tabular-nums">
                    {role.permissionCodes.length}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="border-border bg-surface overflow-x-auto rounded-[10px] border">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-border bg-muted/40 border-b">
                <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium">Role</th>
                <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium">Type</th>
                <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium">
                  Current access
                </th>
                <th className="text-ink-500 px-4 py-3 text-right text-xs font-medium">
                  Active members
                </th>
                <th className="text-ink-500 px-4 py-3 text-right text-xs font-medium">
                  Permissions
                </th>
                <th className="text-ink-500 px-4 py-3 text-right text-xs font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {visibleRoles.map((role) => (
                <tr key={role.id}>
                  <td className="px-4 py-3">
                    <p className="text-ink-900 font-medium">{role.name}</p>
                    <p className="text-ink-400 mt-0.5 max-w-xl text-xs">
                      {roleResponsibilityText(role)}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={role.isSystem ? 'info' : 'default'} size="sm">
                        {role.isSystem ? 'System' : 'Custom'}
                      </Badge>
                      {role.isSystem && (
                        <Badge variant="warning" size="sm">
                          Protected
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="max-w-56 px-4 py-3">
                    <CurrentAccess codes={role.permissionCodes} limit={3} />
                  </td>
                  <td className="text-ink-600 px-4 py-3 text-right tabular-nums">
                    {role.memberCount ?? 0}
                  </td>
                  <td className="text-ink-600 px-4 py-3 text-right tabular-nums">
                    {role.permissionCodes.length}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="secondary" size="compact" onClick={() => openDetails(role)}>
                      <Eye className="h-3.5 w-3.5" /> View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Read-only role details ─────────────────────────────────────────── */}
      <Dialog open={Boolean(selectedRole)} onOpenChange={(open) => !open && closeDetails()}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          {selectedRole && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="flex items-center gap-2">
                    {selectedRole.isSystem && (
                      <ShieldCheck className="text-ink-500 h-5 w-5" aria-hidden="true" />
                    )}
                    {selectedRole.name}
                  </DialogTitle>
                  <Badge variant={selectedRole.isSystem ? 'info' : 'default'} size="sm">
                    {selectedRole.isSystem ? 'System' : 'Custom'}
                  </Badge>
                  {selectedRole.isSystem && (
                    <Badge variant="warning" size="sm">
                      <Lock className="h-3 w-3" aria-hidden="true" /> Protected
                    </Badge>
                  )}
                </div>
                <DialogDescription>
                  {selectedRole.isSystem
                    ? 'Built-in role used by application workflows. Its system identity and required permissions are protected.'
                    : 'Custom tenant role.'}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5">
                <div className="border-border bg-muted/30 rounded-[8px] border p-4">
                  <p className="text-ink-400 text-[11px] font-semibold tracking-wider uppercase">
                    Responsibility
                  </p>
                  <p className="text-ink-800 mt-1 text-sm leading-relaxed">
                    {roleResponsibilityText(selectedRole)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="border-border rounded-[8px] border p-3">
                    <p className="text-ink-400 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider uppercase">
                      <Users className="h-3.5 w-3.5" aria-hidden="true" /> Active members
                    </p>
                    <p className="text-ink-900 mt-1 text-xl font-semibold tabular-nums">
                      {selectedRole.memberCount ?? 0}
                    </p>
                  </div>
                  <div className="border-border rounded-[8px] border p-3">
                    <p className="text-ink-400 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider uppercase">
                      <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Permissions
                    </p>
                    <p className="text-ink-900 mt-1 text-xl font-semibold tabular-nums">
                      {selectedRole.permissionCodes.length}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-ink-400 text-[11px] font-semibold tracking-wider uppercase">
                    Current access
                  </p>
                  <p className="text-ink-700 mt-1 text-sm">
                    Derived from the permissions currently granted to this role.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {summarizeCurrentAccess(selectedRole.permissionCodes).map((area) => (
                      <Badge key={area} variant="secondary" size="sm">
                        {area}
                      </Badge>
                    ))}
                    {selectedRole.permissionCodes.length === 0 && (
                      <span className="text-ink-400 text-xs">No access configured</span>
                    )}
                  </div>
                </div>

                <div className="border-border border-t pt-4">
                  <p className="text-ink-800 text-sm font-semibold">Permissions</p>
                  {selectedRole.isSystem &&
                    (selectedRole.requiredPermissionCodes?.length ?? 0) > 0 && (
                      <p className="text-ink-500 mt-0.5 text-xs">
                        {selectedRole.requiredPermissionCodes?.length ?? 0} are required by the
                        system workflow and cannot be removed.
                      </p>
                    )}
                  {selectedGroupedPermissions.length === 0 ? (
                    <p className="text-ink-400 mt-2 text-xs">No permissions configured.</p>
                  ) : (
                    <div className="mt-3 space-y-4">
                      {selectedGroupedPermissions.map(([group, codes]) => (
                        <section key={group} className="space-y-1.5">
                          <h3 className="text-ink-400 text-xs font-semibold tracking-wider uppercase">
                            {GROUP_LABELS[group] || permissionLabel(group)}
                          </h3>
                          <ul className="space-y-1">
                            {codes.map((code) => (
                              <li key={code} className="flex items-start gap-2 text-sm">
                                {selectedRole.isSystem &&
                                selectedRole.requiredPermissionCodes?.includes(code) ? (
                                  <Lock
                                    className="text-ink-400 mt-0.5 h-3.5 w-3.5 shrink-0"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <span className="text-ink-300 mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current" />
                                )}
                                <span className="text-ink-700 min-w-0 flex-1">
                                  {permissionLabel(code)}
                                </span>
                                {selectedRole.isSystem &&
                                selectedRole.requiredPermissionCodes?.includes(code) ? (
                                  <span className="text-ink-400 shrink-0 text-[11px] font-medium">
                                    Required
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter className="mobile-action-bar">
                <Button variant="secondary" onClick={closeDetails}>
                  Close
                </Button>
                <Button
                  variant={selectedRole.isSystem ? 'primary' : 'secondary'}
                  onClick={() => {
                    beginEdit(selectedRole);
                    closeDetails();
                  }}
                >
                  {selectedRole.isSystem ? (
                    <>
                      <Pencil className="h-4 w-4" aria-hidden="true" /> Edit protected role
                    </>
                  ) : (
                    <>
                      <Pencil className="h-4 w-4" aria-hidden="true" /> Edit role
                    </>
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Create custom role ─────────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Create custom role</DialogTitle>
            <DialogDescription>
              Choose only the tenant capabilities needed for this responsibility. Platform-level
              capabilities are never available here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label required>Role name</Label>
                <Input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="e.g. Programme Reviewer"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Purpose / responsibility</Label>
                <Input
                  value={newDescription}
                  onChange={(event) => setNewDescription(event.target.value)}
                  placeholder="Briefly describe what users assigned to this role are responsible for"
                />
                <p className="text-ink-400 text-xs">
                  This description appears on the role card. Current access is generated
                  automatically from the permissions you choose.
                </p>
              </div>
            </div>
            <PermissionSelector selected={newPermissions} onChange={setNewPermissions} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={() => void createRole()} loading={isSaving} disabled={!newName.trim()}>
              <Plus className="h-4 w-4" /> Create role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit role (custom: direct · system: after EDIT ROLE unlock) ────── */}
      <Dialog
        open={Boolean(editRole)}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editRole?.isSystem ? 'Edit protected system role' : 'Edit role'}
            </DialogTitle>
            <DialogDescription>
              {editRole?.isSystem
                ? 'System identity and required workflow permissions stay locked. You can adjust the description and configurable permissions.'
                : 'Changes apply to every active member who holds this role.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label required>Role name</Label>
                <Input
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  disabled={editRole?.isSystem}
                />
                {editRole?.isSystem && (
                  <p className="text-ink-500 text-xs">
                    Built-in names are fixed because application routing depends on them.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>{editRole?.isSystem ? 'Description' : 'Purpose / responsibility'}</Label>
                <Input
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  placeholder={
                    editRole?.isSystem
                      ? undefined
                      : 'Briefly describe what users assigned to this role are responsible for'
                  }
                />
              </div>
            </div>

            {editRole?.isSystem && (
              <RequiredPermissionsList codes={requiredSet.size ? [...requiredSet] : []} />
            )}

            <div>
              <p className="text-ink-800 text-sm font-semibold">Configurable permissions</p>
              <p className="text-ink-500 mt-0.5 text-xs">
                {editRole?.isSystem
                  ? 'Add or remove tenant capabilities beyond the locked system requirements.'
                  : 'Choose the tenant capabilities needed for this responsibility.'}
              </p>
              <div className="mt-3">
                <PermissionSelector
                  selected={editPermissions}
                  onChange={setEditPermissions}
                  locked={requiredSet}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={closeEditor} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={() => void saveRole()} loading={isSaving} disabled={!editName.trim()}>
              <Save className="h-4 w-4" /> Save role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {unlockDialog}
    </div>
  );
}
