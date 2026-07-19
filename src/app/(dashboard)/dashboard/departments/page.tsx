import { getDb, isDbConnected } from '@/db';
import { departments, employees } from '@/db/schema';
import { eq, and, count, isNotNull, sql, asc } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, Layers, Users, ChevronLeft } from 'lucide-react';
import { getServerSession } from '@/lib/session';
import { DepartmentDialog } from '@/app/(dashboard)/dashboard/offices/DepartmentDialog';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function DepartmentsPage() {
  const session = await getServerSession();

  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Departments' },
        ]} />
        <PageHeader title="Departments" description="Organisational departments and directorates" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Departments' },
        ]} />
        <PageHeader title="Departments" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  return <DepartmentsContent session={session} />;
}

async function DepartmentsContent({ session }: { session: { tenantId: string } }) {
  const db = getDb();

  try {
    const deptRows = await db
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
      })
      .from(departments)
      .leftJoin(employees, eq(departments.headEmployeeId, employees.id))
      .where(and(eq(departments.tenantId, session.tenantId), eq(departments.isActive, true)))
      .orderBy(asc(departments.name));

    const totalStaff = deptRows.reduce((sum, r) => sum + Number(r.staffCount ?? 0), 0);

    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Departments' },
        ]} />
        <PageHeader
          title="Departments & Directorates"
          description={`${deptRows.length} departments · ${totalStaff} active staff`}
        >
          <DepartmentDialog tenantId={session.tenantId} />
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/offices">
              <ChevronLeft className="h-4 w-4" />
              Offices
            </Link>
          </Button>
        </PageHeader>

        {/* Summary */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-[650] tabular-nums text-ink-950">{deptRows.length}</p>
              <p className="text-xs text-ink-500">Total Departments</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-[650] tabular-nums text-status-success-text">{totalStaff}</p>
              <p className="text-xs text-ink-500">Active Staff</p>
            </CardContent>
          </Card>
        </div>

        {deptRows.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-8 w-8" />}
            title="No departments"
            description="Departments help organise your staff into functional groups."
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {deptRows.map((dept) => (
                  <div
                    key={dept.id}
                    className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-canvas/50"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-brand-50">
                        <Layers className="h-4 w-4 text-brand-700" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-ink-950">{dept.name}</p>
                          {dept.code && (
                            <span className="rounded-[4px] bg-muted px-1.5 py-0.5 text-[10px] font-mono text-ink-500">
                              {dept.code}
                            </span>
                          )}
                        </div>
                        {dept.headName && (
                          <p className="mt-0.5 text-xs text-ink-500 truncate max-w-md">
                            Head: {dept.headName}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <span className="flex items-center gap-1.5 text-sm text-ink-500">
                        <Users className="h-3.5 w-3.5" />
                        <span className="font-medium tabular-nums">
                          {dept.staffCount ?? 0}
                        </span>
                      </span>
                      <Badge variant={dept.isActive ? 'success' : 'cancelled'} size="sm">
                        {dept.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  } catch (error) {
    console.error('Departments query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Departments' },
        ]} />
        <PageHeader title="Departments" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Departments" />
      </div>
    );
  }
}
