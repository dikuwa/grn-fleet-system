'use client';

import { useState, use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { StyledDateInput, StyledSelect } from '@/components/ui/styled-select';
import {
  User, Mail, Shield, CalendarDays, Loader2, ChevronLeft, ChevronRight, CheckCircle2, XCircle,
  Plus, Trash2, Database, KeyRound, Copy, CheckCheck, UserPlus,
  Clock, Lock, Ban,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';
import { getEmployeeStatusDisplay } from '@/lib/employee-status';

interface UserDetail {
  id: string;
  email: string;
  username: string | null;
  name: string | null;
  emailVerified: boolean;
  tenantStatus: string;
  joinedAt: string | null;
  roleAssignments: Array<{
    id: string;
    roleId: string;
    roleName: string;
    startDate: string;
    endDate: string | null;
    isActing: boolean;
    delegatedByUserId: string | null;
    reason: string | null;
  }>;
  availableRoles: Array<{
    id: string;
    name: string;
    description: string | null;
  }>;
  image: string | null;
  linkedEmployee: {
    id: string;
    employeeNumber: string;
    firstName: string;
    lastName: string;
    email: string | null;
    employmentStatus: string;
    jobTitle: string | null;
    departmentId: string | null;
    departmentName: string | null;
    officeId: string | null;
    officeName: string | null;
    isDriver: boolean;
  } | null;
}

interface TenantUser {
  id: string;
  email: string;
  name: string | null;
  tenantStatus: string;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'success' | 'error' | 'pending' | 'cancelled' | 'info'; icon: React.ReactNode; description: string }> = {
  active: {
    label: 'Active',
    variant: 'success',
    icon: <CheckCircle2 className="h-4 w-4" />,
    description: 'User can log in and access the system.',
  },
  pending_activation: {
    label: 'Pending Activation',
    variant: 'pending',
    icon: <Clock className="h-4 w-4" />,
    description: 'User has been created but has not yet activated their account.',
  },
  suspended: {
    label: 'Suspended',
    variant: 'error',
    icon: <Ban className="h-4 w-4" />,
    description: 'User is suspended and cannot log in.',
  },
  disabled: {
    label: 'Disabled',
    variant: 'cancelled',
    icon: <XCircle className="h-4 w-4" />,
    description: 'User account has been disabled by an administrator.',
  },
  locked: {
    label: 'Locked',
    variant: 'error',
    icon: <Lock className="h-4 w-4" />,
    description: 'Account locked due to security policy (e.g. too many failed attempts).',
  },
};

const STATUS_OPTIONS = ['active', 'suspended', 'pending_activation', 'disabled', 'locked'] as const;

export default function AdminUserDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { toast } = useToast();
  const [editName, setEditName] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [roleStartDate, setRoleStartDate] = useState('');
  const [roleEndDate, setRoleEndDate] = useState('');
  const [resetResult, setResetResult] = useState<{ tempPassword: string; message: string } | null>(null);
  const [showResetResult, setShowResetResult] = useState(false);

  // Delegation dialog
  const [showDelegate, setShowDelegate] = useState(false);
  const [delegateUserId, setDelegateUserId] = useState('');
  const [delegateRoleId, setDelegateRoleId] = useState('');
  const [delegateStartDate, setDelegateStartDate] = useState('');
  const [delegateEndDate, setDelegateEndDate] = useState('');
  const [delegateReason, setDelegateReason] = useState('');

  // Fetch available users for delegation
  const { data: delegateUsers } = useQuery({
    queryKey: ['admin-users-delegate'],
    queryFn: async () => {
      const res = await fetch('/api/admin/users?limit=100');
      const json = await res.json();
      if (!res.ok) return [];
      // Filter out the current user and include active + pending users
      return (json.data?.users || []).filter(
        (u: { id: string; tenantStatus: string }) => u.id !== id && ['active', 'pending_activation'].includes(u.tenantStatus),
      ) as TenantUser[];
    },
    enabled: showDelegate,
    staleTime: 60_000,
  });

  const { data: userData, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-user', id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load user');
      return json.data as UserDetail;
    },
  });

  // Sync editName & selectedStatus from loaded data
  if (userData && !editName && userData.name) {
    setEditName(userData.name);
  }
  if (userData && !selectedStatus) {
    setSelectedStatus(userData.tenantStatus);
  }

  const handlePasswordReset = async () => {
    setIsSaving(true);
    setResetResult(null);
    try {
      const res = await fetch('/api/admin/users/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id, forcePasswordChange: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to reset password');
      setResetResult(json.data);
      setShowResetResult(true);
      toast({ title: 'Password Reset', description: 'Temporary password generated.', variant: 'success' });
    } catch (err) {
      toast({ title: 'Reset Failed', description: err instanceof Error ? err.message : 'Failed to reset password', variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copied', description: 'Copied to clipboard.', variant: 'success' });
    } catch {
      toast({ title: 'Copy Failed', description: 'Unable to copy to clipboard.', variant: 'error' });
    }
  };

  const handleUpdateName = async () => {
    if (!editName.trim()) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update');
      toast({ title: 'Name updated', description: 'User name saved successfully', variant: 'success' });
    } catch (err) {
      toast({ title: 'Update failed', description: err instanceof Error ? err.message : 'Failed to update', variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateStatus = async (newStatus: string) => {
    if (!userData || newStatus === userData.tenantStatus) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantStatus: newStatus }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update status');
      setSelectedStatus(newStatus);
      await refetch();
      toast({ title: 'Status Updated', description: `Status changed to ${STATUS_CONFIG[newStatus]?.label || newStatus}.`, variant: 'success' });
    } catch (err) {
      toast({ title: 'Status update failed', description: err instanceof Error ? err.message : 'Failed to update status', variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddRole = async () => {
    if (!selectedRoleId || !userData) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addRoleId: selectedRoleId,
          startDate: roleStartDate || undefined,
          endDate: roleEndDate || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to add role');
      setSelectedRoleId('');
      setRoleStartDate('');
      setRoleEndDate('');
      toast({ title: 'Role assigned', description: 'Role added to user', variant: 'success' });
      refetch();
    } catch (err) {
      toast({ title: 'Failed to add role', description: err instanceof Error ? err.message : 'Failed to add role', variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveRole = async (assignmentId: string) => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeRoleId: assignmentId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to remove role');
      toast({ title: 'Role removed', description: 'Assignment deleted', variant: 'success' });
      refetch();
    } catch (err) {
      toast({ title: 'Failed to remove role', description: err instanceof Error ? err.message : 'Failed to remove role', variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  // Delegation handlers
  const handleDelegate = async () => {
    if (!delegateUserId || !delegateRoleId || !userData) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${id}/delegate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: delegateUserId,
          roleId: delegateRoleId,
          startDate: delegateStartDate || undefined,
          endDate: delegateEndDate || undefined,
          reason: delegateReason.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create delegation');
      setShowDelegate(false);
      setDelegateUserId('');
      setDelegateRoleId('');
      setDelegateStartDate('');
      setDelegateEndDate('');
      setDelegateReason('');
      toast({ title: 'Delegation Created', description: 'Acting role assigned successfully.', variant: 'success' });
      refetch();
    } catch (err) {
      toast({ title: 'Delegation Failed', description: err instanceof Error ? err.message : 'Failed to create delegation', variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'User Management', href: '/dashboard/admin/users' }, { label: 'User' }]} />
        <PageHeader title="User Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title={error instanceof Error ? error.message : 'Failed to load user'} />
        <Button variant="secondary" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  if (!userData) return null;

  const rolesNotAssigned = userData.availableRoles.filter(
    (r) => !userData.roleAssignments.some((a) => a.roleId === r.id),
  );

  const statusConf = STATUS_CONFIG[userData.tenantStatus] || STATUS_CONFIG.active;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'User Management', href: '/dashboard/admin/users' },
        { label: userData.name || userData.email },
      ]} />
      <PageHeader
        title={userData.name || 'Unnamed User'}
        description={userData.email}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/admin/users"><ChevronLeft className="h-4 w-4" /> Back</Link>
        </Button>
      </PageHeader>

      {/* Status Card */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] ${
              userData.tenantStatus === 'active' ? 'bg-status-success-bg text-status-success-text' :
              userData.tenantStatus === 'suspended' ? 'bg-status-error-bg text-status-error-text' :
              userData.tenantStatus === 'locked' ? 'bg-red-100 text-red-700' :
              userData.tenantStatus === 'pending_activation' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' :
              'bg-muted text-ink-400'
            }`}>
              {statusConf.icon}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-ink-950">{userData.name || 'Unnamed'}</h2>
                <Badge variant={statusConf.variant} size="sm">{statusConf.label}</Badge>
                {userData.emailVerified && <Badge variant="info" size="sm">Verified</Badge>}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{userData.email}</span>
                {userData.username && (
                  <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" />{userData.username}</span>
                )}
                {userData.joinedAt && (
                  <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Joined {formatDate(userData.joinedAt)}</span>
                )}
                <span className="flex items-center gap-1"><Shield className="h-3.5 w-3.5" />{userData.roleAssignments.length} role{userData.roleAssignments.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Linked Employee summary — account and staff records stay separate */}
      {userData.linkedEmployee && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="bg-brand-50 text-brand-800 flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] text-sm font-semibold">
                  {userData.linkedEmployee.firstName.charAt(0)}{userData.linkedEmployee.lastName.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="text-ink-950 truncate text-sm font-medium">
                    Linked employee: {userData.linkedEmployee.firstName} {userData.linkedEmployee.lastName}
                  </p>
                  <p className="text-ink-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                    <span>Employee number: {userData.linkedEmployee.employeeNumber}</span>
                    <span>Staff status: <span className="text-status-success-text font-medium">{getEmployeeStatusDisplay(userData.linkedEmployee.employmentStatus).label}</span></span>
                    {userData.linkedEmployee.officeName && <span>Office: {userData.linkedEmployee.officeName}</span>}
                    {userData.linkedEmployee.departmentName && <span>Department: {userData.linkedEmployee.departmentName}</span>}
                  </p>
                </div>
              </div>
              <Button variant="secondary" size="sm" asChild className="shrink-0">
                <Link href={`/dashboard/staff/${userData.linkedEmployee.id}`}>
                  View Employee Profile <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Details Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Profile */}
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <div className="flex gap-2">
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                <Button variant="primary" size="sm" onClick={handleUpdateName} loading={isSaving}>
                  Save
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <p className="text-sm text-ink-700">{userData.email}</p>
            </div>
            <div className="space-y-1.5">
              <Label>Username</Label>
              <p className="text-sm text-ink-700">{userData.username || 'Not set'}</p>
            </div>
            <div className="space-y-1.5">
              <Label>User ID</Label>
              <p className="text-xs font-mono text-ink-500">{userData.id}</p>
            </div>
          </CardContent>
        </Card>

        {/* Account Status */}
        <Card>
          <CardHeader><CardTitle>Account Status</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <div className="flex gap-2">
                <StyledSelect
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                  ))}
                </StyledSelect>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleUpdateStatus(selectedStatus)}
                  loading={isSaving}
                  disabled={selectedStatus === userData.tenantStatus}
                >
                  <CheckCircle2 className="h-4 w-4" /> Apply
                </Button>
              </div>
              <p className="text-xs text-ink-500">{statusConf.description}</p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handlePasswordReset}
                  loading={isSaving}
                >
                  <KeyRound className="h-4 w-4" /> Reset Password
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowDelegate(true)}
                >
                  <UserPlus className="h-4 w-4" /> Delegate
                </Button>
              </div>
            </div>
            {userData.joinedAt && (
              <div className="text-xs text-ink-500">
                Joined: {formatDate(userData.joinedAt)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Role Assignments */}
      <Card>
        <CardHeader>
          <CardTitle>Role Assignments</CardTitle>
        </CardHeader>
        <CardContent>
          {userData.roleAssignments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Shield className="h-8 w-8 text-ink-300 mb-2" />
              <p className="text-sm text-ink-500">No roles assigned</p>
              <p className="text-xs text-ink-400 mt-1">Assign a role to grant this user system permissions.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {userData.roleAssignments.map((assignment) => (
                <div
                  key={assignment.id}
                  className={`flex items-center justify-between rounded-[8px] border p-3 ${
                    assignment.isActing ? 'border-amber-200 bg-amber-50/50 dark:border-amber-800/50 dark:bg-amber-950/20' : 'border-border'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {assignment.isActing ? (
                      <UserPlus className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <Shield className="h-4 w-4 text-brand-600" />
                    )}
                    <div>
                      <span className="text-sm font-medium text-ink-950">{assignment.roleName}</span>
                      {assignment.isActing && (
                        <Badge variant="pending" size="sm" className="ml-2">Acting</Badge>
                      )}
                      {assignment.reason && (
                        <p className="text-xs text-ink-500 mt-0.5">Reason: {assignment.reason}</p>
                      )}
                      {assignment.endDate && (
                        <p className="text-xs text-ink-500">Expires {formatDate(assignment.endDate)}</p>
                      )}
                      {assignment.startDate && (
                        <p className="text-xs text-ink-400">Started {formatDate(assignment.startDate)}</p>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-status-error-text"
                    onClick={() => handleRemoveRole(assignment.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add Role */}
          {rolesNotAssigned.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border space-y-3">
              <p className="text-xs font-medium text-ink-500 uppercase tracking-wider">Assign New Role</p>
              <div className="flex items-center gap-2">
                <StyledSelect
                  value={selectedRoleId}
                  onChange={(e) => setSelectedRoleId(e.target.value)}
                >
                  <option value="">Select a role...</option>
                  {rolesNotAssigned.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </StyledSelect>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-500 mb-1">Start Date</label>
                  <StyledDateInput
                    type="date"
                    value={roleStartDate}
                    onChange={(e) => setRoleStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-500 mb-1">End Date <span className="text-ink-400 font-normal">(optional)</span></label>
                  <StyledDateInput
                    type="date"
                    value={roleEndDate}
                    onChange={(e) => setRoleEndDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleAddRole}
                  loading={isSaving}
                  disabled={!selectedRoleId}
                >
                  <Plus className="h-4 w-4" /> Assign Role
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delegation Dialog */}
      <Dialog open={showDelegate} onOpenChange={setShowDelegate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delegate Role</DialogTitle>
            <DialogDescription>
              Temporarily assign one of {userData.name || 'this user'}&apos;s roles to another user.
              The delegation will appear as an &quot;Acting&quot; assignment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label required>Target User</Label>
              <StyledSelect
                value={delegateUserId}
                onChange={(e) => setDelegateUserId(e.target.value)}
              >
                <option value="">{delegateUsers ? 'Select a user...' : 'Loading users...'}</option>
                {(delegateUsers || []).map((du) => (
                  <option key={du.id} value={du.id}>
                    {du.name || du.email} ({du.tenantStatus === 'pending_activation' ? 'Pending' : 'Active'})
                  </option>
                ))}
              </StyledSelect>
              <p className="text-xs text-ink-500">Select the user who will temporarily act in this role.</p>
            </div>
            <div className="space-y-1.5">
              <Label required>Role to Delegate</Label>
              <StyledSelect
                value={delegateRoleId}
                onChange={(e) => setDelegateRoleId(e.target.value)}
              >
                <option value="">Select a role...</option>
                {userData.roleAssignments
                  .filter((a) => !a.isActing)
                  .map((a) => (
                    <option key={a.id} value={a.roleId}>{a.roleName}</option>
                  ))}
              </StyledSelect>
              <p className="text-xs text-ink-500">Only this user&apos;s permanent roles can be delegated.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <StyledDateInput
                  type="date"
                  value={delegateStartDate}
                  onChange={(e) => setDelegateStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>End Date <span className="text-ink-400 font-normal">(optional)</span></Label>
                <StyledDateInput
                  type="date"
                  value={delegateEndDate}
                  onChange={(e) => setDelegateEndDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Reason <span className="text-ink-400 font-normal">(optional)</span></Label>
              <textarea
                value={delegateReason}
                onChange={(e) => setDelegateReason(e.target.value)}
                placeholder="e.g. On annual leave from 15–30 August 2026"
                className="h-20 w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="secondary" size="sm" onClick={() => setShowDelegate(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleDelegate}
                loading={isSaving}
                disabled={!delegateUserId || !delegateRoleId}
              >
                <UserPlus className="h-4 w-4" /> Create Delegation
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Password Reset Result Dialog */}
      <Dialog open={showResetResult} onOpenChange={setShowResetResult}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Password Reset Successful</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-[8px] border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800/40 dark:bg-green-950/20 dark:text-green-300">
              <p className="font-medium">Temporary Password Generated</p>
              <p className="mt-1 text-xs">Share this temporary password with the user. They will be required to change it on next login.</p>
            </div>

            {resetResult && (
              <div className="space-y-2">
                <div className="rounded-[8px] border border-border bg-muted p-3">
                  <p className="text-xs font-medium text-ink-500 mb-1">Temporary Password</p>
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-lg font-mono font-bold tracking-wider text-ink-950">
                      {resetResult.tempPassword}
                    </code>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => copyToClipboard(resetResult.tempPassword)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="primary" size="sm" onClick={() => setShowResetResult(false)}>
                <CheckCheck className="h-4 w-4" /> Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
