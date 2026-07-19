import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { isDbConnected, getDb } from '@/db';
import { offices, departments, employees } from '@/db/schema';
import { eq, and, asc, count, isNotNull } from 'drizzle-orm';
import { Building2, MapPin, Database, Plus, ChevronRight, Layers } from 'lucide-react';
import { getServerSession } from '@/lib/session';
import { OfficeDialog } from './OfficeDialog';
import { DepartmentDialog } from './DepartmentDialog';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function fetchOfficesData(tenantId: string) {
  const dbo = getDb();
  const allOffices = await dbo.select().from(offices).where(and(eq(offices.tenantId, tenantId), eq(offices.isActive, true))).orderBy(asc(offices.name));
  const allDepartments = await dbo.select().from(departments).where(and(eq(departments.tenantId, tenantId), eq(departments.isActive, true))).orderBy(asc(departments.name));

  const officeCounts = await dbo
    .select({ officeId: employees.officeId, count: count() })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), eq(employees.employmentStatus, 'active'), isNotNull(employees.officeId)))
    .groupBy(employees.officeId);

  const countMap = new Map(officeCounts.map((r) => [r.officeId, Number(r.count)]));

  const deptCounts = await dbo
    .select({ departmentId: employees.departmentId, count: count() })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), eq(employees.employmentStatus, 'active'), isNotNull(employees.departmentId)))
    .groupBy(employees.departmentId);

  const deptCountMap = new Map(deptCounts.map((r) => [r.departmentId, Number(r.count)]));

  return { allOffices, allDepartments, countMap, deptCountMap };
}

export default async function OfficesPage() {
  const session = await getServerSession();
  const canManage = !!session;

  if (!canManage) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Offices' }]} />
        <PageHeader title="Offices & Departments" description="Organisational structure" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" description="Please sign in to view the office hierarchy." />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Offices' }]} />
        <PageHeader title="Offices & Departments" description="Organisational structure" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" description="Database connection is required." />
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof fetchOfficesData>>;
  try {
    data = await fetchOfficesData(session.tenantId);
  } catch (error) {
    console.error('Offices query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Offices' }]} />
        <PageHeader title="Offices & Departments" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Offices" />
      </div>
    );
  }

  const { allOffices, allDepartments, countMap, deptCountMap } = data;
  const rootOffices = allOffices.filter((o) => !o.parentId);
  const childOffices = allOffices.filter((o) => o.parentId);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Offices' }]} />
      <PageHeader
        title="Offices & Departments"
        description={`${allOffices.length} offices · ${allDepartments.length} departments`}
      >
        <OfficeDialog tenantId={session.tenantId} />
        <DepartmentDialog tenantId={session.tenantId} />
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Office Hierarchy</CardTitle></CardHeader>
          <CardContent>
            {allOffices.length === 0 ? (
              <p className="text-sm text-ink-500">No offices have been created yet.</p>
            ) : (
              <div className="space-y-3">
                {rootOffices.map((office) => (
                  <OfficeNode
                    key={office.id}
                    office={office}
                    subOffices={childOffices.filter((c) => c.parentId === office.id)}
                    countMap={countMap}
                    allChildOffices={childOffices}
                    depth={0}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Departments & Directorates</CardTitle></CardHeader>
          <CardContent>
            {allDepartments.length === 0 ? (
              <p className="text-sm text-ink-500">No departments have been created yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {allDepartments.map((dept) => (
                  <div key={dept.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-brand-50">
                        <Layers className="h-4 w-4 text-brand-700" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-ink-950">{dept.name}</p>
                        {dept.code && <p className="text-xs text-ink-500">Code: {dept.code}</p>}
                      </div>
                    </div>
                    <Badge variant="default">{deptCountMap.get(dept.id) || 0}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function OfficeNode({
  office, subOffices, countMap, allChildOffices, depth,
}: {
  office: (typeof offices.$inferSelect);
  subOffices: (typeof offices.$inferSelect)[];
  countMap: Map<string | null, number>;
  allChildOffices: (typeof offices.$inferSelect)[];
  depth: number;
}) {
  return (
    <div>
      <div
        className="flex items-center gap-3 rounded-[8px] border border-border p-3 hover:bg-canvas/50 transition-colors"
        style={{ marginLeft: depth * 20 }}
      >
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-[8px] ${
            office.type === 'head_office'
              ? 'bg-brand-50 text-brand-700'
              : office.type === 'constituency_office'
                ? 'bg-status-info-bg text-status-info-text'
                : 'bg-muted text-ink-500'
          }`}
        >
          {office.type === 'head_office' ? <Building2 className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink-950 truncate">{office.name}</p>
          <p className="text-xs text-ink-500 capitalize">{office.type.replace(/_/g, ' ')}{office.code && ` · ${office.code}`}</p>
        </div>
        <Badge variant="default">{countMap.get(office.id) || 0}</Badge>
        {subOffices.length > 0 && <ChevronRight className="h-4 w-4 text-ink-400" />}
      </div>
      {subOffices.length > 0 && (
        <div className="mt-2 space-y-2">
          {subOffices.map((child) => (
            <OfficeNode
              key={child.id}
              office={child}
              subOffices={allChildOffices.filter((c) => c.parentId === child.id)}
              countMap={countMap}
              allChildOffices={allChildOffices}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
