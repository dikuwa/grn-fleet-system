'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Plus, RefreshCw, Shield, UserCog, UserMinus, UserRoundCheck } from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Label } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/lib/use-toast';
import { SystemRoles } from '@/lib/workspaces';

type PlatformUser = {
  id: string;
  name: string | null;
  email: string;
  username: string | null;
  status: string;
  roleName: string | null;
  isCurrentUser: boolean;
};

type CreatedCredentials = {
  name: string;
  email: string;
  username: string;
  roleName: string;
  temporaryPassword: string;
};

const ROLE_OPTIONS = [
  { value: SystemRoles.PLATFORM_ADMIN, label: 'Platform Super Administrator', description: 'Full platform administration and tenant operations.' },
  { value: SystemRoles.PLATFORM_SUPPORT, label: 'Platform Support Administrator', description: 'Demo, tenant visibility and support operations.' },
  { value: SystemRoles.PLATFORM_AUDITOR, label: 'Platform Auditor', description: 'Read-only tenant visibility and platform audit/export.' },
];

export default function PlatformUsersPage() {
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PlatformUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleName, setRoleName] = useState(SystemRoles.PLATFORM_SUPPORT);
  const [created, setCreated] = useState<CreatedCredentials | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/platform/users', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load platform users');
      setUsers(json.data?.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load platform users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const resetCreate = () => {
    setName('');
    setEmail('');
    setRoleName(SystemRoles.PLATFORM_SUPPORT);
  };

  const createUser = async () => {
    if (!name.trim() || !email.trim()) {
      toast({ title: 'Name and email are required', variant: 'error' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/platform/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), roleName }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not create platform user');
      setCreated(json.data);
      setCreateOpen(false);
      resetCreate();
      toast({ title: 'Platform user created', description: `${json.data.name} can now access the platform workspace.`, variant: 'success' });
      await load();
    } catch (err) {
      toast({ title: 'Could not create platform user', description: err instanceof Error ? err.message : 'Create failed', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const saveUser = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch('/api/platform/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: editing.id, roleName: editing.roleName, status: editing.status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not update platform user');
      toast({ title: 'Platform user updated', variant: 'success' });
      setEditing(null);
      await load();
    } catch (err) {
      toast({ title: 'Update failed', description: err instanceof Error ? err.message : 'Could not update platform user', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const removeUser = (platformUser: PlatformUser) => {
    confirm({
      title: `Remove platform access for ${platformUser.name || platformUser.email}?`,
      description: 'The account is retained for audit safety, but its platform membership and role access are removed. The final Platform Super Administrator can never be removed.',
      confirmLabel: 'Remove access',
      variant: 'destructive',
      onConfirm: async () => {
        const res = await fetch(`/api/platform/users?userId=${encodeURIComponent(platformUser.id)}`, { method: 'DELETE' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not remove platform access');
        toast({ title: 'Platform access removed', variant: 'success' });
        await load();
      },
    });
  };

  const roleSummary = useMemo(() => ROLE_OPTIONS.find((role) => role.value === roleName)?.description ?? '', [roleName]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Platform', href: '/dashboard/platform' }, { label: 'Platform Users' }]} />
      <PageHeader title="Platform Users" description="Delegate platform operations without sharing the primary administrator account.">
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Add platform user</Button>
      </PageHeader>

      <section className="rounded-[10px] border border-brand-200 bg-brand-50/50 p-4 dark:border-brand-900/70 dark:bg-brand-950/20">
        <div className="flex items-start gap-3">
          <Shield className="mt-0.5 h-5 w-5 shrink-0 text-brand-700 dark:text-brand-300" />
          <div><p className="text-sm font-semibold text-ink-950">Protected administrator continuity</p><p className="mt-1 text-xs leading-relaxed text-ink-600">GovFleet always requires at least one active Platform Super Administrator. Support and Auditor roles can assist without receiving unrestricted platform control.</p></div>
        </div>
      </section>

      <div className="flex justify-end"><Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button></div>

      {loading ? <div className="flex min-h-48 items-center justify-center text-sm text-ink-500">Loading platform users…</div>
        : error ? <EmptyState icon={<UserCog className="h-6 w-6" />} title="Could not load platform users" description={error} action={{ label: 'Retry', onClick: load }} />
        : users.length === 0 ? <EmptyState icon={<UserCog className="h-6 w-6" />} title="No platform users found" description="Add a trusted platform operator to help manage GovFleet." action={{ label: 'Add platform user', onClick: () => setCreateOpen(true) }} />
        : <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
          {users.map((platformUser) => (
            <article key={platformUser.id} className="grid gap-4 border-b border-border px-4 py-4 last:border-b-0 sm:px-5 lg:grid-cols-[minmax(0,1fr)_260px_auto] lg:items-center">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-ink-950">{platformUser.name || platformUser.email}</p>{platformUser.isCurrentUser && <Badge variant="info" size="sm">You</Badge>}<Badge variant={platformUser.status === 'active' ? 'success' : 'default'} size="sm">{platformUser.status.replace(/_/g, ' ')}</Badge></div><p className="mt-1 truncate text-xs text-ink-500">{platformUser.email}{platformUser.username ? ` · ${platformUser.username}` : ''}</p></div>
              <div><p className="text-[10px] font-medium uppercase tracking-wide text-ink-400">Platform role</p><p className="mt-1 text-sm text-ink-700">{platformUser.roleName || 'No platform role'}</p></div>
              <div className="flex flex-wrap gap-2 lg:justify-end"><Button variant="secondary" size="sm" onClick={() => setEditing({ ...platformUser })}><UserCog className="h-4 w-4" /> Edit</Button>{!platformUser.isCurrentUser && <Button variant="ghost" size="sm" className="text-status-error-text" onClick={() => removeUser(platformUser)}><UserMinus className="h-4 w-4" /> Remove</Button>}</div>
            </article>
          ))}
        </div>}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Add platform user</DialogTitle><DialogDescription>Create a separate platform account with only the role needed for the work they will perform.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-1.5"><Label htmlFor="platform-user-name" required>Name</Label><Input id="platform-user-name" value={name} onChange={(event) => setName(event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="platform-user-email" required>Email</Label><Input id="platform-user-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="platform-user-role" required>Role</Label><StyledSelect id="platform-user-role" value={roleName} onChange={(event) => setRoleName(event.target.value)}>{ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</StyledSelect><p className="text-xs text-ink-500">{roleSummary}</p></div></div><DialogFooter><Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button><Button onClick={() => void createUser()} loading={saving}><UserRoundCheck className="h-4 w-4" /> Create user</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">{editing && <><DialogHeader><DialogTitle>Edit platform access</DialogTitle><DialogDescription>{editing.name || editing.email}</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-1.5"><Label>Role</Label><StyledSelect value={editing.roleName || SystemRoles.PLATFORM_SUPPORT} onChange={(event) => setEditing((current) => current ? { ...current, roleName: event.target.value } : current)}>{ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</StyledSelect></div><div className="space-y-1.5"><Label>Status</Label><StyledSelect value={editing.status} onChange={(event) => setEditing((current) => current ? { ...current, status: event.target.value } : current)} disabled={editing.isCurrentUser}><option value="active">Active</option><option value="suspended">Suspended</option></StyledSelect>{editing.isCurrentUser && <p className="text-xs text-ink-500">Your own active platform access cannot be disabled here.</p>}</div></div><DialogFooter><Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button><Button onClick={() => void saveUser()} loading={saving}>Save changes</Button></DialogFooter></> }</DialogContent>
      </Dialog>

      <Dialog open={Boolean(created)} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent className="sm:max-w-lg">{created && <><DialogHeader><DialogTitle>Platform user created</DialogTitle><DialogDescription>The temporary password is shown once. Share it through an appropriate private channel.</DialogDescription></DialogHeader><div className="space-y-2 rounded-[8px] border border-border bg-muted/30 p-4 font-mono text-sm"><p><span className="text-ink-500">Name:</span> {created.name}</p><p><span className="text-ink-500">Email:</span> {created.email}</p><p><span className="text-ink-500">Username:</span> {created.username}</p><p><span className="text-ink-500">Role:</span> {created.roleName}</p><p><span className="text-ink-500">Temporary password:</span> {created.temporaryPassword}</p></div><DialogFooter><Button variant="secondary" onClick={() => void navigator.clipboard.writeText(`GovFleet platform access\nUsername: ${created.username}\nEmail: ${created.email}\nTemporary password: ${created.temporaryPassword}\nRole: ${created.roleName}`)}><Copy className="h-4 w-4" /> Copy credentials</Button><Button onClick={() => setCreated(null)}>Done</Button></DialogFooter></> }</DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
