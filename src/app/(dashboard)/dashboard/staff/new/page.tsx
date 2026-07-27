import { getDb } from '@/db';
import { departments, offices } from '@/db/schema';
import { asc, eq } from 'drizzle-orm';
import { getServerSession } from '@/lib/session';
import { hasPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { notFound } from 'next/navigation';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { EmployeeCreateForm } from './EmployeeCreateForm';

export const dynamic = 'force-dynamic';

export default async function NewEmployeePage() {
  const session = await getServerSession();
  if (!session || !(await hasPermission(session, Permissions.STAFF_MANAGE))) notFound();
  const db = getDb();
  const [officeOptions, departmentOptions] = await Promise.all([
    db.select({ id: offices.id, name: offices.name }).from(offices).where(eq(offices.isActive, true)).orderBy(asc(offices.name)),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.isActive, true)).orderBy(asc(departments.name)),
  ]);
  return <div className="space-y-6"><Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Employee Directory', href: '/dashboard/staff' }, { label: 'New employee' }]} /><PageHeader title="Add employee" description="Create the staff identity first; a login account remains optional." /><EmployeeCreateForm offices={officeOptions} departments={departmentOptions} /></div>;
}
