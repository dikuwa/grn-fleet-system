import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Plus, Upload, Database, Search, ChevronRight, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { isDbConnected, getDb } from '@/db';
import { employees, departments, offices } from '@/db/schema';
import { eq, ilike, or, and, asc, count } from 'drizzle-orm';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';

interface SearchParams {
  q?: string;
  office?: string;
  department?: string;
  status?: string;
  page?: string;
}

interface StaffQueryResult {
  staffList: Array<{
    id: string;
    employeeNumber: string;
    firstName: string;
    lastName: string;
    jobTitle: string | null;
    departmentName: string | null;
    officeName: string | null;
    employmentStatus: string;
    isDriver: boolean;
    email: string | null;
    phone: string | null;
  }>;
  totalCount: number;
  allOffices: Array<{ id: string; name: string }>;
  allDepartments: Array<{ id: string; name: string }>;
}

async function fetchStaffData(params: SearchParams): Promise<StaffQueryResult> {
  const dbo = getDb();
  const query = params.q?.trim() || '';
  const officeFilter = params.office || '';
  const departmentFilter = params.department || '';
  const statusFilter = params.status || '';
  const currentPage = Math.max(1, parseInt(params.page || '1', 10) || 1);
  const offset = (currentPage - 1) * DEFAULT_PAGE_SIZE;

  const conditions: ReturnType<typeof and>[] = [];

  if (query) {
    conditions.push(
      or(
        ilike(employees.firstName, `%${query}%`),
        ilike(employees.lastName, `%${query}%`),
        ilike(employees.employeeNumber, `%${query}%`),
        ilike(employees.email, `%${query}%`),
        ilike(employees.jobTitle, `%${query}%`),
      )!,
    );
  }

  if (officeFilter) conditions.push(eq(employees.officeId, officeFilter));
  if (departmentFilter) conditions.push(eq(employees.departmentId, departmentFilter));
  if (statusFilter) conditions.push(eq(employees.employmentStatus, statusFilter));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const totalCount = await dbo
    .select({ count: count() })
    .from(employees)
    .where(whereClause)
    .then((r) => Number(r[0].count));

  const staffList = await dbo
    .select({
      id: employees.id,
      employeeNumber: employees.employeeNumber,
      firstName: employees.firstName,
      lastName: employees.lastName,
      jobTitle: employees.jobTitle,
      departmentName: departments.name,
      officeName: offices.name,
      employmentStatus: employees.employmentStatus,
      isDriver: employees.isDriver,
      email: employees.email,
      phone: employees.phone,
    })
    .from(employees)
    .leftJoin(departments, eq(employees.departmentId, departments.id))
    .leftJoin(offices, eq(employees.officeId, offices.id))
    .where(whereClause)
    .orderBy(asc(employees.lastName))
    .limit(DEFAULT_PAGE_SIZE)
    .offset(offset);

  const allOffices = await dbo.select({ id: offices.id, name: offices.name }).from(offices).where(eq(offices.isActive, true)).orderBy(asc(offices.name));
  const allDepartments = await dbo.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.isActive, true)).orderBy(asc(departments.name));

  return { staffList, totalCount, allOffices, allDepartments };
}

export const dynamic = 'force-dynamic';

