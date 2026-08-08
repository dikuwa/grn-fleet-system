'use client';

import { use, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SearchableEntitySelect } from '@/components/ui/searchable-entity-select';
import { StyledDateInput, StyledSelect } from '@/components/ui/styled-select';
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Database,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Plus,
  RotateCcw,
  Shield,
  Trash2,
  User,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/lib/use-toast';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';
import { getEmployeeStatusDisplay } from '@/lib/employee-status';

interface RoleAssignment {
  id: string;
  roleId: string;
  roleName: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  isActing: boolean;
  delegatedByUserId: string | null;
  reason: string | null;
}

interface UserDetail {
  id: string;
  email: string;
  username: string | null;
  name: string | null;
  emailVerified: boolean;
  tenantStatus: string;
  joinedAt: string | null;
  roleAssignments: RoleAssignment[];
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

const STATUS_CONFIG: Record<string, {
  label: string;
  variant: 'success' | 'error' | 'pending' | 'cancelled' | 'info';
  icon: React.ReactNode;
  description: string;
}> = {
  active: {
    label: 'Active',
    variant: 'success',
    icon: <CheckCircle2 className="h-4 w-4" />,
    description: 'User can sign in and use the permissions granted by their active roles.',
  },
  pending_activation: {
    label: 'Pending Activation',
    variant: 'pending',
    icon: <Clock className="h-4 w-4" />,
    description: 'The account exists but activation has not been completed.',
  },
  suspended: {
    label: 'Suspended',
    variant: 'error',
    icon: <Ban className="h-4 w-4" />,
    description: 'User access is suspended.',
  },
  disabled: {
    label: 'Disabled',
    variant: 'cancelled',
    icon: <XCircle className="h-4 w-4" />,
    description: 'The account is disabled by the security/profile layer and cannot be changed from tenant membership status.',
  },
  locked: {
    label: 'Locked',
    variant: 'error',
    icon: <Lock className="h-4 w-4" />,
    description: 'The account is locked by the security policy and cannot be changed from tenant membership status.',
  },
  access_removed: {
    label: 'Removed',
    variant: 'cancelled',
    icon: <XCircle className="h-4 w-4" />,
    description: 'Login access was removed. The staff record is preserved and access can be restored.',
  },
};

const STATUS_OPTIONS = ['active', 'suspended', 'pending_activation'] as const;

export default function AdminUserDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();

  const [editName, setEditName] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [roleStartDate, setRoleStartDate] = useState('');
  const [roleEndDate, setRoleEndDate] = useState('');
  const [resetResult, setResetResult] = useState<{ tempPassword: string; message: string } | null>(null);
  const [showResetResult, setShowResetResult] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [showDelegate, setShowDelegate] = useState(false);
  const [delegateUserId, setDelegateUserId] = useState('');
  const [delegateRoleId, setDelegateRoleId] = useState('');
  const [delegateStartDate, setDelegateStartDate] = useState('');
  const [delegateEndDate, setDelegateEndDate] = useState('');
  const [delegateReason, setDelegateReason] = useState('');

