'use client';

import { useState, use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  User, Mail, Shield, CalendarDays, Loader2, ChevronLeft, CheckCircle2, XCircle,
  Plus, Trash2, Database,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';

interface UserDetail {
  id: string;
  email: string;
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
  }>;
  availableRoles: Array<{
    id: string;
    name: string;
    description: string | null;
  }>;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function AdminUserDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { toast } = useToast();
  const [editName, setEditName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState('');

  const { data: userData, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-user', id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load user');
      return json.data as UserDetail;
    },
  });

  // Sync editName from loaded data
  if (userData && !editName && userData.name) {
    setEditName(userData.name);
  }

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

  const handleToggleStatus = async () => {
    if (!userData) return;
    const newStatus = userData.tenantStatus === 'active' ? 'suspended' : 'active';
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
      toast({ title: `User ${newStatus === 'active' ? 'activated' : 'suspended'}`, description: `Status changed to ${newStatus}`, variant: 'success' });
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
        body: JSON.stringify({ addRoleId: selectedRoleId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to add role');
      setSelectedRoleId('');
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
              'bg-muted text-ink-400'
            }`}>
              {userData.tenantStatus === 'active' ? <CheckCircle2 className="h-7 w-7" /> :
               userData.tenantStatus === 'suspended' ? <XCircle className="h-7 w-7" /> :
               <User className="h-7 w-7" />}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-ink-950">{userData.name || 'Unnamed'}</h2>
                <Badge variant={
                  userData.tenantStatus === 'active' ? 'success' :
                  userData.tenantStatus === 'suspended' ? 'error' : 'cancelled'
                } size="sm">{userData.tenantStatus}</Badge>
                {userData.emailVerified && <Badge variant="info" size="sm">Verified</Badge>}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{userData.email}</span>
                {userData.joinedAt && (
                  <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Joined {formatDate(userData.joinedAt)}</span>
                )}
                <span className="flex items-center gap-1"><Shield className="h-3.5 w-3.5" />{userData.roleAssignments.length} role{userData.roleAssignments.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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
              <Label>User ID</Label>
              <p className="text-xs font-mono text-ink-500">{userData.id}</p>
            </div>
          </CardContent>
        </Card>

        {/* Account Status */}
        <Card>
          <CardHeader><CardTitle>Account Status</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink-950">Account Access</p>
                <p className="text-xs text-ink-500">
                  {userData.tenantStatus === 'active'
                    ? 'User can log in and access the system.'
                    : 'User is suspended and cannot access the system.'}
                </p>
              </div>
              <Button
                variant={userData.tenantStatus === 'active' ? 'secondary' : 'primary'}
                size="sm"
                onClick={handleToggleStatus}
                loading={isSaving}
              >
                {userData.tenantStatus === 'active' ? (
                  <><XCircle className="h-4 w-4" /> Suspend</>
                ) : (
                  <><CheckCircle2 className="h-4 w-4" /> Activate</>
                )}
              </Button>
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
                  className="flex items-center justify-between rounded-[8px] border border-border p-3"
                >
                  <div className="flex items-center gap-3">
                    <Shield className="h-4 w-4 text-brand-600" />
                    <div>
                      <span className="text-sm font-medium text-ink-950">{assignment.roleName}</span>
                      {assignment.isActing && <Badge variant="pending" size="sm" className="ml-2">Acting</Badge>}
                      {assignment.endDate && (
                        <p className="text-xs text-ink-500">Expires {formatDate(assignment.endDate)}</p>
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
            <div className="mt-4 flex items-center gap-2 pt-4 border-t border-border">
              <select
                value={selectedRoleId}
                onChange={(e) => setSelectedRoleId(e.target.value)}
                className="h-10 flex-1 rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                <option value="">Select a role...</option>
                {rolesNotAssigned.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAddRole}
                loading={isSaving}
                disabled={!selectedRoleId}
              >
                <Plus className="h-4 w-4" /> Assign
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
