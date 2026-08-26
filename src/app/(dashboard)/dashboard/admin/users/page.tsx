'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageTabs } from '@/components/ui/page-tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SearchableEntitySelect } from '@/components/ui/searchable-entity-select';
import {
  Ban,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  RotateCcw,
  Search,
  Send,
  Smartphone,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { ClientFilterReset } from '@/components/ui/client-filter-reset';
import { getAccountStatusDisplay, getEmployeeStatusDisplay } from '@/lib/employee-status';

interface TenantUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  tenantStatus: string;
  joinedAt: string | null;
  roles: Array<{ id: string; roleName: string; isActing: boolean }>;
  employee: AvailableEmployee | null;
}

interface AvailableEmployee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  employmentStatus: string;
  departmentName: string | null;
  officeName: string | null;
}

interface RoleOption {
  id: string;
  name: string;
}

interface PendingInvite {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt: string;
  tenantStatus: string;
  daysSinceInvite: number;
}

type UserTab = 'all' | 'active' | 'pending' | 'removed';
type CopyTarget = 'full' | 'password' | 'username' | 'link';

function PendingInviteRow({ invite, onAction }: { invite: PendingInvite; onAction: () => void }) {
  const [loading, setLoading] = useState<'resend' | 'revoke' | null>(null);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const { toast } = useToast();

  const handleResend = useCallback(async () => {
    setLoading('resend');
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend', userId: invite.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to resend invitation');
      toast({
        title: 'Invitation resent',
        description: `A new invitation was sent to ${invite.email}.`,
        variant: 'success',
      });
      onAction();
    } catch (err) {
      toast({
        title: 'Resend failed',
        description: err instanceof Error ? err.message : 'Failed to resend invitation',
        variant: 'error',
      });
    } finally {
      setLoading(null);
    }
  }, [invite.email, invite.id, onAction, toast]);

  const handleRevoke = useCallback(async () => {
    setLoading('revoke');
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke', userId: invite.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to revoke invitation');
      toast({
        title: 'Invitation revoked',
        description: `${invite.email} can no longer use the pending invitation.`,
        variant: 'success',
      });
      onAction();
    } catch (err) {
      toast({
        title: 'Revoke failed',
        description: err instanceof Error ? err.message : 'Failed to revoke invitation',
        variant: 'error',
      });
      throw err;
    } finally {
      setLoading(null);
    }
  }, [invite.email, invite.id, onAction, toast]);

  return (
    <>
      <div className="border-border flex flex-col gap-3 border-b px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="bg-status-pending-bg text-status-pending-text flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
            {(invite.name || invite.email)[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-ink-950 min-w-0 truncate text-sm font-medium">
                {invite.name || 'Unnamed user'}
              </span>
              <Badge variant="pending" size="sm">
                Pending
              </Badge>
              {invite.daysSinceInvite > 7 && (
                <Badge variant="error" size="sm">
                  Expired
                </Badge>
              )}
            </div>
            <div className="text-ink-500 mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-all">{invite.email}</span>
              <span className="text-ink-400">· {invite.daysSinceInvite}d ago</span>
            </div>
          </div>
        </div>
        <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleResend()}
            loading={loading === 'resend'}
            disabled={loading !== null}
            className="flex-1 sm:flex-none"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Resend
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowRevokeConfirm(true)}
            loading={loading === 'revoke'}
            disabled={loading !== null}
            className="text-status-error-text flex-1 sm:flex-none"
          >
            <Ban className="h-3.5 w-3.5" /> Revoke
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={showRevokeConfirm}
        onOpenChange={setShowRevokeConfirm}
        title="Revoke invitation?"
        description={`The invitation for ${invite.email} will be invalidated and the pending account will no longer be able to activate from that invitation.`}
        confirmLabel="Revoke invitation"
        variant="destructive"
        onConfirm={handleRevoke}
      />
    </>
  );
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<UserTab>('all');

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteRoleIds, setInviteRoleIds] = useState<string[]>([]);
  const [inviteEmployeeId, setInviteEmployeeId] = useState('');
  const [roleSearch, setRoleSearch] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<'email' | 'manual'>('email');
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [inviteResult, setInviteResult] = useState<{
    success: boolean;
    emailSent: boolean;
    message: string;
  } | null>(null);
  const [isInviting, setIsInviting] = useState(false);

  const [showCredentials, setShowCredentials] = useState(false);
  const [credentialData, setCredentialData] = useState<{
    fullName: string;
    username: string;
    email: string;
    tempPassword: string;
    roleName: string;
    loginUrl: string;
  } | null>(null);
  const [copied, setCopied] = useState<CopyTarget | null>(null);

  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [removeUser, setRemoveUser] = useState<TenantUser | null>(null);
  const [restoreUser, setRestoreUser] = useState<TenantUser | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-users', searchQuery, page, activeTab],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      params.set('page', String(page));
      params.set('limit', '25');
      if (activeTab === 'active') params.set('status', 'active');
      else if (activeTab === 'removed') params.set('status', 'removed');
      const res = await fetch(`/api/admin/users?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load users');
      return json.data;
    },
  });

  const users: TenantUser[] = data?.users ?? [];
  const availableEmployees: AvailableEmployee[] = data?.availableEmployees ?? [];
  const total: number = data?.total ?? 0;
  const totalPages: number = data?.totalPages ?? 1;

  const copyText = useCallback(
    async (target: CopyTarget, value: string, description: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(target);
        window.setTimeout(
          () => setCopied((current) => (current === target ? null : current)),
          1800,
        );
        toast({ title: 'Copied', description, variant: 'success' });
      } catch {
        toast({
          title: 'Copy failed',
          description: 'Clipboard access is unavailable.',
          variant: 'error',
        });
      }
    },
    [toast],
  );

  const loadPendingInvites = useCallback(async () => {
    setLoadingInvites(true);
    try {
      const res = await fetch('/api/admin/invites?status=pending');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load pending invitations');
      setPendingInvites(json.data?.invites || []);
    } catch (err) {
      toast({
        title: 'Invitations unavailable',
        description: err instanceof Error ? err.message : 'Failed to load pending invitations',
        variant: 'error',
      });
    } finally {
      setLoadingInvites(false);
    }
  }, [toast]);

  useEffect(() => {
    if (activeTab === 'pending' && pendingInvites.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadPendingInvites();
    }
  }, [activeTab, loadPendingInvites, pendingInvites.length]);

  const openInviteDialog = async () => {
    setInviteResult(null);
    setInviteEmail('');
    setInviteName('');
    setInviteUsername('');
    setInviteRoleIds([]);
    setRoleSearch('');
    setInviteEmployeeId('');
    setDeliveryMode('email');
    setShowInvite(true);
    try {
      const res = await fetch('/api/admin/roles');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load roles');
      const roleList = json.data?.roles || json.roles || [];
      setRoles(Array.isArray(roleList) ? roleList : []);
    } catch (err) {
      toast({
        title: 'Roles unavailable',
        description: err instanceof Error ? err.message : 'Failed to load roles',
        variant: 'error',
      });
    }
  };

  const handleInvite = async () => {
    if (!inviteEmployeeId || !inviteEmail.trim()) return;
    const targetEmail = inviteEmail.trim();
    setIsInviting(true);
    setInviteResult(null);
    try {
      const res = await fetch('/api/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail,
          name: inviteName.trim() || undefined,
          username: inviteUsername.trim() || undefined,
          roleIds: inviteRoleIds,
          employeeId: inviteEmployeeId,
          sendInvite: deliveryMode === 'email',
          deliveryMode,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to invite user');

      const message =
        deliveryMode === 'email'
          ? json.emailSent
            ? `Invitation sent to ${targetEmail}.`
            : 'Account created, but email delivery is not configured. Share the temporary credentials manually.'
          : 'Account created. Share the temporary credentials with the user.';
      setInviteResult({ success: true, emailSent: Boolean(json.emailSent), message });
      if (json.data?.credentials) {
        setCredentialData(json.data.credentials);
        setCopied(null);
        setShowCredentials(true);
      }
      setInviteEmail('');
      setInviteName('');
      setInviteUsername('');
      setInviteRoleIds([]);
      setInviteEmployeeId('');
      await refetch();
      toast({
        title: deliveryMode === 'email' ? 'User invited' : 'Account created',
        description: message,
        variant: 'success',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to invite user';
      setInviteResult({ success: false, emailSent: false, message });
      toast({ title: 'Invite failed', description: message, variant: 'error' });
    } finally {
      setIsInviting(false);
    }
  };

  const handleRemoveUser = async () => {
    if (!removeUser) return;
    const target = removeUser;
    const res = await fetch(`/api/admin/users/${target.id}`, { method: 'DELETE' });
    const json = await res.json();
    if (!res.ok) {
      const message = json.error || 'Failed to remove user';
      toast({ title: 'Remove failed', description: message, variant: 'error' });
      throw new Error(message);
    }
    toast({
      title: 'User access removed',
      description: `${target.name || target.email} was removed from User Management. The staff record is preserved.`,
      variant: 'success',
    });
    setRemoveUser(null);
    await refetch();
  };

  const handleRestoreUser = async () => {
    if (!restoreUser) return;
    const target = restoreUser;
    const res = await fetch(`/api/admin/users/${target.id}/restore`, { method: 'POST' });
    const json = await res.json();
    if (!res.ok) {
      const message = json.error || 'Failed to restore user';
      toast({ title: 'Restore failed', description: message, variant: 'error' });
      throw new Error(message);
    }
    toast({
      title: 'User access restored',
      description: `${target.name || target.email} can sign in again. The staff record remains unchanged.`,
      variant: 'success',
    });
    setRestoreUser(null);
    await refetch();
  };

  const tabs: Array<{ key: UserTab; label: string }> = [
    { key: 'all', label: 'All Users' },
    { key: 'active', label: 'Active' },
    { key: 'removed', label: 'Removed Access' },
    { key: 'pending', label: 'Pending Invites' },
  ];

  return (
    <div className="space-y-5 sm:space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Administration' },
          { label: 'User Management' },
        ]}
      />
      <PageHeader
        title="User Management"
        description={`${total} user${total === 1 ? '' : 's'} in your organisation`}
      >
        <Button
          variant="primary"
          size="sm"
          onClick={() => void openInviteDialog()}
          className="w-full sm:w-auto"
        >
          <Send className="h-4 w-4" /> Invite User
        </Button>
      </PageHeader>

      <PageTabs
        items={tabs.map((tab) => ({ value: tab.key, label: tab.label }))}
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value);
          setPage(1);
          if (value === 'pending') void loadPendingInvites();
        }}
        label="User management views"
      />

      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Invite New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label required>Staff Member</Label>
              <SearchableEntitySelect
                value={inviteEmployeeId}
                ariaLabel="Search active staff"
                placeholder="Search name, employee number, email, office or department…"
                emptyLabel="No active staff member without an account matches this search."
                options={availableEmployees.map((employee) => ({
                  id: employee.id,
                  label: `${employee.firstName} ${employee.lastName}`,
                  description: `${employee.employeeNumber} · ${employee.officeName || 'No office'}${employee.departmentName ? ` · ${employee.departmentName}` : ''}`,
                  searchText: `${employee.email || ''} ${employee.departmentName || ''} ${employee.officeName || ''}`,
                  status: 'Available for account',
                }))}
                onChange={(option) => {
                  const employeeId = option?.id ?? '';
                  setInviteEmployeeId(employeeId);
                  const employee = availableEmployees.find((item) => item.id === employeeId);
                  if (employee) {
                    setInviteName(`${employee.firstName} ${employee.lastName}`);
                    if (employee.email) setInviteEmail(employee.email);
                  }
                }}
              />
              <p className="text-ink-500 text-xs">
                Login accounts remain linked to Staff Management; deleting access does not delete
                the employee record.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label required>Email Address</Label>
                <Input
                  type="email"
                  placeholder="user@organisation.gov.na"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input
                  placeholder="e.g. John Doe"
                  value={inviteName}
                  onChange={(event) => setInviteName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Username</Label>
                <Input
                  placeholder="Auto-generated if empty"
                  value={inviteUsername}
                  onChange={(event) => setInviteUsername(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Roles</Label>
              <Input
                value={roleSearch}
                onChange={(event) => setRoleSearch(event.target.value)}
                placeholder="Search roles…"
                aria-label="Search roles"
              />
              <div className="border-border bg-muted/20 max-h-52 overflow-y-auto rounded-[8px] border p-2">
                {roles.length === 0 ? (
                  <p className="text-ink-400 px-2 py-3 text-xs">No roles available.</p>
                ) : (
                  roles
                    .filter((role) =>
                      role.name.toLocaleLowerCase().includes(roleSearch.trim().toLocaleLowerCase()),
                    )
                    .map((role) => {
                      const checked = inviteRoleIds.includes(role.id);
                      return (
                        <label
                          key={role.id}
                          className="hover:bg-muted/50 flex min-h-10 cursor-pointer items-center gap-3 rounded-[6px] px-2 py-2 text-sm"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(next) => {
                              setInviteRoleIds((current) =>
                                next === true
                                  ? current.includes(role.id)
                                    ? current
                                    : [...current, role.id]
                                  : current.filter((id) => id !== role.id),
                              );
                            }}
                            aria-label={`Assign ${role.name}`}
                          />
                          <span className="text-ink-800 min-w-0 font-medium">{role.name}</span>
                        </label>
                      );
                    })
                )}
              </div>
              <p className="text-ink-500 text-xs">
                A user may hold multiple roles. Roles can be changed later without deleting the
                staff record.
              </p>
            </div>

            <div className="space-y-2">
              <Label required>Credential delivery</Label>
              <div
                className="grid gap-2 sm:grid-cols-2"
                role="radiogroup"
                aria-label="Credential delivery method"
              >
                {(
                  [
                    ['email', 'Send invitation email', 'Email the login details automatically.'],
                    [
                      'manual',
                      'Generate credentials to share',
                      'Display temporary credentials for secure manual sharing.',
                    ],
                  ] as const
                ).map(([value, title, description]) => {
                  const selected = deliveryMode === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setDeliveryMode(value)}
                      className={`focus-ring min-h-20 rounded-[8px] border p-3 text-left transition-colors motion-reduce:transition-none ${
                        selected
                          ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/20'
                          : 'border-border hover:bg-muted/40'
                      }`}
                    >
                      <span className="flex items-start gap-3">
                        <span
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-brand-700' : 'border-ink-300'}`}
                        >
                          {selected && <span className="bg-brand-700 h-2 w-2 rounded-full" />}
                        </span>
                        <span>
                          <span className="text-ink-950 block text-sm font-medium">{title}</span>
                          <span className="text-ink-500 mt-1 block text-xs leading-5">
                            {description}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {inviteResult && (
              <div
                className={`flex items-start gap-2 rounded-[8px] border p-3 text-sm ${inviteResult.success ? 'border-status-success-text/20 bg-status-success-bg text-status-success-text' : 'border-status-error-border bg-status-error-bg text-status-error-text'}`}
                role="status"
              >
                {inviteResult.success ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span className="min-w-0">{inviteResult.message}</span>
              </div>
            )}

            <div className="mobile-action-bar border-border flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowInvite(false)}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleInvite()}
                loading={isInviting}
                disabled={!inviteEmployeeId || !inviteEmail.trim() || isInviting}
                className="w-full sm:w-auto"
              >
                <Send className="h-4 w-4" />{' '}
                {deliveryMode === 'email' ? 'Create & Send Invite' : 'Create Account'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {activeTab !== 'pending' && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1 sm:max-w-md">
                <Search
                  className="text-ink-400 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  placeholder="Search name, username or email…"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setPage(1);
                  }}
                  className="pl-9"
                />
              </div>
              <ClientFilterReset
                isFiltered={Boolean(searchQuery)}
                onClear={() => {
                  setSearchQuery('');
                  setPage(1);
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <div
          className="border-status-error-border bg-status-error-bg text-status-error-text flex flex-wrap items-center gap-2 rounded-[8px] border px-4 py-3"
          role="alert"
        >
          <p className="min-w-0 flex-1 text-sm">
            {error instanceof Error ? error.message : 'Failed to load users'}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      )}

      {(isLoading || (activeTab === 'pending' && loadingInvites)) && (
        <div
          className="text-ink-500 flex items-center justify-center gap-2 py-14 text-sm"
          role="status"
        >
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{' '}
          Loading user records…
        </div>
      )}

      {activeTab === 'pending' &&
        !loadingInvites &&
        (pendingInvites.length === 0 ? (
          <EmptyState
            icon={<Send className="h-6 w-6" />}
            title="No pending invitations"
            description="There are no outstanding user invitations for this tenant."
          />
        ) : (
          <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
            {pendingInvites.map((invite) => (
              <PendingInviteRow
                key={invite.id}
                invite={invite}
                onAction={() => {
                  void refetch();
                  void loadPendingInvites();
                }}
              />
            ))}
          </div>
        ))}

      {!isLoading && !error && users.length === 0 && activeTab !== 'pending' && (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="No users found"
          description={
            searchQuery
              ? 'No matching records found. Clear filters to view all users.'
              : 'Invite an active staff member to create their login account.'
          }
        />
      )}

      {!isLoading && users.length > 0 && activeTab !== 'pending' && (
        <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
          {users.map((userRecord) => {
            const accountDisplay =
              userRecord.tenantStatus === 'access_removed'
                ? { label: 'Removed', variant: 'cancelled' as const }
                : userRecord.tenantStatus === 'pending'
                  ? { label: 'Pending', variant: 'pending' as const }
                  : getAccountStatusDisplay(userRecord.tenantStatus);
            const employeeDisplay = userRecord.employee
              ? getEmployeeStatusDisplay(userRecord.employee.employmentStatus)
              : null;
            const showEmployeeStatus =
              employeeDisplay !== null && employeeDisplay.canonical !== 'active';

            return (
              <div
                key={userRecord.id}
                className="focus-within:bg-muted/30 hover:bg-muted/30 border-border flex cursor-pointer flex-col gap-3 border-b px-4 py-4 transition-colors last:border-b-0 motion-reduce:transition-none sm:flex-row sm:items-center sm:justify-between sm:px-5"
                onClick={() => router.push(`/dashboard/admin/users/${userRecord.id}`)}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="bg-muted text-ink-700 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                    {(userRecord.name || userRecord.email)[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-ink-950 min-w-0 truncate text-sm font-medium">
                        {userRecord.name || 'Unnamed user'}
                      </span>
                      <Badge variant={accountDisplay.variant} size="sm">
                        {accountDisplay.label}
                      </Badge>
                    </div>
                    <div className="text-ink-500 mt-1 flex min-w-0 items-start gap-2 text-xs">
                      <Mail className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 break-all">{userRecord.email}</span>
                    </div>
                    {userRecord.employee && (
                      <div className="text-ink-500 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span>
                          {userRecord.employee.firstName} {userRecord.employee.lastName}
                        </span>
                        <span className="text-ink-300">·</span>
                        <span>{userRecord.employee.employeeNumber}</span>
                        {showEmployeeStatus && employeeDisplay && (
                          <Badge variant={employeeDisplay.variant} size="sm">
                            {employeeDisplay.label}
                          </Badge>
                        )}
                      </div>
                    )}
                    {userRecord.roles.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5 sm:hidden">
                        {userRecord.roles.slice(0, 3).map((role) => (
                          <Badge key={role.id} variant="info" size="sm">
                            {role.isActing ? `${role.roleName} (acting)` : role.roleName}
                          </Badge>
                        ))}
                        {userRecord.roles.length > 3 && (
                          <span className="text-ink-400 text-xs">
                            +{userRecord.roles.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 sm:shrink-0 sm:justify-end">
                  {userRecord.roles.length > 0 && (
                    <div className="hidden max-w-sm flex-wrap justify-end gap-1 sm:flex">
                      {userRecord.roles.slice(0, 2).map((role) => (
                        <Badge key={role.id} variant="info" size="sm">
                          {role.isActing ? `${role.roleName} (acting)` : role.roleName}
                        </Badge>
                      ))}
                      {userRecord.roles.length > 2 && (
                        <span className="text-ink-400 text-xs">+{userRecord.roles.length - 2}</span>
                      )}
                    </div>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    {userRecord.tenantStatus === 'access_removed' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setRestoreUser(userRecord);
                        }}
                        aria-label={`Restore ${userRecord.name || userRecord.email} access`}
                        title="Restore user access"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (userRecord.roles.length === 0) setRemoveUser(userRecord);
                        }}
                        disabled={userRecord.roles.length > 0}
                        aria-label={`Remove ${userRecord.name || userRecord.email} from User Management`}
                        title={
                          userRecord.roles.length > 0
                            ? 'Remove role assignments first'
                            : 'Remove user access; keep staff record'
                        }
                        className={
                          userRecord.roles.length === 0 ? 'text-status-error-text' : undefined
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                    <ChevronRight className="text-ink-400 h-4 w-4" aria-hidden="true" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && activeTab !== 'pending' && (
        <div className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-ink-500 text-xs tabular-nums">
            Page {page} of {totalPages} · {total} total
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="flex-1 sm:flex-none"
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
              className="flex-1 sm:flex-none"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(restoreUser)}
        onOpenChange={(open) => {
          if (!open) setRestoreUser(null);
        }}
        title="Restore user access?"
        description={`Restore login access for ${restoreUser?.name || restoreUser?.email || 'this user'}? The existing staff record remains unchanged; role assignments may need to be added again.`}
        confirmLabel="Restore access"
        onConfirm={handleRestoreUser}
      />

      <ConfirmDialog
        open={Boolean(removeUser)}
        onOpenChange={(open) => {
          if (!open) setRemoveUser(null);
        }}
        title="Remove user access?"
        description={`Remove ${removeUser?.name || removeUser?.email || 'this user'} from User Management? Login access and pending invitations are removed, but the Staff Directory employee record is preserved.`}
        confirmLabel="Remove access"
        variant="destructive"
        onConfirm={handleRemoveUser}
      />

      <Dialog open={showCredentials} onOpenChange={setShowCredentials}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>User Account Created</DialogTitle>
          </DialogHeader>
          {credentialData && (
            <div className="space-y-4">
              <div className="border-status-success-text/20 bg-status-success-bg text-status-success-text flex items-start gap-2 rounded-[8px] border p-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Account created successfully. Share these temporary credentials securely.
                </span>
              </div>

              <div className="border-border bg-muted/30 rounded-[8px] border p-4">
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <dt className="text-ink-500 text-xs">Name</dt>
                    <dd className="text-ink-950 mt-0.5 font-medium">{credentialData.fullName}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500 text-xs">Username</dt>
                    <dd className="text-ink-950 mt-0.5 font-mono text-xs font-semibold break-all">
                      {credentialData.username}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-500 text-xs">Temporary password</dt>
                    <dd className="text-ink-950 mt-0.5 font-mono text-xs font-semibold break-all">
                      {credentialData.tempPassword}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-ink-500 text-xs">Role(s)</dt>
                    <dd className="text-ink-800 mt-0.5">{credentialData.roleName}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-ink-500 text-xs">Login URL</dt>
                    <dd className="text-brand-700 mt-0.5 text-xs break-all">
                      {credentialData.loginUrl}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void copyText('username', credentialData.username, 'Username copied.')
                  }
                >
                  {copied === 'username' ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied === 'username' ? 'Copied' : 'Copy username'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void copyText(
                      'password',
                      credentialData.tempPassword,
                      'Temporary password copied.',
                    )
                  }
                >
                  {copied === 'password' ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied === 'password' ? 'Copied' : 'Copy password'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const text = `Welcome to GRN Fleet Management\n\nName: ${credentialData.fullName}\nUsername: ${credentialData.username}\nTemporary Password: ${credentialData.tempPassword}\nRole: ${credentialData.roleName}\nLogin URL: ${credentialData.loginUrl}\n\nPlease change your password after your first login.`;
                    void copyText('full', text, 'Full credentials copied.');
                  }}
                >
                  {copied === 'full' ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied === 'full' ? 'Copied' : 'Copy all'}
                </Button>
              </div>

              <div className="border-border space-y-2 border-t pt-4">
                <p className="text-ink-500 text-xs font-medium tracking-wider uppercase">
                  Share credentials
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const message = encodeURIComponent(
                        `Welcome to GRN Fleet Management\n\nName: ${credentialData.fullName}\nUsername: ${credentialData.username}\nTemporary Password: ${credentialData.tempPassword}\nLogin: ${credentialData.loginUrl}\n\nPlease change your password after first login.`,
                      );
                      window.open(
                        `https://wa.me/?text=${message}`,
                        '_blank',
                        'noopener,noreferrer',
                      );
                    }}
                  >
                    <Smartphone className="h-4 w-4" /> WhatsApp
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!credentialData.email}
                    onClick={() => {
                      const subject = encodeURIComponent('Your GRN Fleet Management Account');
                      const body = encodeURIComponent(
                        `Welcome to GRN Fleet Management\n\nName: ${credentialData.fullName}\nUsername: ${credentialData.username}\nTemporary Password: ${credentialData.tempPassword}\nRole: ${credentialData.roleName}\nLogin URL: ${credentialData.loginUrl}\n\nPlease change your password after your first login.`,
                      );
                      window.open(
                        `mailto:${credentialData.email}?subject=${subject}&body=${body}`,
                        '_blank',
                      );
                    }}
                  >
                    <Mail className="h-4 w-4" /> Email
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      const shareText = `GRN Fleet Management login for ${credentialData.fullName}. Login at ${credentialData.loginUrl}`;
                      if (navigator.share) {
                        try {
                          await navigator.share({
                            title: 'GRN Fleet Management Account',
                            text: shareText,
                            url: credentialData.loginUrl,
                          });
                        } catch {
                          // Native share can be cancelled without an error message.
                        }
                      } else {
                        await copyText('link', shareText, 'Share text copied.');
                      }
                    }}
                  >
                    {copied === 'link' ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <ExternalLink className="h-4 w-4" />
                    )}
                    {copied === 'link' ? 'Copied' : 'Share'}
                  </Button>
                </div>
              </div>

              <div className="mobile-action-bar border-border flex justify-end border-t pt-3">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setShowCredentials(false)}
                  className="w-full sm:w-auto"
                >
                  <CheckCircle2 className="h-4 w-4" /> Done
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
