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
import { StyledSelect } from '@/components/ui/styled-select';
import {
  Users, Search, ChevronRight, Mail, Loader2, Send, CheckCircle2, XCircle,
  RotateCcw, Ban, User, Copy, Download, ExternalLink, Smartphone,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';

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

function PendingInviteRow({
  invite,
  onAction,
}: {
  invite: PendingInvite;
  onAction: () => void;
}) {
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
      toast({ title: 'Invite Resent', description: `Invitation re-sent to ${invite.email}.`, variant: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to resend';
      setResult(msg);
      toast({ title: 'Resend Failed', description: msg, variant: 'error' });
    } finally {
      setLoading(null);
    }
  }, [invite.id, onAction]);

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
      toast({ title: 'Invite Revoked', description: `Invitation for ${invite.email} has been revoked.`, variant: 'default' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to revoke';
      setResult(msg);
      toast({ title: 'Revoke Failed', description: msg, variant: 'error' });
    } finally {
      setLoading(null);
    }
  }, [invite.id, onAction]);

  return (
    <>
      <div className="flex items-center justify-between px-5 py-3.5 hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700 text-sm font-semibold">
            {(invite.name || invite.email)[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink-950 truncate">
                {invite.name || 'Unnamed'}
              </span>
              <Badge variant="pending" size="sm">Pending</Badge>
              {invite.daysSinceInvite > 7 && (
                <Badge variant="error" size="sm">Expired</Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <Mail className="h-3 w-3 text-ink-400" />
              <span className="text-xs text-ink-500">{invite.email}</span>
              <span className="text-xs text-ink-400">
                · {invite.daysSinceInvite}d ago
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {result && (
            <span className="text-xs text-ink-500 mr-2 max-w-[160px] truncate">{result}</span>
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
          <p className="text-sm text-ink-700">
            Are you sure you want to revoke the invitation for <strong>{invite.email}</strong>?
            This will suspend their access and prevent them from logging in.
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
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [inviteEmployeeId, setInviteEmployeeId] = useState('');
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [inviteResult, setInviteResult] = useState<{ success: boolean; emailSent: boolean; message: string } | null>(null);
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
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'pending'>('all');
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-users', searchQuery, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      params.set('page', String(page));
      params.set('limit', '25');

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
    setInviteRoleId('');
    setInviteEmployeeId('');
    setShowInvite(true);

    try {
      const res = await fetch('/api/admin/roles');
      if (res.ok) {
        const json = await res.json();
        const roleList = json.data?.roles || json.roles || [];
        setRoles(Array.isArray(roleList) ? roleList : []);
      }
    } catch { /* silent */ }
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
          roleId: inviteRoleId || undefined,
          employeeId: inviteEmployeeId,
          sendInvite: true,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to invite user');

      setInviteResult({
        success: true,
        emailSent: json.emailSent,
        message: json.emailSent
          ? `Invitation sent to ${inviteEmail.trim()}.`
          : `User created. RESEND_API_KEY not configured — provide password to user manually.`,
      });

      // Show credential dialog if we have credentials
      if (json.data?.credentials) {
        setCredentialData(json.data.credentials);
        setShowCredentials(true);
      }

      setInviteEmail('');
      setInviteName('');
      setInviteUsername('');
      setInviteRoleId('');
      setInviteEmployeeId('');
      refetch();
      toast({ title: 'User Invited', description: `Invitation sent to ${inviteEmail.trim()}.`, variant: 'success' });
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

  const loadPendingInvites = useCallback(async () => {
    setLoadingInvites(true);
    try {
      const res = await fetch('/api/admin/invites?status=pending');
      if (res.ok) {
        const json = await res.json();
        setPendingInvites(json.data?.invites || []);
      }
    } catch { /* silent */ } finally {
      setLoadingInvites(false);
    }
  }, []);

  const handleTabChange = (tab: 'all' | 'active' | 'pending') => {
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
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Administration', href: '/dashboard' },
        { label: 'User Management' },
      ]} />
      <PageHeader
        title="User Management"
        description={`${total} user${total !== 1 ? 's' : ''} in your organisation`}
      >
        <Button variant="primary" size="sm" onClick={openInviteDialog}>
          <Send className="h-4 w-4" /> Invite User
        </Button>
      </PageHeader>

      {/* Tabs: All | Active | Pending Invites */}
      <div className="flex gap-1 border-b border-border">
        {(['all', 'active', 'pending'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-ink-500 hover:text-ink-700 hover:border-ink-300'
            }`}
          >
            {tab === 'all' ? 'All Users' : tab === 'active' ? 'Active' : 'Pending Invites'}
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
              <StyledSelect
                value={inviteEmployeeId}
                onChange={(event) => {
                  const employeeId = event.target.value;
                  setInviteEmployeeId(employeeId);
                  const employee = availableEmployees.find((item) => item.id === employeeId);
                  if (employee) {
                    setInviteName(`${employee.firstName} ${employee.lastName}`);
                    if (employee.email) setInviteEmail(employee.email);
                  }
                }}
              >
                <option value="">Select an employee...</option>
                {availableEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.employeeNumber} — {employee.firstName} {employee.lastName} ({employee.officeName || 'No office'})
                  </option>
                ))}
              </StyledSelect>
              <p className="text-xs text-ink-500">Accounts must be linked to an active employee record.</p>
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
              <p className="text-xs text-ink-500">Username is used for login. Generated from name if left empty.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <StyledSelect
                value={inviteRoleId}
                onChange={(e) => setInviteRoleId(e.target.value)}
              >
                <option value="">No role</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </StyledSelect>
            </div>

            {inviteResult && (
              <div className={`flex items-start gap-2 rounded-[8px] border p-3 text-sm ${
                inviteResult.success
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}>
                {inviteResult.success
                  ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                  : <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                <span>{inviteResult.message}</span>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowInvite(false)}>Close</Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleInvite}
                loading={isInviting}
                disabled={!inviteEmployeeId || !inviteEmail.trim() || isInviting}
              >
                <Send className="h-4 w-4" /> Send Invitation
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Search (hidden on pending tab) */}
      {activeTab !== 'pending' && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-status-error-text">{error instanceof Error ? error.message : 'Failed to load users'}</p>
            <Button variant="secondary" size="sm" onClick={() => refetch()} className="mt-2">Retry</Button>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {(isLoading || (activeTab === 'pending' && loadingInvites)) && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
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
                <div className="divide-y divide-border">
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
          description={searchQuery ? 'Try a different search term.' : 'Invite your first user to get started.'}
        />
      )}

      {/* User List (non-pending tabs) */}
      {!isLoading && users.length > 0 && activeTab !== 'pending' && (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => router.push(`/dashboard/admin/users/${u.id}`)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-ink-700">
                      {(u.name || u.email)[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink-950 truncate">
                          {u.name || 'Unnamed'}
                        </span>
                        <Badge variant={
                          u.tenantStatus === 'active' ? 'success' :
                          u.tenantStatus === 'suspended' ? 'error' : 'cancelled'
                        } size="sm">{u.tenantStatus}</Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Mail className="h-3 w-3 text-ink-400" />
                        <span className="text-xs text-ink-500">{u.email}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {u.roles.length > 0 && (
                      <div className="hidden sm:flex items-center gap-1">
                        {u.roles.slice(0, 2).map((r) => (
                          <Badge key={r.id} variant="info" size="sm">
                            {r.isActing ? `${r.roleName} (acting)` : r.roleName}
                          </Badge>
                        ))}
                        {u.roles.length > 2 && (
                          <span className="text-xs text-ink-400">+{u.roles.length - 2}</span>
                        )}
                      </div>
                    )}
                    <ChevronRight className="h-4 w-4 text-ink-400" />
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
          <p className="text-xs text-ink-500">
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
      {/* Credential Sharing Dialog */}
      <Dialog open={showCredentials} onOpenChange={setShowCredentials}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>User Account Created</DialogTitle>
          </DialogHeader>

          {credentialData && (
            <div className="space-y-4">
              <div className="rounded-[8px] border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800/40 dark:bg-green-950/20 dark:text-green-300">
                <CheckCircle2 className="h-4 w-4 inline mr-1" />
                Account created successfully. Share the credentials below with the user.
              </div>

              {/* Formatted Credential Block */}
              <div className="rounded-[8px] border border-border bg-muted p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap relative group">
                <button
                  onClick={async () => {
                    const text = `--------------------------------\n\nWelcome to GRN Fleet Management\n\nName:\n${credentialData.fullName}\n\nUsername:\n${credentialData.username}\n\nTemporary Password:\n${credentialData.tempPassword}\n\nRole:\n${credentialData.roleName}\n\nLogin URL:\n${credentialData.loginUrl}\n\nPlease change your password after your first login.\n\n--------------------------------`;
                    try {
                      await navigator.clipboard.writeText(text);
                      setCopied('full');
                      setTimeout(() => setCopied(null), 2000);
                      toast({ title: 'Copied', description: 'Full credentials copied to clipboard.', variant: 'success' });
                    } catch {
                      toast({ title: 'Copy Failed', description: 'Unable to copy to clipboard.', variant: 'error' });
                    }
                  }}
                  className="absolute top-2 right-2 flex items-center gap-1 rounded-[4px] bg-surface border border-border px-2 py-1 text-xs font-sans text-ink-500 hover:text-ink-700 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {copied === 'full' ? (
                    <><CheckCircle2 className="h-3 w-3" /> Copied</>
                  ) : (
                    <><Copy className="h-3 w-3" /> Copy All</>
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
                <span className="text-ink-950 font-bold tracking-wider">{credentialData.tempPassword}</span>
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
                <span className="text-ink-400 italic">Please change your password after your first login.</span>
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
                      toast({ title: 'Copied', description: 'Password copied.', variant: 'success' });
                    } catch {
                      toast({ title: 'Copy Failed', description: 'Unable to copy.', variant: 'error' });
                    }
                  }}
                >
                  {copied === 'password' ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
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
                      toast({ title: 'Copied', description: 'Username copied.', variant: 'success' });
                    } catch {
                      toast({ title: 'Copy Failed', description: 'Unable to copy.', variant: 'error' });
                    }
                  }}
                >
                  {copied === 'username' ? <CheckCircle2 className="h-4 w-4" /> : <User className="h-4 w-4" />}
                  Copy Username
                </Button>
              </div>

              {/* Share Options */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-ink-500 uppercase tracking-wider">Share Credentials</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {/* WhatsApp Share */}
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      const message = encodeURIComponent(
                        `Welcome to GRN Fleet Management\n\nName: ${credentialData.fullName}\nUsername: ${credentialData.username}\nTemporary Password: ${credentialData.tempPassword}\nLogin: ${credentialData.loginUrl}\n\nPlease change your password after first login.`
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
                        `Welcome to GRN Fleet Management\n\nName: ${credentialData.fullName}\nUsername: ${credentialData.username}\nTemporary Password: ${credentialData.tempPassword}\nRole: ${credentialData.roleName}\nLogin URL: ${credentialData.loginUrl}\n\nPlease change your password after your first login.`
                      );
                      window.open(`mailto:${credentialData.email}?subject=${subject}&body=${body}`, '_blank');
                    }}
                    disabled={!credentialData.email}
                    title={!credentialData.email ? 'No email address available' : 'Open email client'}
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
                        toast({ title: 'Link Copied', description: 'Share link copied to clipboard.', variant: 'success' });
                      }
                    }}
                  >
                    <ExternalLink className="h-4 w-4" /> Share
                  </Button>
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t border-border">
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
