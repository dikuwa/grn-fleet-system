'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  Shield, Plus, Loader2, CheckCircle2, XCircle, Save, Pencil,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PermissionGroup {
  group: string;
  label: string;
  permissions: Array<{
    code: string;
    name: string;
    description: string | null;
  }>;
}

interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionCodes: string[];
  memberCount?: number;
}

// ---------------------------------------------------------------------------
// Permission groups (hardcoded from Permissions.ts)
// ---------------------------------------------------------------------------

const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    group: 'requests',
    label: 'Transport Requests',
    permissions: [
      { code: 'request:create', name: 'Create Requests', description: 'Create new transport requests' },
      { code: 'request:view', name: 'View Requests', description: 'View transport requests' },
      { code: 'request:approve-supervisor', name: 'Supervisor Approve', description: 'Approve as immediate supervisor' },
      { code: 'request:review-transport', name: 'Transport Review', description: 'Review requests at transport office' },
      { code: 'request:withdraw', name: 'Withdraw Requests', description: 'Withdraw own requests' },
      { code: 'request:cancel', name: 'Cancel Requests', description: 'Cancel any request' },
    ],
  },
  {
    group: 'allocations',
    label: 'Vehicle Allocation',
    permissions: [
      { code: 'allocation:manage', name: 'Manage Allocations', description: 'Manage vehicle allocations' },
      { code: 'allocation:create', name: 'Create Allocations', description: 'Create new allocations' },
      { code: 'allocation:override', name: 'Override Allocation', description: 'Override vehicle recommendation' },
    ],
  },
  {
    group: 'vehicles',
    label: 'Fleet Management',
    permissions: [
      { code: 'vehicle:manage', name: 'Manage Fleet', description: 'Full fleet management' },
      { code: 'vehicle:view', name: 'View Fleet', description: 'View fleet records' },
      { code: 'vehicle:create', name: 'Add Vehicles', description: 'Add new vehicles' },
      { code: 'vehicle:update', name: 'Update Vehicles', description: 'Edit vehicle details' },
    ],
  },
  {
    group: 'release',
    label: 'Vehicle Release',
    permissions: [
      { code: 'vehicle:release-regional', name: 'Regional Release', description: 'Release vehicles for regional trips' },
      { code: 'vehicle:release-national', name: 'National Release', description: 'Release vehicles for national trips' },
      { code: 'vehicle:release-override', name: 'Release Override', description: 'Override vehicle release restrictions' },
    ],
  },
  {
    group: 'authorisation',
    label: 'Trip Authorisation',
    permissions: [
      { code: 'trip:authorize-regional', name: 'Regional Authorisation', description: 'Authorise regional trips' },
      { code: 'trip:authorize-national', name: 'National Authorisation', description: 'Authorise national trips' },
      { code: 'trip:authorize-emergency', name: 'Emergency Authorisation', description: 'Authorise emergency trips' },
    ],
  },
  {
    group: 'inspections',
    label: 'Inspections',
    permissions: [
      { code: 'inspection:perform', name: 'Perform Inspections', description: 'Conduct vehicle inspections' },
      { code: 'inspection:view', name: 'View Inspections', description: 'View inspection records' },
    ],
  },
  {
    group: 'trips',
    label: 'Trip Management',
    permissions: [
      { code: 'trip:close', name: 'Close Trips', description: 'Close completed trips' },
      { code: 'trip:view', name: 'View Trips', description: 'View trip records' },
      { code: 'trip:manage', name: 'Manage Trips', description: 'Full trip management' },
    ],
  },
  {
    group: 'drivers',
    label: 'Driver Operations',
    permissions: [
      { code: 'driver:log-create', name: 'Create Logs', description: 'Create daily log entries' },
      { code: 'driver:log-view', name: 'View Logs', description: 'View daily log entries' },
      { code: 'driver:fuel-create', name: 'Fuel Entries', description: 'Create fuel entries' },
    ],
  },
  {
    group: 'fuel',
    label: 'Fuel Management',
    permissions: [
      { code: 'fuel:manage', name: 'Manage Fuel', description: 'Full fuel management' },
      { code: 'fuel:verify', name: 'Verify Fuel', description: 'Verify fuel transactions' },
      { code: 'fuel:view', name: 'View Fuel', description: 'View fuel records' },
    ],
  },
  {
    group: 'staff',
    label: 'Staff Management',
    permissions: [
      { code: 'staff:import', name: 'Import Staff', description: 'Import staff from CSV/Excel' },
      { code: 'staff:manage', name: 'Manage Staff', description: 'Full staff management' },
      { code: 'staff:view', name: 'View Staff', description: 'View staff directory' },
    ],
  },
  {
    group: 'audit',
    label: 'Audit',
    permissions: [
      { code: 'audit:read', name: 'Read Audit', description: 'View audit log' },
      { code: 'audit:export', name: 'Export Audit', description: 'Export audit data' },
    ],
  },
  {
    group: 'platform',
    label: 'Platform Administration',
    permissions: [
      { code: 'tenant:manage', name: 'Manage Tenants', description: 'Create and manage tenants' },
      { code: 'tenant:view', name: 'View Tenants', description: 'View tenant information' },
      { code: 'platform:admin', name: 'Platform Admin', description: 'Full platform administration' },
      { code: 'platform:support', name: 'Platform Support', description: 'Platform support access' },
    ],
  },
  {
    group: 'reports',
    label: 'Reports',
    permissions: [
      { code: 'report:view', name: 'View Reports', description: 'View reports and analytics' },
      { code: 'report:export', name: 'Export Reports', description: 'Export report data' },
    ],
  },
  {
    group: 'files',
    label: 'File Storage',
    permissions: [
      { code: 'file:upload', name: 'Upload Files', description: 'Upload files and documents' },
      { code: 'file:view', name: 'View Files', description: 'View uploaded files' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminRolesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');

  // Edit role dialog
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPermissions, setEditPermissions] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Create role dialog
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPermissions, setNewPermissions] = useState<Set<string>>(new Set());
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-roles', searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      const res = await fetch(`/api/admin/roles?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load roles');
      return json.data as { roles: Role[] };
    },
  });

  const roles = data?.roles ?? [];

  const togglePermission = (code: string, set: Set<string>, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(code)) {
      next.delete(code);
    } else {
      next.add(code);
    }
    update(next);
  };

  const openEdit = (role: Role) => {
    setEditRole(role);
    setEditName(role.name);
    setEditDescription(role.description || '');
    setEditPermissions(new Set(role.permissionCodes));
    setSaveError(null);
  };

  const handleSaveRole = async () => {
    if (!editRole || !editName.trim()) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/admin/roles`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roleId: editRole.id,
          name: editName.trim(),
          description: editDescription.trim() || null,
          permissionCodes: Array.from(editPermissions),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update role');
      setEditRole(null);
      toast({ title: 'Role updated', description: `Permissions saved for ${editName}`, variant: 'success' });
      refetch();
    } catch (err) {
      toast({ title: 'Failed to update role', description: err instanceof Error ? err.message : 'Failed to update role', variant: 'error' });
      setSaveError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateRole = async () => {
    if (!newName.trim()) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim() || null,
          permissionCodes: Array.from(newPermissions),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create role');
      setShowCreate(false);
      setNewName('');
      setNewDescription('');
      setNewPermissions(new Set());
      toast({ title: 'Role created', description: newName, variant: 'success' });
      refetch();
    } catch (err) {
      toast({ title: 'Failed to create role', description: err instanceof Error ? err.message : 'Failed to create role', variant: 'error' });
      setCreateError(err instanceof Error ? err.message : 'Failed to create role');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Administration', href: '/dashboard' },
        { label: 'Roles & Permissions' },
      ]} />
      <PageHeader
        title="Roles & Permissions"
        description={`${roles.length} role${roles.length !== 1 ? 's' : ''} configured`}
      >
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button variant="primary" size="sm">
              <Plus className="h-4 w-4" /> Create Role
            </Button>
          </DialogTrigger>
        </Dialog>
      </PageHeader>

      {/* Search */}
      <div className="relative max-w-sm">
        <input
          placeholder="Search roles..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-10 w-full rounded-[8px] border border-border bg-surface pl-3 pr-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
        </div>
      )}

      {/* Error */}
      {error && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-status-error-text">{error instanceof Error ? error.message : 'Failed to load roles'}</p>
            <Button variant="secondary" size="sm" onClick={() => refetch()} className="mt-2">Retry</Button>
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {!isLoading && !error && roles.length === 0 && (
        <EmptyState
          icon={<Shield className="h-6 w-6" />}
          title="No roles found"
          description="Roles define what users can do in the system. Create your first role to get started."
        />
      )}

      {/* Role Cards */}
      {!isLoading && roles.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => (
            <Card
              key={role.id}
              className="cursor-pointer transition-all hover:shadow-md"
              onClick={() => openEdit(role)}
            >
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                      <Shield className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-ink-950">{role.name}</p>
                      {role.isSystem && (
                        <Badge variant="info" size="sm">System</Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    onClick={(e) => { e.stopPropagation(); openEdit(role); }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
                {role.description && (
                  <p className="mt-2 text-xs text-ink-500 line-clamp-2">{role.description}</p>
                )}
                <div className="mt-3 flex items-center gap-2 text-xs text-ink-400">
                  <Shield className="h-3 w-3" />
                  <span>{role.permissionCodes.length} permission{role.permissionCodes.length !== 1 ? 's' : ''}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Role Dialog */}
      <Dialog open={!!editRole} onOpenChange={(open) => { if (!open) setEditRole(null); }}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Role: {editRole?.name}</DialogTitle>
          </DialogHeader>
          {editRole && (
            <div className="space-y-6">
              {/* Role Details */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label required>Role Name</Label>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    disabled={editRole.isSystem}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    disabled={editRole.isSystem}
                    className="min-h-[60px] w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200 resize-y"
                    placeholder="What this role can do..."
                  />
                </div>
              </div>

              {/* Permission Matrix */}
              <div>
                <h3 className="text-sm font-semibold text-ink-950 mb-3">Permissions</h3>
                <div className="space-y-4">
                  {PERMISSION_GROUPS.map((group) => (
                    <div key={group.group} className="rounded-[8px] border border-border overflow-hidden">
                      <div className="bg-muted px-4 py-2">
                        <p className="text-xs font-semibold text-ink-700 uppercase">{group.label}</p>
                      </div>
                      <div className="divide-y divide-border">
                        {group.permissions.map((perm) => (
                          <label
                            key={perm.code}
                            className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={editPermissions.has(perm.code)}
                              onChange={() => togglePermission(perm.code, editPermissions, setEditPermissions)}
                              className="h-4 w-4 rounded border-border text-brand-800 focus:ring-brand-600"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-ink-950">{perm.name}</p>
                              {perm.description && (
                                <p className="text-xs text-ink-500">{perm.description}</p>
                              )}
                            </div>
                            <code className="text-[10px] text-ink-400 font-mono hidden sm:block">{perm.code}</code>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {saveError && (
                <p className="text-xs text-status-error-text">{saveError}</p>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button variant="secondary" size="sm" onClick={() => setEditRole(null)}>Cancel</Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveRole}
                  loading={isSaving}
                  disabled={!editName.trim()}
                >
                  <Save className="h-4 w-4" /> Save Changes
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Role Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Role</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label required>Role Name</Label>
                <Input
                  placeholder="e.g. Fleet Manager"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="min-h-[60px] w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200 resize-y"
                  placeholder="What this role can do..."
                />
              </div>
            </div>

            {/* Permission Matrix */}
            <div>
              <h3 className="text-sm font-semibold text-ink-950 mb-3">Assign Permissions</h3>
              <div className="space-y-4">
                {PERMISSION_GROUPS.map((group) => (
                  <div key={group.group} className="rounded-[8px] border border-border overflow-hidden">
                    <div className="bg-muted px-4 py-2">
                      <p className="text-xs font-semibold text-ink-700 uppercase">{group.label}</p>
                    </div>
                    <div className="divide-y divide-border">
                      {group.permissions.map((perm) => (
                        <label
                          key={perm.code}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={newPermissions.has(perm.code)}
                            onChange={() => togglePermission(perm.code, newPermissions, setNewPermissions)}
                            className="h-4 w-4 rounded border-border text-brand-800 focus:ring-brand-600"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-ink-950">{perm.name}</p>
                            {perm.description && (
                              <p className="text-xs text-ink-500">{perm.description}</p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {createError && (
              <p className="text-xs text-status-error-text">{createError}</p>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="secondary" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleCreateRole}
                loading={isCreating}
                disabled={!newName.trim()}
              >
                <Plus className="h-4 w-4" /> Create Role
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