  const { data: delegateUsers } = useQuery({
    queryKey: ['admin-users-delegate', id],
    queryFn: async () => {
      const res = await fetch('/api/admin/users?limit=100');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Unable to load tenant users');
      return (json.data?.users || []).filter(
        (candidate: { id: string; tenantStatus: string }) =>
          candidate.id !== id && ['active', 'pending_activation'].includes(candidate.tenantStatus),
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

  useEffect(() => {
    if (!userData) return;
    setEditName(userData.name || '');
    setSelectedStatus(userData.tenantStatus);
  }, [userData]);

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
      setCopiedPassword(false);
      setShowResetResult(true);
      toast({ title: 'Password reset', description: 'A temporary password was generated.', variant: 'success' });
    } catch (err) {
      toast({ title: 'Reset failed', description: err instanceof Error ? err.message : 'Failed to reset password', variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const copyPassword = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPassword(true);
      window.setTimeout(() => setCopiedPassword(false), 1800);
      toast({ title: 'Copied', description: 'Temporary password copied.', variant: 'success' });
    } catch {
      toast({ title: 'Copy failed', description: 'Clipboard access is unavailable.', variant: 'error' });
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
      await refetch();
      toast({ title: 'Name updated', description: 'User name saved.', variant: 'success' });
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
      await refetch();
      toast({
        title: 'Status updated',
        description: `Status changed to ${STATUS_CONFIG[newStatus]?.label || newStatus}.`,
        variant: 'success',
      });
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
      await refetch();
      toast({ title: 'Role assigned', description: 'Role added to this user.', variant: 'success' });
    } catch (err) {
      toast({ title: 'Role assignment failed', description: err instanceof Error ? err.message : 'Failed to add role', variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveFromOrganisation = async () => {
    const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (!res.ok) {
      const message = json.error || 'Failed to remove user';
      toast({ title: 'Remove failed', description: message, variant: 'error' });
      throw new Error(message);
    }
    toast({
      title: 'User access removed',
      description: `${userData?.name || userData?.email || 'User'} was removed from User Management. The staff record is preserved.`,
      variant: 'success',
    });
    router.push('/dashboard/admin/users');
  };

  const handleRestoreUser = async () => {
    const res = await fetch(`/api/admin/users/${id}/restore`, { method: 'POST' });
    const json = await res.json();
    if (!res.ok) {
      const message = json.error || 'Failed to restore user';
      toast({ title: 'Restore failed', description: message, variant: 'error' });
      throw new Error(message);
    }
    toast({
      title: 'User access restored',
      description: `${userData?.name || userData?.email || 'User'} can sign in again. The staff record is unchanged.`,
      variant: 'success',
    });
    await refetch();
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
      await refetch();
      toast({ title: 'Role removed', description: 'The role assignment ended successfully.', variant: 'success' });
    } catch (err) {
      toast({ title: 'Role removal failed', description: err instanceof Error ? err.message : 'Failed to remove role', variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

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
      await refetch();
      toast({ title: 'Delegation created', description: 'The acting role assignment was created.', variant: 'success' });
    } catch (err) {
      toast({ title: 'Delegation failed', description: err instanceof Error ? err.message : 'Failed to create delegation', variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="text-ink-500 flex items-center justify-center gap-2 py-16 text-sm" role="status">
        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading user details…
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'User Management', href: '/dashboard/admin/users' }, { label: 'User' }]} />
        <PageHeader title="User Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title={error instanceof Error ? error.message : 'Failed to load user'} action={{ label: 'Retry', onClick: () => void refetch() }} />
      </div>
    );
  }

  if (!userData) return null;

  const activeRoleAssignments = userData.roleAssignments.filter((assignment) => assignment.isActive);
  const permanentActiveRoles = activeRoleAssignments.filter((assignment) => !assignment.isActing);
  const rolesNotAssigned = userData.availableRoles.filter(
    (role) => !activeRoleAssignments.some((assignment) => assignment.roleId === role.id),
  );
  const statusConf = STATUS_CONFIG[userData.tenantStatus] || STATUS_CONFIG.active;
  const employeeDisplay = userData.linkedEmployee
    ? getEmployeeStatusDisplay(userData.linkedEmployee.employmentStatus)
    : null;
  const membershipStatusEditable = STATUS_OPTIONS.includes(userData.tenantStatus as (typeof STATUS_OPTIONS)[number]);

  return (
    <div className="space-y-5 sm:space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'User Management', href: '/dashboard/admin/users' },
        { label: userData.name || userData.email },
      ]} />
      <PageHeader title={userData.name || 'Unnamed User'} description={userData.email}>
        <Button variant="secondary" size="sm" asChild className="w-full sm:w-auto">
          <Link href="/dashboard/admin/users"><ChevronLeft className="h-4 w-4" /> Back to Users</Link>
        </Button>
      </PageHeader>

      <div className="border-border bg-surface rounded-[10px] border p-4 sm:p-5">
        <div className="flex items-start gap-3 sm:gap-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[9px] ${
            statusConf.variant === 'success'
              ? 'bg-status-success-bg text-status-success-text'
              : statusConf.variant === 'pending'
                ? 'bg-status-pending-bg text-status-pending-text'
                : statusConf.variant === 'error'
                  ? 'bg-status-error-bg text-status-error-text'
                  : 'bg-muted text-ink-500'
          }`}>
            {statusConf.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="text-ink-950 min-w-0 break-words text-base font-semibold sm:text-lg">{userData.name || 'Unnamed user'}</h2>
              <Badge variant={statusConf.variant} size="sm">{statusConf.label}</Badge>
              {userData.emailVerified && <Badge variant="info" size="sm">Email verified</Badge>}
            </div>
            <div className="text-ink-500 mt-2 grid gap-1.5 text-xs sm:grid-cols-2 xl:grid-cols-4">
              <span className="flex min-w-0 items-start gap-1.5"><Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0 break-all">{userData.email}</span></span>
              {userData.username && <span className="flex min-w-0 items-start gap-1.5"><User className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0 break-all">{userData.username}</span></span>}
              {userData.joinedAt && <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />Joined {formatDate(userData.joinedAt)}</span>}
              <span className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" />{activeRoleAssignments.length} active role{activeRoleAssignments.length === 1 ? '' : 's'}</span>
            </div>
          </div>
        </div>
      </div>

      {userData.linkedEmployee && employeeDisplay && (
        <div className="border-border bg-surface rounded-[10px] border p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="bg-brand-50 text-brand-800 flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] text-sm font-semibold dark:bg-brand-950/30 dark:text-brand-300">
                {userData.linkedEmployee.firstName.charAt(0)}{userData.linkedEmployee.lastName.charAt(0)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-ink-950 text-sm font-medium">{userData.linkedEmployee.firstName} {userData.linkedEmployee.lastName}</p>
                  <Badge variant={employeeDisplay.variant} size="sm">{employeeDisplay.label}</Badge>
                </div>
                <div className="text-ink-500 mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span>{userData.linkedEmployee.employeeNumber}</span>
                  {userData.linkedEmployee.officeName && <span>{userData.linkedEmployee.officeName}</span>}
                  {userData.linkedEmployee.departmentName && <span>{userData.linkedEmployee.departmentName}</span>}
                </div>
                <p className="text-ink-400 mt-1 text-xs">User access and Staff Management remain separate records.</p>
              </div>
            </div>
            <Button variant="secondary" size="sm" asChild className="w-full shrink-0 sm:w-auto">
              <Link href={`/dashboard/staff/${userData.linkedEmployee.id}`}>View Employee <ChevronRight className="h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input value={editName} onChange={(event) => setEditName(event.target.value)} className="min-w-0 flex-1" />
                <Button variant="primary" size="sm" onClick={() => void handleUpdateName()} loading={isSaving} className="w-full sm:w-auto">Save Name</Button>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0"><Label>Email</Label><p className="text-ink-700 mt-1 break-all text-sm">{userData.email}</p></div>
              <div className="min-w-0"><Label>Username</Label><p className="text-ink-700 mt-1 break-all text-sm">{userData.username || 'Not set'}</p></div>
            </div>
            <div className="min-w-0"><Label>User ID</Label><p className="text-ink-500 mt-1 break-all font-mono text-xs">{userData.id}</p></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle>Account Access</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Status</Label>
              {membershipStatusEditable ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <StyledSelect value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)} aria-label="Account status">
                    {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{STATUS_CONFIG[status].label}</option>)}
                  </StyledSelect>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void handleUpdateStatus(selectedStatus)}
                    loading={isSaving}
                    disabled={selectedStatus === userData.tenantStatus}
                    className="w-full sm:w-auto"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Apply Status
                  </Button>
                </div>
              ) : (
                <div className="border-border bg-muted/30 rounded-[8px] border px-3 py-2.5 text-sm text-ink-600">
                  {statusConf.label} is controlled by the account security/profile layer, not tenant membership status.
                </div>
              )}
              <p className="text-ink-500 text-xs leading-5">{statusConf.description}</p>
            </div>

            <div className="border-border flex flex-col gap-2 border-t pt-4 sm:flex-row sm:flex-wrap">
              <Button variant="secondary" size="sm" onClick={() => void handlePasswordReset()} loading={isSaving} className="w-full sm:w-auto"><KeyRound className="h-4 w-4" /> Reset Password</Button>
              <Button variant="secondary" size="sm" onClick={() => setShowDelegate(true)} disabled={permanentActiveRoles.length === 0} className="w-full sm:w-auto"><UserPlus className="h-4 w-4" /> Delegate Role</Button>
            </div>

            <div className="border-border border-t pt-4">
              {userData.tenantStatus === 'access_removed' ? (
                <>
                  <Button variant="primary" size="sm" onClick={() => setShowRestoreConfirm(true)} className="w-full sm:w-auto"><RotateCcw className="h-4 w-4" /> Restore User Access</Button>
                  <p className="text-ink-500 mt-2 text-xs leading-5">Restoring login access does not change the Staff Directory record. Roles may need to be assigned again.</p>
                </>
              ) : activeRoleAssignments.length === 0 ? (
                <>
                  <Button variant="destructive" size="sm" onClick={() => setShowRemoveConfirm(true)} className="w-full sm:w-auto"><Trash2 className="h-4 w-4" /> Remove User Access</Button>
                  <p className="text-ink-500 mt-2 text-xs leading-5">Login access and pending invitations are removed. Historical and future role records are preserved with the staff record.</p>
                </>
              ) : (
                <p className="text-ink-500 flex items-start gap-2 text-xs leading-5"><AlertTriangle className="text-status-warning-text mt-0.5 h-3.5 w-3.5 shrink-0" />Remove the {activeRoleAssignments.length} active role assignment{activeRoleAssignments.length === 1 ? '' : 's'} first. Historical and future-dated role records do not block removal.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle>Role Assignments</CardTitle></CardHeader>
        <CardContent>
          {userData.roleAssignments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Shield className="text-ink-300 mb-2 h-8 w-8" />
              <p className="text-ink-700 text-sm font-medium">No role history</p>
              <p className="text-ink-500 mt-1 text-xs">Assign a role to grant workspace responsibilities.</p>
            </div>
          ) : (
            <div className="border-border overflow-hidden rounded-[8px] border">
              {userData.roleAssignments.map((assignment) => (
                <div key={assignment.id} className={`border-border flex flex-col gap-3 border-b p-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:p-4 ${assignment.isActing && assignment.isActive ? 'bg-status-pending-bg/40' : !assignment.isActive ? 'bg-muted/20' : ''}`}>
                  <div className="flex min-w-0 items-start gap-3">
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] ${assignment.isActing && assignment.isActive ? 'bg-status-pending-bg text-status-pending-text' : assignment.isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-300' : 'bg-muted text-ink-400'}`}>
                      {assignment.isActing ? <UserPlus className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-ink-950 text-sm font-medium">{assignment.roleName}</span>
                        {assignment.isActing && <Badge variant="pending" size="sm">Acting</Badge>}
                        <Badge variant={assignment.isActive ? 'success' : 'default'} size="sm">{assignment.isActive ? 'Active' : 'Historical / scheduled'}</Badge>
                      </div>
                      <div className="text-ink-500 mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        <span>Starts {formatDate(assignment.startDate)}</span>
                        {assignment.endDate && <span>Ends {formatDate(assignment.endDate)}</span>}
                      </div>
                      {assignment.reason && <p className="text-ink-500 mt-1 break-words text-xs">{assignment.reason}</p>}
                    </div>
                  </div>
                  {assignment.isActive && (
                    <Button variant="ghost" size="sm" className="text-status-error-text w-full sm:w-auto" onClick={() => void handleRemoveRole(assignment.id)} disabled={isSaving}><Trash2 className="h-4 w-4" /> End Role</Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {rolesNotAssigned.length > 0 && userData.tenantStatus !== 'access_removed' && (
            <div className="border-border mt-5 space-y-4 border-t pt-4">
              <p className="text-ink-500 text-xs font-medium uppercase tracking-wider">Assign New Role</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_11rem_auto] lg:items-end">
                <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                  <Label>Role</Label>
                  <StyledSelect value={selectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value)} aria-label="Role to assign">
                    <option value="">Select a role…</option>
                    {rolesNotAssigned.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                  </StyledSelect>
                </div>
                <div className="space-y-1.5"><Label>Start Date</Label><StyledDateInput type="date" value={roleStartDate} onChange={(event) => setRoleStartDate(event.target.value)} /></div>
                <div className="space-y-1.5"><Label>End Date <span className="text-ink-400 font-normal">(optional)</span></Label><StyledDateInput type="date" value={roleEndDate} onChange={(event) => setRoleEndDate(event.target.value)} /></div>
                <Button variant="primary" size="sm" onClick={() => void handleAddRole()} loading={isSaving} disabled={!selectedRoleId} className="w-full lg:w-auto"><Plus className="h-4 w-4" /> Assign Role</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={showRestoreConfirm}
        onOpenChange={setShowRestoreConfirm}
        title="Restore user access?"
        description={`Restore login access for ${userData.name || userData.email}? The staff record remains unchanged; roles may need to be assigned again.`}
        confirmLabel="Restore access"
        onConfirm={handleRestoreUser}
      />

      <ConfirmDialog
        open={showRemoveConfirm}
        onOpenChange={setShowRemoveConfirm}
        title="Remove user access?"
        description={`Remove ${userData.name || userData.email} from User Management? Login access and pending invitations are removed, while the Staff Directory employee record and role history are preserved.`}
        confirmLabel="Remove access"
        variant="destructive"
        onConfirm={handleRemoveFromOrganisation}
      />

      <Dialog open={showDelegate} onOpenChange={setShowDelegate}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Delegate Role</DialogTitle>
            <DialogDescription>Temporarily assign one of this user&apos;s active permanent roles to another active or pending tenant user. The substantive role remains unchanged.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label required>Target User</Label>
              <SearchableEntitySelect
                value={delegateUserId}
                ariaLabel="Search tenant user for delegation"
                placeholder="Search user name or email…"
                emptyLabel="No eligible tenant user matches this search."
                options={(delegateUsers || []).map((candidate) => ({
                  id: candidate.id,
                  label: candidate.name || candidate.email,
                  description: candidate.email,
                  searchText: `${candidate.name || ''} ${candidate.email}`,
                  status: candidate.tenantStatus === 'pending_activation' ? 'Pending activation' : 'Active',
                }))}
                onChange={(option) => setDelegateUserId(option?.id || '')}
              />
            </div>
            <div className="space-y-1.5">
              <Label required>Role to Delegate</Label>
              <StyledSelect value={delegateRoleId} onChange={(event) => setDelegateRoleId(event.target.value)} aria-label="Role to delegate">
                <option value="">Select an active permanent role…</option>
                {permanentActiveRoles.map((assignment) => <option key={assignment.id} value={assignment.roleId}>{assignment.roleName}</option>)}
              </StyledSelect>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Start Date</Label><StyledDateInput type="date" value={delegateStartDate} onChange={(event) => setDelegateStartDate(event.target.value)} /></div>
              <div className="space-y-1.5"><Label>End Date <span className="text-ink-400 font-normal">(optional)</span></Label><StyledDateInput type="date" value={delegateEndDate} onChange={(event) => setDelegateEndDate(event.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label>Reason <span className="text-ink-400 font-normal">(optional)</span></Label><Textarea value={delegateReason} onChange={(event) => setDelegateReason(event.target.value)} placeholder="e.g. Annual leave cover" rows={3} /></div>
            <div className="mobile-action-bar border-border flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
              <Button variant="secondary" size="sm" onClick={() => setShowDelegate(false)} className="w-full sm:w-auto">Cancel</Button>
              <Button variant="primary" size="sm" onClick={() => void handleDelegate()} loading={isSaving} disabled={!delegateUserId || !delegateRoleId} className="w-full sm:w-auto"><UserPlus className="h-4 w-4" /> Create Delegation</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showResetResult} onOpenChange={setShowResetResult}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Password Reset Successful</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="border-status-success-text/20 bg-status-success-bg text-status-success-text rounded-[8px] border p-3 text-sm">
              <p className="font-medium">Temporary password generated</p>
              <p className="mt-1 text-xs leading-5">Share it securely. The user must change it on the next sign-in.</p>
            </div>
            {resetResult && (
              <div className="border-border bg-muted/30 rounded-[8px] border p-3">
                <p className="text-ink-500 mb-1 text-xs font-medium">Temporary Password</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <code className="text-ink-950 min-w-0 break-all font-mono text-base font-bold tracking-wider">{resetResult.tempPassword}</code>
                  <Button variant="secondary" size="sm" onClick={() => void copyPassword(resetResult.tempPassword)} className="w-full shrink-0 sm:w-auto">
                    {copiedPassword ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copiedPassword ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
            )}
            <div className="mobile-action-bar flex justify-end"><Button variant="primary" size="sm" onClick={() => setShowResetResult(false)} className="w-full sm:w-auto"><CheckCheck className="h-4 w-4" /> Done</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
