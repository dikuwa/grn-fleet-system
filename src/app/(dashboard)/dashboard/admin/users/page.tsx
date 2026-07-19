'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Users, Search, Plus, ChevronRight, Mail, Loader2, Send, CheckCircle2, XCircle,
} from 'lucide-react';

interface TenantUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  tenantStatus: string;
  joinedAt: string | null;
  roles: Array<{ id: string; roleName: string; isActing: boolean }>;
}

interface RoleOption {
  id: string;
  name: string;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');

  // Invite dialog
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [inviteResult, setInviteResult] = useState<{ success: boolean; emailSent: boolean; message: string } | null>(null);
  const [isInviting, setIsInviting] = useState(false);

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
  const total: number = data?.total ?? 0;
  const totalPages: number = data?.totalPages ?? 1;

  const openInviteDialog = async () => {
    setInviteResult(null);
    setInviteEmail('');
    setInviteName('');
    setInviteRoleId('');
    setShowInvite(true);

    // Fetch available roles
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
          roleId: inviteRoleId || undefined,
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

      setInviteEmail('');
      setInviteName('');
      setInviteRoleId('');
      refetch();
    } catch (err) {
      setInviteResult({
        success: false,
        emailSent: false,
        message: err instanceof Error ? err.message : 'Failed to invite user',
      });
    } finally {
      setIsInviting(false);
    }
  };

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

      {/* Invite Dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
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
              <Label>Role</Label>
              <select
                value={inviteRoleId}
                onChange={(e) => setInviteRoleId(e.target.value)}
                className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                <option value="">No role</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>

            {inviteResult && (
              <div className={`flex items-start gap-2 rounded-[8px] border p-3 text-sm ${
                inviteResult.success
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}>
                {inviteResult.success ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
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
                disabled={!inviteEmail.trim() || isInviting}
              >
                <Send className="h-4 w-4" /> Send Invitation
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <Input
          placeholder="Search by name or email..."
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          className="pl-9"
        />
      </div>

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
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && users.length === 0 && (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="No users found"
          description={searchQuery ? 'Try a different search term.' : 'Invite your first user to get started.'}
        />
      )}

      {/* User List */}
      {!isLoading && users.length > 0 && (
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
      {totalPages > 1 && (
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
    </div>
  );
}