export default async function StaffDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Staff Directory' }]} />
        <PageHeader title="Staff Directory" description="Manage employee records, driver profiles, and licence documents">
          <Button variant="primary" size="sm"><Plus className="h-4 w-4" />Add Employee</Button>
        </PageHeader>
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Database Not Configured"
          description="Set the DATABASE_URL environment variable and run migrations to enable the staff directory."
        />
      </div>
    );
  }

  const sp = await searchParams;
  let data: StaffQueryResult;
  try {
    data = await fetchStaffData(sp);
  } catch (error) {
    console.error('Staff directory query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Staff Directory' }]} />
        <PageHeader title="Staff Directory" description="Manage employee records" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Unable to Load Staff Records"
          description="The database query failed. Please run migrations and seed first."
        />
      </div>
    );
  }

  const { staffList, totalCount, allOffices, allDepartments } = data;
  const query = sp.q?.trim() || '';
  const officeFilter = sp.office || '';
  const departmentFilter = sp.department || '';
  const statusFilter = sp.status || '';
  const currentPage = Math.max(1, parseInt(sp.page || '1', 10) || 1);
  const totalPages = Math.ceil(totalCount / DEFAULT_PAGE_SIZE);
  const offset = (currentPage - 1) * DEFAULT_PAGE_SIZE;

  function buildPageUrl(overrides: Record<string, string>): string {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (officeFilter) params.set('office', officeFilter);
    if (departmentFilter) params.set('department', departmentFilter);
    if (statusFilter) params.set('status', statusFilter);
    Object.entries(overrides).forEach(([k, v]) => params.set(k, v));
    return `/dashboard/staff?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Staff Directory' }]} />
      <PageHeader
        title="Staff Directory"
        description={`${totalCount} employee${totalCount !== 1 ? 's' : ''} on record`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/staff/import"><Upload className="h-4 w-4" />Import</Link>
        </Button>
        <Button variant="primary" size="sm"><Plus className="h-4 w-4" />Add Employee</Button>
      </PageHeader>

      <form className="flex flex-wrap items-center gap-3 rounded-[10px] border border-border bg-surface p-4" method="GET">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
          <input type="search" name="q" defaultValue={query} placeholder="Search by name, employee number, email..." className="h-10 w-full rounded-[8px] border border-border bg-canvas px-3 pl-9 text-sm text-ink-950 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-brand-600" />
        </div>
        <select name="office" defaultValue={officeFilter} className="h-10 rounded-[8px] border border-border bg-canvas px-3 text-sm text-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-600">
          <option value="">All Offices</option>
          {allOffices.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
        </select>
        <select name="department" defaultValue={departmentFilter} className="h-10 rounded-[8px] border border-border bg-canvas px-3 text-sm text-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-600">
          <option value="">All Departments</option>
          {allDepartments.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
        </select>
        <select name="status" defaultValue={statusFilter} className="h-10 rounded-[8px] border border-border bg-canvas px-3 text-sm text-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-600">
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="terminated">Terminated</option>
        </select>
        {(query || officeFilter || departmentFilter || statusFilter) && (
          <Link href="/dashboard/staff" className="h-10 rounded-[8px] border border-border px-3 text-xs text-ink-500 hover:bg-muted transition-colors inline-flex items-center">Clear Filters</Link>
        )}
      </form>

      <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Employee</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Employee #</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Department</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Office</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Driver</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-ink-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {staffList.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-ink-500">{query || officeFilter || departmentFilter || statusFilter ? 'No employees match your search criteria.' : 'No employees have been added yet.'}</td></tr>
              ) : (
                staffList.map((row) => (
                  <tr key={row.id} className="hover:bg-canvas/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-brand-50 text-xs font-semibold text-brand-800">{row.firstName.charAt(0)}{row.lastName.charAt(0)}</div>
                        <div>
                          <Link href={`/dashboard/staff/${row.id}`} className="font-medium text-ink-950 hover:text-brand-600 transition-colors">{row.firstName} {row.lastName}</Link>
                          <p className="text-xs text-ink-500">{row.jobTitle}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-ink-500">{row.employeeNumber}</td>
                    <td className="px-4 py-3 text-sm text-ink-700">{row.departmentName || '—'}</td>
                    <td className="px-4 py-3 text-sm text-ink-700">{row.officeName || '—'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.employmentStatus === 'active' ? 'success' : row.employmentStatus === 'suspended' ? 'pending' : 'error'} label={row.employmentStatus.charAt(0).toUpperCase() + row.employmentStatus.slice(1)} />
                    </td>
                    <td className="px-4 py-3">{row.isDriver ? <StatusBadge status="info" label="Driver" /> : <span className="text-xs text-ink-500">—</span>}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/dashboard/staff/${row.id}`} className="text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors inline-flex items-center gap-1">View <ChevronRight className="h-3 w-3" /></Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <p className="text-xs text-ink-500">Showing {offset + 1}–{Math.min(offset + DEFAULT_PAGE_SIZE, totalCount)} of {totalCount}</p>
            <div className="flex items-center gap-2">
              {currentPage > 1 ? (
                <Link href={buildPageUrl({ page: String(currentPage - 1) })} className="h-8 inline-flex items-center rounded-[6px] border border-border px-3 text-xs text-ink-700 hover:bg-muted transition-colors"><ChevronLeft className="h-3 w-3 mr-1" />Previous</Link>
              ) : (
                <button className="h-8 rounded-[6px] border border-border px-3 text-xs text-ink-500 opacity-50 cursor-not-allowed" disabled><ChevronLeft className="h-3 w-3 mr-1" />Previous</button>
              )}
              {currentPage < totalPages ? (
                <Link href={buildPageUrl({ page: String(currentPage + 1) })} className="h-8 inline-flex items-center rounded-[6px] border border-border px-3 text-xs text-ink-700 hover:bg-muted transition-colors">Next<ChevronRight className="h-3 w-3 ml-1" /></Link>
              ) : (
                <button className="h-8 rounded-[6px] border border-border px-3 text-xs text-ink-500 opacity-50 cursor-not-allowed" disabled>Next<ChevronRight className="h-3 w-3 ml-1" /></button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
