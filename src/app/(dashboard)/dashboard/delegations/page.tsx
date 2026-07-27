import { getDb } from '@/db';
import { employees, roleDelegations, roles } from '@/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { getServerSession } from '@/lib/session';
import { hasPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { notFound } from 'next/navigation';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { CalendarClock } from 'lucide-react';
import { DelegationManager } from './DelegationManager';

export const dynamic = 'force-dynamic';

export default async function DelegationsPage() {
  const session = await getServerSession();
  if (!session || !(await hasPermission(session, Permissions.STAFF_VIEW))) notFound();
  const canManage = await hasPermission(session, Permissions.DELEGATION_MANAGE);
  const db = getDb();
  const now = new Date();
  const [rows, roleOptions, employeeOptions] = await Promise.all([
    db.select({
      id: roleDelegations.id,
      roleName: roles.name,
      actingFirstName: employees.firstName,
      actingLastName: employees.lastName,
      actingTitle: roleDelegations.actingTitle,
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
      .where(eq(roleDelegations.tenantId, session.tenantId))
      .orderBy(asc(roleDelegations.startAt)),
    db.select({ id: roles.id, label: roles.name }).from(roles)
      .where(eq(roles.tenantId, session.tenantId)).orderBy(asc(roles.name)),
    db.select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName, employeeNumber: employees.employeeNumber })
      .from(employees).where(and(eq(employees.tenantId, session.tenantId), eq(employees.employmentStatus, 'active')))
      .orderBy(asc(employees.lastName)),
  ]);
  const records = rows.map((row) => ({
    ...row,
    status: ['revoked', 'cancelled'].includes(row.storedStatus)
      ? row.storedStatus
      : row.endAt <= now ? 'expired' : row.startAt > now ? 'scheduled' : 'active',
  }));
  const counts = Object.fromEntries(['active', 'scheduled', 'expired', 'revoked'].map((status) => [status, records.filter((row) => row.status === status).length]));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Acting Roles & Delegations' }]} />
      <PageHeader title="Acting Roles & Delegations" description="Time-bound appointments without changing substantive positions" />
      {canManage && <DelegationManager roles={roleOptions} employees={employeeOptions.map((employee) => ({ id: employee.id, label: `${employee.firstName} ${employee.lastName} · ${employee.employeeNumber}` }))} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(counts).map(([label, value]) => <Card key={label}><CardContent className="py-4"><p className="text-2xl font-semibold text-ink-950">{value}</p><p className="text-xs capitalize text-ink-500">{label}</p></CardContent></Card>)}
      </div>
      {records.length === 0 ? <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="No acting appointments" description="Create an appointment when an employee temporarily covers a substantive role." /> : (
        <div className="space-y-3">
          {records.map((row) => (
            <Card key={row.id}><CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-ink-950">{row.actingFirstName} {row.actingLastName}</p><StatusBadge status={row.status === 'active' ? 'success' : row.status === 'expired' || row.status === 'revoked' ? 'error' : 'pending'} label={row.status} /></div><p className="mt-1 text-sm text-ink-700">{row.actingTitle} · {row.roleName}</p><p className="mt-1 text-xs text-ink-500">{row.startAt.toLocaleString('en-NA')} – {row.endAt.toLocaleString('en-NA')}</p><p className="mt-1 text-xs text-ink-500">{row.reason}</p></div>
              <div className="flex gap-2">{row.canApprove && <StatusBadge status="info" label="Can approve" />}{row.canSign && <StatusBadge status="info" label="Can sign" />}</div>
            </CardContent></Card>
          ))}
        </div>
      )}
    </div>
  );
}
