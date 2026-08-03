'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SearchableEntitySelect } from '@/components/ui/searchable-entity-select';
import {
  Users,
  Search,
  ChevronRight,
  Mail,
  Loader2,
  Send,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Ban,
  User,
  Copy,
  ExternalLink,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { ClientFilterReset } from '@/components/ui/client-filter-reset';
import { getEmployeeStatusDisplay } from '@/lib/employee-status';

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

// -----------------------------------------------------------------------
// PendingInviteRow — inline component for invite management
// -----------------------------------------------------------------------

function PendingInviteRow({ invite, onAction }: { invite: PendingInvite; onAction: () => void }) {
  const [loading, setLoading] = useState<'resend' | 'revoke' | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const { toast } = useToast();

  const handleResend = useCallback(async () => {
    setLoading('resend');
    setResult(null);
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend', userId: invite.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setResult(json.data?.message || 'Invitation re-sent');
      onAction();
      toast({
        title: 'Invite Resent',
        description: `Invitation re-sent to ${invite.email}.`,
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to resend';
      setResult(msg);
      toast({ title: 'Resend Failed', description: msg, variant: 'error' });
    } finally {
      setLoading(null);
    }
  }, [invite.id, invite.email, onAction, toast]);

  const handleRevoke = useCallback(async () => {
    setShowRevokeConfirm(false);
    setLoading('revoke');
    setResult(null);
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke', userId: invite.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setResult(json.data?.message || 'Invitation revoked');
      onAction();
      toast({
        title: 'Invite Revoked',
        description: `Invitation for ${invite.email} has been revoked.`,
        variant: 'default',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to revoke';
      setResult(msg);
      toast({ title: 'Revoke Failed', description: msg, variant: 'error' });
    } finally {
      setLoading(null);
    }
  }, [invite.id, invite.email, onAction, toast]);

  return (
    <>
      <div className="hover:bg-muted/50 flex flex-col items-start gap-3 px-4 py-3.5 transition-colors sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-sm font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {(invite.name || invite.email)[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-ink-950 truncate text-sm font-medium">
                {invite.name || 'Unnamed'}
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
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2">
              <Mail className="text-ink-400 h-3 w-3" />
              <span className="overflow-wrap-anywhere text-ink-500 min-w-0 text-xs">
                {invite.email}
              </span>
              <span className="text-ink-400 text-xs">· {invite.daysSinceInvite}d ago</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {result && (
            <span className="text-ink-500 mr-2 max-w-[160px] truncate text-xs">{result}</span>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleResend}
            loading={loading === 'resend'}
            disabled={loading !== null}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Resend
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowRevokeConfirm(true)}
            loading={loading === 'revoke'}
            disabled={loading !== null}
            className="text-status-error-text hover:text-status-error-text"
          >
            <Ban className="h-3.5 w-3.5" />
            Revoke
          </Button>
        </div>
      </div>

      {/* Revoke Confirmation Dialog */}
      <Dialog open={showRevokeConfirm} onOpenChange={setShowRevokeConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke Invitation</DialogTitle>
          </DialogHeader>
          <p className="text-ink-700 text-sm">
            Are you sure you want to revoke the invitation for <strong>{invite.email}</strong>? This
            will suspend their access and prevent them from logging in.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={() => setShowRevokeConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleRevoke}
              className="bg-status-error-text hover:bg-red-700"
            >
              <Ban className="h-4 w-4" /> Revoke
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// -----------------------------------------------------------------------
// Main Page
// -----------------------------------------------------------------------

export default function AdminUsersPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');

  // Invite dialog
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

  // Credential sharing dialog
  const [showCredentials, setShowCredentials] = useState(false);
  const [credentialData, setCredentialData] = useState<{
    fullName: string;
    username: string;
    email: string;
    tempPassword: string;
    roleName: string;
    loginUrl: string;
  } | null>(null);
  const [copied, setCopied] = useState<'full' | 'password' | 'username' | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'pending' | 'removed'>('all');
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);

  // Remove-user flow (role-less / pending accounts only)
  const [removeUser, setRemoveUser] = useState<TenantUser | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  // Restore-user flow (access_removed accounts)
  const [restoreUser, setRestoreUser] = useState<TenantUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

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
      if (res.ok) {
        const json = await res.json();
        const roleList = json.data?.roles || json.roles || [];
        setRoles(Array.isArray(roleList) ? roleList : []);
      }
    } catch {
      /* silent */
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;

    setIsInviting(true);
    setInviteResult(null);

    try {
      const res = await fetch('/api/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
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

      setInviteResult({
        success: true,
        emailSent: json.emailSent,
        message:
          deliveryMode === 'email'
            ? json.emailSent
              ? `Invitation sent to ${inviteEmail.trim()}.`
              : `User created. RESEND_API_KEY not configured — provide password to user manually.`
            : `Account created. Share the credentials below with the user.`,
      });

      // Show credential dialog if we have credentials
      if (json.data?.credentials) {
        setCredentialData(json.data.credentials);
        setShowCredentials(true);
      }

      setInviteEmail('');
      setInviteName('');
      setInviteUsername('');
      setInviteRoleIds([]);
      setInviteEmployeeId('');
      refetch();
      toast({
        title: deliveryMode === 'email' ? 'User Invited' : 'Account Created',
        description:
          deliveryMode === 'email'
            ? `Invitation sent to ${inviteEmail.trim()}.`
            : 'Credentials ready to share with the user.',
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to invite user';
      setInviteResult({
        success: false,
        emailSent: false,
        message: msg,
      });
      toast({ title: 'Invite Failed', description: msg, variant: 'error' });
    } finally {
      setIsInviting(false);
    }
  };

  const handleRemoveUser = async () => {
    if (!removeUser) return;
    setIsRemoving(true);
    try {
      const res = await fetch(`/api/admin/users/${removeUser.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to remove user');
      toast({
        title: 'User removed',
        description: `${removeUser.name || removeUser.email} removed from the organisation. The staff record is preserved.`,
        variant: 'success',
      });
      setRemoveUser(null);
      refetch();
    } catch (err) {
      toast({
        title: 'Failed to remove user',
        description: err instanceof Error ? err.message : 'Failed to remove user',
        variant: 'error',
      });
    } finally {
      setIsRemoving(false);
    }
  };

  const handleRestoreUser = async () => {
    if (!restoreUser) return;
    setIsRestoring(true);
    try {
      const res = await fetch(`/api/admin/users/${restoreUser.id}/restore`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to restore user');
      toast({
        title: 'User access restored',
        description: `${restoreUser.name || restoreUser.email} can sign in again. The staff record was preserved.`,
        variant: 'success',
      });
      setRestoreUser(null);
      refetch();
    } catch (err) {
      toast({
        title: 'Failed to restore user',
        description: err instanceof Error ? err.message : 'Failed to restore user',
        variant: 'error',
      });
    } finally {
      setIsRestoring(false);
    }
  };

  const loadPendingInvites = useCallback(async () => {
    setLoadingInvites(true);
    try {
      const res = await fetch('/api/admin/invites?status=pending');
      if (res.ok) {
        const json = await res.json();
        setPendingInvites(json.data?.invites || []);
      }
    } catch {
      /* silent */
    } finally {
      setLoadingInvites(false);
    }
  }, []);

  const handleTabChange = (tab: 'all' | 'active' | 'pending' | 'removed') => {
    setActiveTab(tab);
    if (tab === 'pending') {
      loadPendingInvites();
    }
  };

  // Load pending invites when tab switches to pending
  useEffect(() => {
    if (activeTab === 'pending' && pendingInvites.length === 0) {
      // The tab transition is the external event that triggers this fetch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadPendingInvites();
    }
  }, [activeTab, pendingInvites.length, loadPendingInvites]);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Administration', href: '/dashboard' },
          { label: 'User Management' },
        ]}
      />
      <PageHeader
        title="User Management"
        description={`${total} user${total !== 1 ? 's' : ''} in your organisation`}
      >
        <Button variant="primary" size="sm" onClick={openInviteDialog}>
          <Send className="h-4 w-4" /> Invite User
        </Button>
      </PageHeader>

      {/* Tabs: All | Active | Removed | Pending Invites */}
      <div className="border-border flex gap-1 border-b">
        {(['all', 'active', 'removed', 'pending'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'border-brand-600 text-brand-700'
                : 'text-ink-500 hover:text-ink-700 hover:border-ink-300 border-transparent'
            }`}
          >
            {tab === 'all'
              ? 'All Users'
              : tab === 'active'
                ? 'Active'
                : tab === 'removed'
                  ? 'Removed Access'
                  : 'Pending Invites'}
          </button>
        ))}
      </div>

      {/* Invite Dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label required>Staff Member</Label>
              <SearchableEntitySelect
                value={inviteEmployeeId}
                ariaLabel="Search by name, number, email, office or department"
                placeholder="Search by name, number, email, office or department…"
                emptyLabel="No employee without an existing or pending account matches this search."
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
                Accounts must be linked to an active employee record.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label required>Email Address</Label>
              <Input
                type="email"
                placeholder="user@organisation.gov.na"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input
                placeholder="e.g. John Doe"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input
                placeholder="Auto-generated if empty"
                value={inviteUsername}
                onChange={(e) => setInviteUsername(e.target.value)}
              />
              <p className="text-ink-500 text-xs">
                Username is used for login. Generated from name if left empty.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Roles</Label>
              <Input
                value={roleSearch}
                onChange={(event) => setRoleSearch(event.target.value)}
                placeholder="Search permitted roles…"
                aria-label="Search permitted roles"
              />
              <div className="border-border bg-muted/30 max-h-44 space-y-1 overflow-y-auto rounded-[8px] border p-2">
                {roles.length === 0 ? (
                  <p className="text-ink-400 px-2 py-1 text-xs">No roles available</p>
                ) : (
                  roles
                    .filter((role) =>
                      role.name.toLocaleLowerCase().includes(roleSearch.trim().toLocaleLowerCase()),
                    )
                    .map((r) => {
                      const checked = inviteRoleIds.includes(r.id);
                      return (
                        <label
                          key={r.id}
                          className={`flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm transition-colors ${
                            checked ? 'bg-brand-50 text-brand-800' : 'text-ink-700 hover:bg-muted'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="border-border text-brand-600 focus:ring-brand-500 h-4 w-4 rounded"
                            checked={checked}
                            onChange={() => {
                              setInviteRoleIds((prev) =>
                                checked ? prev.filter((id) => id !== r.id) : [...prev, r.id],
                              );
                            }}
                          />
                          <span className="font-medium">{r.name}</span>
                        </label>
                      );
                    })
                )}
              </div>
              <p className="text-ink-500 text-xs">
                A staff member may hold multiple roles at the same time.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label required>How will the user receive their credentials?</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label
                  className={`flex cursor-pointer items-start gap-2 rounded-[8px] border p-3 text-sm transition-colors ${
                    deliveryMode === 'email'
                      ? 'border-brand-500 bg-brand-50 text-brand-900'
                      : 'border-border text-ink-700 hover:bg-muted/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="deliveryMode"
                    className="border-border text-brand-600 accent-brand-600 mt-0.5 h-4 w-4"
                    checked={deliveryMode === 'email'}
                    onChange={() => setDeliveryMode('email')}
                  />
                  <span>
                    <span className="font-medium">Send invitation email</span>
                    <span className="text-ink-500 mt-0.5 block text-xs">
                      Login details are emailed to the user automatically.
                    </span>
                  </span>
                </label>
                <label
                  className={`flex cursor-pointer items-start gap-2 rounded-[8px] border p-3 text-sm transition-colors ${
                    deliveryMode === 'manual'
                      ? 'border-brand-500 bg-brand-50 text-brand-900'
                      : 'border-border text-ink-700 hover:bg-muted/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="deliveryMode"
                    className="border-border text-brand-600 accent-brand-600 mt-0.5 h-4 w-4"
                    checked={deliveryMode === 'manual'}
                    onChange={() => setDeliveryMode('manual')}
                  />
                  <span>
                    <span className="font-medium">Generate credentials to share</span>
                    <span className="text-ink-500 mt-0.5 block text-xs">
                      Show temporary credentials now and share via WhatsApp, email or copy.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            {inviteResult && (
              <div
                className={`flex items-start gap-2 rounded-[8px] border p-3 text-sm ${
                  inviteResult.success
                    ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800/50 dark:bg-green-950/30 dark:text-green-300'
                    : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300'
                }`}
              >
                {inviteResult.success ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>{inviteResult.message}</span>
              </div>
            )}

            <div className="mobile-action-bar flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleInvite}
                loading={isInviting}
                disabled={!inviteEmployeeId || !inviteEmail.trim() || isInviting}
              >
                <Send className="h-4 w-4" /> Send Invitation
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowInvite(false)}>
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Search (hidden on pending tab) */}
      {activeTab !== 'pending' && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-sm">
            <Search className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
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
      )}

      {/* Error */}
      {error && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-status-error-text text-sm">
              {error instanceof Error ? error.message : 'Failed to load users'}
            </p>
            <Button variant="secondary" size="sm" onClick={() => refetch()} className="mt-2">
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {(isLoading || (activeTab === 'pending' && loadingInvites)) && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-ink-400 h-6 w-6 animate-spin" />
        </div>
      )}

      {/* Pending Invites Tab Content */}
      {activeTab === 'pending' && !loadingInvites && (
        <>
          {pendingInvites.length === 0 ? (
            <EmptyState
              icon={<Send className="h-6 w-6" />}
              title="No pending invites"
              description="All invited users have verified their email."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-border divide-y">
                  {pendingInvites.map((inv) => (
                    <PendingInviteRow
                      key={inv.id}
                      invite={inv}
                      onAction={() => {
                        refetch();
                        loadPendingInvites();
                      }}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Empty (non-pending tabs) */}
      {!isLoading && !error && users.length === 0 && activeTab !== 'pending' && (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="No users found"
          description={
            searchQuery
              ? 'No matching records found. Clear filters to view all records.'
              : 'Invite your first user to get started.'
          }
        />
      )}

      {/* User List (non-pending tabs) */}
      {!isLoading && users.length > 0 && activeTab !== 'pending' && (
        <Card>
          <CardContent className="p-0">
            <div className="divide-border divide-y">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="hover:bg-muted/50 flex cursor-pointer items-center justify-between px-5 py-3.5 transition-colors"
                  onClick={() => router.push(`/dashboard/admin/users/${u.id}`)}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="bg-muted text-ink-700 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                      {(u.name || u.email)[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-ink-950 truncate text-sm font-medium">
                          {u.name || 'Unnamed'}
                        </span>
                        <Badge
                          variant={
                            u.tenantStatus === 'active'
                              ? 'success'
                              : u.tenantStatus === 'suspended'
                                ? 'error'
                                : u.tenantStatus === 'access_removed'
                                  ? 'cancelled'
                                  : 'pending'
                          }
                          size="sm"
                        >
                          {u.tenantStatus === 'access_removed'
                            ? 'Removed'
                            : u.tenantStatus}
                        </Badge>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <Mail className="text-ink-400 h-3 w-3" />
                        <span className="text-ink-500 text-xs">{u.email}</span>
                      </div>
                      {u.employee && (
                        <div className="text-ink-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          <span className="text-ink-400">Linked staff:</span>
                          <span className="text-ink-700 font-medium">
                            {u.employee.firstName} {u.employee.lastName}
                          </span>
                          <span className="text-ink-400">·</span>
                          <span>{u.employee.employeeNumber}</span>
                          <Badge
                            variant={getEmployeeStatusDisplay(u.employee.employmentStatus).variant}
                            size="sm"
                          >
                            {getEmployeeStatusDisplay(u.employee.employmentStatus).label}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {u.roles.length > 0 && (
                      <div className="hidden items-center gap-1 sm:flex">
                        {u.roles.slice(0, 2).map((r) => (
                          <Badge key={r.id} variant="info" size="sm">
                            {r.isActing ? `${r.roleName} (acting)` : r.roleName}
                          </Badge>
                        ))}
                        {u.roles.length > 2 && (
                          <span className="text-ink-400 text-xs">+{u.roles.length - 2}</span>
                        )}
                      </div>
                    )}
                    {u.tenantStatus === 'access_removed' ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRestoreUser(u);
                        }}
                        title="Restore user access (staff record preserved)"
                        aria-label={`Restore ${u.name || u.email} access`}
                        className="text-ink-400 hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-950/30 flex h-7 w-7 items-center justify-center rounded-[6px] transition-colors"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (u.roles.length === 0) setRemoveUser(u);
                        }}
                        disabled={u.roles.length > 0}
                        title={
                          u.roles.length > 0
                            ? 'Remove role assignments first, then this user can be removed'
                            : 'Remove from organisation (staff record preserved)'
                        }
                        aria-label={`Remove ${u.name || u.email} from organisation`}
                        className={`flex h-7 w-7 items-center justify-center rounded-[6px] transition-colors ${
                          u.roles.length === 0
                            ? 'text-ink-400 hover:bg-red-50 hover:text-status-error-text dark:hover:bg-red-950/30'
                            : 'cursor-not-allowed text-ink-300'
                        }`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <ChevronRight className="text-ink-400 h-4 w-4" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && activeTab !== 'pending' && (
        <div className="flex items-center justify-between">
          <p className="text-ink-500 text-xs">
            Page {page} of {totalPages} ({total} total)
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
      {/* Restore User Confirmation Dialog */}
      <Dialog open={!!restoreUser} onOpenChange={(open) => !open && setRestoreUser(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Restore User Access</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-ink-700 text-sm">
              Restore login access for{' '}
              <strong>{restoreUser?.name || restoreUser?.email || 'this user'}</strong>? They will
              be able to sign in again and will reappear in User Management.
            </p>
            <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300">
              Their <strong>staff/employee record is unchanged</strong>. Role assignments may need
              to be re-added after restoration.
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => setRestoreUser(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleRestoreUser}
                loading={isRestoring}
              >
                <RotateCcw className="h-4 w-4" /> Restore Access
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remove User Confirmation Dialog */}
      <Dialog open={!!removeUser} onOpenChange={(open) => !open && setRemoveUser(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove User from Organisation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-ink-700 text-sm">
              Are you sure you want to remove{' '}
              <strong>{removeUser?.name || removeUser?.email || 'this user'}</strong> from the
              organisation? This removes their login access and any pending invitation.
            </p>
            <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300">
              Their <strong>staff/employee record is preserved</strong> — the person will still
              appear in the Staff Directory and can be re-invited later.
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => setRemoveUser(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleRemoveUser}
                loading={isRemoving}
                className="bg-status-error-text hover:bg-red-700"
              >
                <Trash2 className="h-4 w-4" /> Remove User
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Credential Sharing Dialog */}
      <Dialog open={showCredentials} onOpenChange={setShowCredentials}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>User Account Created</DialogTitle>
          </DialogHeader>

          {credentialData && (
            <div className="space-y-4">
              <div className="rounded-[8px] border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800/40 dark:bg-green-950/20 dark:text-green-300">
                <CheckCircle2 className="mr-1 inline h-4 w-4" />
                Account created successfully. Share the credentials below with the user.
              </div>

              {/* Formatted Credential Block */}
              <div className="border-border bg-muted group relative rounded-[8px] border p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                <button
                  onClick={async () => {
                    const text = `--------------------------------\n\nWelcome to GRN Fleet Management\n\nName:\n${credentialData.fullName}\n\nUsername:\n${credentialData.username}\n\nTemporary Password:\n${credentialData.tempPassword}\n\nRole:\n${credentialData.roleName}\n\nLogin URL:\n${credentialData.loginUrl}\n\nPlease change your password after your first login.\n\n--------------------------------`;
                    try {
                      await navigator.clipboard.writeText(text);
                      setCopied('full');
                      setTimeout(() => setCopied(null), 2000);
                      toast({
                        title: 'Copied',
                        description: 'Full credentials copied to clipboard.',
                        variant: 'success',
                      });
                    } catch {
                      toast({
                        title: 'Copy Failed',
                        description: 'Unable to copy to clipboard.',
                        variant: 'error',
                      });
                    }
                  }}
                  className="bg-surface border-border text-ink-500 hover:text-ink-700 absolute top-2 right-2 flex items-center gap-1 rounded-[4px] border px-2 py-1 font-sans text-xs opacity-0 transition-opacity group-hover:opacity-100"
                >
                  {copied === 'full' ? (
                    <>
                      <CheckCircle2 className="h-3 w-3" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" /> Copy All
                    </>
                  )}
                </button>
                <span className="text-ink-500">--------------------------------</span>
                <br />
                <br />
                <span className="text-ink-500">Welcome to GRN Fleet Management</span>
                <br />
                <br />
                <span className="text-ink-500">Name:</span>
                <br />
                <span className="text-ink-950 font-semibold">{credentialData.fullName}</span>
                <br />
                <br />
                <span className="text-ink-500">Username:</span>
                <br />
                <span className="text-ink-950 font-semibold">{credentialData.username}</span>
                <br />
                <br />
                <span className="text-ink-500">Temporary Password:</span>
                <br />
                <span className="text-ink-950 font-bold tracking-wider">
                  {credentialData.tempPassword}
                </span>
                <br />
                <br />
                <span className="text-ink-500">Role:</span>
                <br />
                <span className="text-ink-950">{credentialData.roleName}</span>
                <br />
                <br />
                <span className="text-ink-500">Login URL:</span>
                <br />
                <span className="text-brand-600">{credentialData.loginUrl}</span>
                <br />
                <br />
                <span className="text-ink-400 italic">
                  Please change your password after your first login.
                </span>
                <br />
                <br />
                <span className="text-ink-500">--------------------------------</span>
              </div>

              {/* Quick Copy Buttons */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(credentialData.tempPassword);
                      setCopied('password');
                      setTimeout(() => setCopied(null), 2000);
                      toast({
                        title: 'Copied',
                        description: 'Password copied.',
                        variant: 'success',
                      });
                    } catch {
                      toast({
                        title: 'Copy Failed',
                        description: 'Unable to copy.',
                        variant: 'error',
                      });
                    }
                  }}
                >
                  {copied === 'password' ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  Copy Password
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(credentialData.username);
                      setCopied('username');
                      setTimeout(() => setCopied(null), 2000);
                      toast({
                        title: 'Copied',
                        description: 'Username copied.',
                        variant: 'success',
                      });
                    } catch {
                      toast({
                        title: 'Copy Failed',
                        description: 'Unable to copy.',
                        variant: 'error',
                      });
                    }
                  }}
                >
                  {copied === 'username' ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <User className="h-4 w-4" />
                  )}
                  Copy Username
                </Button>
              </div>

              {/* Share Options */}
              <div className="space-y-2">
                <p className="text-ink-500 text-xs font-medium tracking-wider uppercase">
                  Share Credentials
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {/* WhatsApp Share */}
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      const message = encodeURIComponent(
                        `Welcome to GRN Fleet Management\n\nName: ${credentialData.fullName}\nUsername: ${credentialData.username}\nTemporary Password: ${credentialData.tempPassword}\nLogin: ${credentialData.loginUrl}\n\nPlease change your password after first login.`,
                      );
                      window.open(`https://wa.me/?text=${message}`, '_blank');
                    }}
                  >
                    <Smartphone className="h-4 w-4" /> WhatsApp
                  </Button>

                  {/* Email Share */}
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
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
                    disabled={!credentialData.email}
                    title={
                      !credentialData.email ? 'No email address available' : 'Open email client'
                    }
                  >
                    <Mail className="h-4 w-4" /> Email
                  </Button>

                  {/* Share Link */}
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
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
                          // User cancelled share
                        }
                      } else {
                        await navigator.clipboard.writeText(shareText);
                        toast({
                          title: 'Link Copied',
                          description: 'Share link copied to clipboard.',
                          variant: 'success',
                        });
                      }
                    }}
                  >
                    <ExternalLink className="h-4 w-4" /> Share
                  </Button>
                </div>
              </div>

              <div className="border-border flex justify-end border-t pt-2">
                <Button variant="primary" size="sm" onClick={() => setShowCredentials(false)}>
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
