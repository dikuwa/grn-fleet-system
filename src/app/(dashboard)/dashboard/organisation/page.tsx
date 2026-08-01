import { getDb, isDbConnected } from '@/db';
import { offices, departments, employees } from '@/db/schema';
import { eq, sql, asc } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, Building2 } from 'lucide-react';
import { getServerSession } from '@/lib/session';
import { OrganisationTabs, type OrganisationOffice, type OrganisationDepartment } from './organisation-tabs';

export const dynamic = 'force-dynamic';

export default async function OrganisationStructurePage() {
  const session = await getServerSession();

  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Organisation Structure' }]} />
        <PageHeader title="Organisation Structure" description="Offices, departments and directorates" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Organisation Structure' }]} />
        <PageHeader title="Organisation Structure" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  const db = getDb();

  let officeRows: OrganisationOffice[] = [];
  let deptRows: OrganisationDepartment[] = [];
  let queryError = false;

  try {
    // ── Offices with hierarchy, location, employee counts, represented departments ──
    officeRows = (await db
      .select({
        id: offices.id,
        name: offices.name,
        type: offices.type,
        code: offices.code,
        address: offices.address,
        parentId: offices.parentId,
        isActive: offices.isActive,
        parentName: sql<string | null>`(SELECT o2.name FROM ${offices} o2 WHERE o2.id = ${offices.parentId})`,
        employeeCount: sql<number>`(
          SELECT count(*)::int FROM ${employees}
          WHERE ${employees.officeId} = ${offices.id}
            AND ${employees.tenantId} = ${session.tenantId}
            AND ${employees.employmentStatus} = 'active'
        )`,
        deptCount: sql<number>`(
          SELECT count(DISTINCT ${employees.departmentId})::int FROM ${employees}
          WHERE ${employees.officeId} = ${offices.id}
            AND ${employees.tenantId} = ${session.tenantId}
            AND ${employees.employmentStatus} = 'active'
            AND ${employees.departmentId} IS NOT NULL
        )`,
      })
      .from(offices)
      .where(eq(offices.tenantId, session.tenantId))
      .orderBy(asc(offices.name))) as OrganisationOffice[];

    // ── Departments with heads, staff counts, offices where they operate ──
    deptRows = (await db
      .select({
        id: departments.id,
        name: departments.name,
        code: departments.code,
        headEmployeeId: departments.headEmployeeId,
        isActive: departments.isActive,
        headName: sql<string | null>`concat_ws(' ', ${employees.firstName}, ${employees.lastName})`,
        staffCount: sql<number>`(
          SELECT count(*)::int FROM ${employees}
          WHERE ${employees.departmentId} = ${departments.id}
            AND ${employees.tenantId} = ${session.tenantId}
            AND ${employees.employmentStatus} = 'active'
        )`,
        officeCount: sql<number>`(
          SELECT count(DISTINCT ${employees.officeId})::int FROM ${employees}
          WHERE ${employees.departmentId} = ${departments.id}
            AND ${employees.tenantId} = ${session.tenantId}
            AND ${employees.employmentStatus} = 'active'
            AND ${employees.officeId} IS NOT NULL
        )`,
        officeNames: sql<string | null>`(
          SELECT string_agg(DISTINCT o.name, ', ' ORDER BY o.name) FROM ${offices} o
          INNER JOIN ${employees} e ON e.office_id = o.id
          WHERE e.department_id = ${departments.id}
            AND e.tenant_id = ${session.tenantId}
            AND e.employment_status = 'active'
        )`,
      })
      .from(departments)
      .leftJoin(employees, eq(departments.headEmployeeId, employees.id))
      .where(eq(departments.tenantId, session.tenantId))
      .orderBy(asc(departments.name))) as OrganisationDepartment[];
  } catch (error) {
    console.error('Organisation structure query failed:', error);
    queryError = true;
  }

  if (queryError) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Organisation Structure' }]} />
        <PageHeader title="Organisation Structure" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Organisation Structure" />
      </div>
    );
  }

  const totalStaff = deptRows.reduce((sum, r) => sum + Number(r.staffCount ?? 0), 0);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Organisation Structure' },
      ]} />
      <PageHeader
        title="Organisation Structure"
        description={`${officeRows.length} offices · ${deptRows.length} departments · ${totalStaff} active staff`}
      >
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-[6px] bg-muted px-2.5 py-1.5 text-xs text-ink-500 sm:flex">
            <Building2 className="h-3.5 w-3.5" />
            Tenant-scoped
          </span>
        </div>
      </PageHeader>

      <OrganisationTabs offices={officeRows} departments={deptRows} />
    </div>
  );
}
