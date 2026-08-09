import { getDb } from '@/db';
import { employees, roleDelegations, roles, offices, departments } from '@/db/schema';
import { regions } from '@/db/schema/fleet';
import { and, asc, eq } from 'drizzle-orm';
import { getServerSession } from '@/lib/session';
import {
  getSessionWorkspace,
  hasPermission,
  requireDashboardAction,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { WorkspaceIds } from '@/lib/workspaces';
import { notFound } from 'next/navigation';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { CalendarClock } from 'lucide-react';
import { DelegationManager } from './DelegationManager';
import { DelegationRevokeButton } from '@/components/delegations/delegation-revoke-button';

export const dynamic = 'force-dynamic';

export default async function DelegationsPage() {
  const session = await getServerSession();
  if (!session) notFound();

  const routeAccess = await requireDashboardAction(session, '/dashboard/delegations', 'view');
  if (routeAccess !== true) notFound();

  const workspace = await getSessionWorkspace(session);
  const canManage = await hasPermission(session, Permissions.DELEGATION_MANAGE);
  const db = getDb();
  const now = new Date();

  const [viewerEmployee] = workspace.activeWorkspace === WorkspaceIds.APPROVER
    ? await db
        .select({ id: employees.id })
        .from(employees)
        .where(and(
          eq(employees.tenantId, session.tenantId),
          eq(employees.userId, session.user.id),
          eq(employees.employmentStatus, 'active'),
        ))
        .limit(1)
    : [undefined];

  const delegationScope = workspace.activeWorkspace === WorkspaceIds.APPROVER
    ? viewerEmployee
      ? and(
          eq(roleDelegations.tenantId, session.tenantId),
          eq(roleDelegations.actingEmployeeId, viewerEmployee.id),
        )
      : and(
          eq(roleDelegations.tenantId, session.tenantId),
          eq(roleDelegations.actingEmployeeId, '00000000-0000-0000-0000-000000000000'),
        )
    : eq(roleDelegations.tenantId, session.tenantId);

  const [rows, roleOptions, employeeOptions, officeOptions, departmentOptions, regionOptions] = await Promise.all([
    db.select({
      id: roleDelegations.id,
      roleName: roles.name,
      actingFirstName: employees.firstName,
      actingLastName: employees.lastName,
      actingTitle: roleDelegations.actingTitle,
      officeName: offices.name,
      departmentName: departments.name,
      regionName: regions.name,
      startAt: roleDelegations.startAt,
      endAt: roleDelegations.endAt,
      reason: roleDelegations.reason,
      storedStatus: roleDelegations.status,
      canApprove: roleDelegations.canApprove,
      canSign: roleDelegations.canSign,
      overrideReason: roleDelegations.overrideReason,
    }).from(roleDelegations)
      .innerJoin(roles, eq(roles.id, roleDelegations.roleId))
      .innerJoin(employees, eq(employees.id, roleDelegations.actingEmployeeId))
      .leftJoin(offices, eq(offices.id, roleDelegations.officeId))
      .leftJoin(departments, eq(departments.id, roleDelegations.departmentId))
      .leftJoin(regions, eq(regions.id, roleDelegations.regionId))
      .where(delegationScope)
      .orderBy(asc(roleDelegations.startAt)),
    canManage
      ? db.select({ id: roles.id, label: roles.name }).from(roles)
          .where(eq(roles.tenantId, session.tenantId)).orderBy(asc(roles.name))
      : Promise.resolve([]),
    canManage
      ? db.select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName, employeeNumber: employees.employeeNumber })
          .from(employees).where(and(eq(employees.tenantId, session.tenantId), eq(employees.employmentStatus, 'active')))
          .orderBy(asc(employees.lastName))
      : Promise.resolve([]),
    canManage
      ? db.select({ id: offices.id, name: offices.name }).from(offices)
          .where(and(eq(offices.tenantId, session.tenantId), eq(offices.isActive, true))).orderBy(asc(offices.name))
      : Promise.resolve([]),
    canManage
      ? db.select({ id: departments.id, name: departments.name }).from(departments)
          .where(and(eq(departments.tenantId, session.tenantId), eq(departments.isActive, true))).orderBy(asc(departments.name))
      : Promise.resolve([]),
    canManage
      ? db.select({ id: regions.id, name: regions.name }).from(regions)
          .where(and(eq(regions.tenantId, session.tenantId), eq(regions.isActive, true))).orderBy(asc(regions.name))
      : Promise.resolve([]),
  ]);

  const records = rows.map((row) => ({
    ...row,
    status: ['revoked', 'cancelled'].includes(row.storedStatus)
      ? row.storedStatus
      : row.endAt <= now ? 'expired' : row.startAt > now ? 'scheduled' : 'active',
  }));
  const counts = Object.fromEntries(['active', 'scheduled', 'expired', 'revoked'].map((status) => [status, records.filter((row) => row.status === status).length]));
  const ownView = workspace.activeWorkspace === WorkspaceIds.APPROVER;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: ownView ? 'My Delegations' : 'Acting Roles & Delegations' }]} />
      <PageHeader
        title={ownView ? 'My Delegations' : 'Acting Roles & Delegations'}
        description={ownView
          ? 'Your current, scheduled and historical acting appointments'
          : 'Time-bound appointments without changing substantive positions'}
      />
      {canManage && <DelegationManager roles={roleOptions} employees={employeeOptions.map((employee) => ({ id: employee.id, label: `${employee.firstName} ${employee.lastName} · ${employee.employeeNumber}` }))} scope={{ offices: officeOptions.map((o) => ({ id: o.id, label: o.name })), departments: departmentOptions.map((d) => ({ id: d.id, label: d.name })), regions: regionOptions.map((r) => ({ id: r.id, label: r.name })) }} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(counts).map(([label, value]) => <Card key={label}><CardContent className="py-4"><p className="text-2xl font-semibold text-ink-950">{value}</p><p className="text-xs capitalize text-ink-500">{label}</p></CardContent></Card>)}
      </div>
      {records.length === 0 ? <EmptyState icon={<CalendarClock className="h-6 w-6" />} title={ownView ? 'No delegations assigned to you' : 'No acting appointments'} description={ownView ? 'Your acting appointments will appear here when they are assigned.' : 'Create an appointment when an employee temporarily covers a substantive role.'} /> : (
        <div className="space-y-3">
          {records.map((row) => (
            <Card key={row.id}><CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-ink-950">{row.actingFirstName} {row.actingLastName}</p><StatusBadge status={row.status === 'active' ? 'success' : row.status === 'expired' || row.status === 'revoked' ? 'error' : 'pending'} label={row.status} /></div><p className="mt-1 text-sm text-ink-700">{row.actingTitle} · {row.roleName}</p><p className="mt-1 text-xs text-ink-500">{row.startAt.toLocaleString('en-NA')} – {row.endAt.toLocaleString('en-NA')}</p><p className="mt-1 text-xs text-ink-500">{row.reason}</p>{(row.officeName || row.departmentName || row.regionName) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.officeName && <StatusBadge status="info" label={`Office: ${row.officeName}`} />}
                    {row.departmentName && <StatusBadge status="info" label={`Dept: ${row.departmentName}`} />}
                    {row.regionName && <StatusBadge status="info" label={`Region: ${row.regionName}`} />}
                  </div>
                )}</div>
              <div className="flex flex-wrap items-center gap-2">
                {row.canApprove && <StatusBadge status="info" label="Can approve" />}
                {row.canSign && <StatusBadge status="info" label="Can sign" />}
                {canManage && !['revoked', 'cancelled', 'expired'].includes(row.status) && (
                  <DelegationRevokeButton delegationId={row.id} status={row.status} />
                )}
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}
    </div>
  );
}
