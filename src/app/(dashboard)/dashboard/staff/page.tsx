import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { StyledSelect } from '@/components/ui/styled-select';
import { LiveSearchInput } from '@/components/ui/live-search-input';
import { Plus, Upload, Database, ChevronRight, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { isDbConnected, getDb } from '@/db';
import { employees, departments, offices, roleDelegations, userProfiles } from '@/db/schema';
import { eq, ilike, or, and, asc, count, sql } from 'drizzle-orm';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { getServerSession } from '@/lib/session';

interface SearchParams {
  q?: string;
  office?: string;
  department?: string;
  status?: string;
  availability?: string;
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
    availabilityStatus: string;
    accountStatus: string | null;
    profilePhotoUrl: string | null;
    isActing: boolean;
  }>;
  totalCount: number;
  allOffices: Array<{ id: string; name: string }>;
  allDepartments: Array<{ id: string; name: string }>;
}

async function fetchStaffData(params: SearchParams, tenantId: string): Promise<StaffQueryResult> {
  const dbo = getDb();
  const query = params.q?.trim() || '';
  const officeFilter = params.office || '';
  const departmentFilter = params.department || '';
  const statusFilter = params.status || '';
  const availabilityFilter = params.availability || '';
  const currentPage = Math.max(1, parseInt(params.page || '1', 10) || 1);
  const offset = (currentPage - 1) * DEFAULT_PAGE_SIZE;

  const conditions: ReturnType<typeof and>[] = [eq(employees.tenantId, tenantId)];

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
  if (!statusFilter) conditions.push(eq(employees.employmentStatus, 'active'));
  else if (statusFilter !== 'all') conditions.push(eq(employees.employmentStatus, statusFilter));
  if (availabilityFilter) conditions.push(eq(employees.availabilityStatus, availabilityFilter));

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
      availabilityStatus: employees.availabilityStatus,
      accountStatus: userProfiles.status,
      profilePhotoUrl: employees.profilePhotoUrl,
      isActing: sql<boolean>`EXISTS (
        SELECT 1 FROM ${roleDelegations}
        WHERE ${roleDelegations.actingEmployeeId} = ${employees.id}
          AND ${roleDelegations.status} IN ('scheduled', 'active')
          AND ${roleDelegations.startAt} <= now()
          AND ${roleDelegations.endAt} > now()
      )`,
    })
    .from(employees)
    .leftJoin(departments, eq(employees.departmentId, departments.id))
    .leftJoin(offices, eq(employees.officeId, offices.id))
    .leftJoin(userProfiles, eq(userProfiles.userId, employees.userId))
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
  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Staff Directory' }]} />
        <PageHeader title="Staff Directory" description="Manage employee records, driver profiles, and licence documents">
          <Button variant="primary" size="sm"><Plus className="h-4 w-4" />Add Employee</Button>
        </PageHeader>
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" description="Please sign in to view staff records." />
      </div>
    );
  }

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
    data = await fetchStaffData(sp, session.tenantId);
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
  const availabilityFilter = sp.availability || '';
  const currentPage = Math.max(1, parseInt(sp.page || '1', 10) || 1);
  const totalPages = Math.ceil(totalCount / DEFAULT_PAGE_SIZE);
  const offset = (currentPage - 1) * DEFAULT_PAGE_SIZE;

  function buildPageUrl(overrides: Record<string, string>): string {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (officeFilter) params.set('office', officeFilter);
    if (departmentFilter) params.set('department', departmentFilter);
    if (statusFilter) params.set('status', statusFilter);
    if (availabilityFilter) params.set('availability', availabilityFilter);
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
        <Button variant="primary" size="sm" asChild><Link href="/dashboard/staff/new"><Plus className="h-4 w-4" />Add Employee</Link></Button>
      </PageHeader>

      <form className="flex flex-wrap items-center gap-3 rounded-[10px] border border-border bg-surface p-4" method="GET">
        <LiveSearchInput
          name="q"
          defaultValue={query}
          placeholder="Search by name, employee number, email…"
        />
        <StyledSelect name="office" defaultValue={officeFilter} placeholder="All Offices">
          {allOffices.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
        </StyledSelect>
        <StyledSelect name="department" defaultValue={departmentFilter} placeholder="All Departments">
          {allDepartments.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
        </StyledSelect>
        <StyledSelect name="status" defaultValue={statusFilter} placeholder="Active employees">
          <option value="active">Active</option>
          <option value="on_leave">On leave</option>
          <option value="temporarily_unavailable">Temporarily unavailable</option>
          <option value="suspended">Suspended</option>
          <option value="transferred">Transferred</option>
          <option value="contract_ended">Contract ended</option>
          <option value="retired">Retired</option>
          <option value="archived">Archived</option>
          <option value="all">All employees</option>
        </StyledSelect>
        <StyledSelect name="availability" defaultValue={availabilityFilter} placeholder="All availability">
          <option value="available">Available</option>
          <option value="annual_leave">Annual leave</option>
          <option value="sick_leave">Sick leave</option>
          <option value="official_travel">Official travel</option>
          <option value="training">Training</option>
          <option value="temporarily_unavailable">Temporarily unavailable</option>
        </StyledSelect>
        {(query || officeFilter || departmentFilter || statusFilter || availabilityFilter) && (
          <Link href="/dashboard/staff" className="h-10 rounded-[8px] border border-border px-3 text-xs text-ink-500 hover:bg-muted transition-colors inline-flex items-center">Clear Filters</Link>
        )}
      </form>

      <div className="space-y-3 md:hidden">
        {staffList.map((row) => (
          <div key={row.id} className="rounded-[10px] border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-brand-50 text-xs font-semibold text-brand-800">
                {row.profilePhotoUrl ? <img src={row.profilePhotoUrl} alt="" className="h-full w-full object-cover" /> : <>{row.firstName[0]}{row.lastName[0]}</>}
              </div>
              <div className="min-w-0 flex-1">
                <Link href={`/dashboard/staff/${row.id}`} className="font-medium text-ink-950">{row.firstName} {row.lastName}</Link>
                <p className="truncate text-xs text-ink-500">{row.employeeNumber} · {row.jobTitle || 'Position not recorded'}</p>
                <p className="truncate text-xs text-ink-500">{row.officeName || 'Office not recorded'}</p>
              </div>
              <Link href={`/dashboard/staff/${row.id}`} className="rounded-[8px] border border-border px-3 py-2 text-xs font-medium text-brand-700">View</Link>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusBadge status={row.employmentStatus === 'active' ? 'success' : 'error'} label={row.employmentStatus.replaceAll('_', ' ')} />
              <StatusBadge status={row.availabilityStatus === 'available' ? 'success' : 'pending'} label={row.availabilityStatus.replaceAll('_', ' ')} />
              {row.isDriver && <StatusBadge status="info" label="Driver" />}
              {row.isActing && <StatusBadge status="info" label="Acting" />}
              {!row.accountStatus && <StatusBadge status="pending" label="No account" />}
            </div>
          </div>
        ))}
        {!staffList.length && <div className="rounded-[10px] border border-dashed border-border p-8 text-center text-sm text-ink-500">No employees match these filters.</div>}
      </div>

      <div className="hidden overflow-hidden rounded-[10px] border border-border bg-surface md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Employee</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Employee #</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Department</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Office</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Availability</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Account</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Driver</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Acting</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-ink-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {staffList.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-ink-500">{query || officeFilter || departmentFilter || statusFilter || availabilityFilter ? 'No employees match your search criteria.' : 'No active employees have been added yet.'}</td></tr>
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
                    <td className="px-4 py-3"><StatusBadge status={row.availabilityStatus === 'available' ? 'success' : 'pending'} label={row.availabilityStatus.replaceAll('_', ' ')} /></td>
                    <td className="px-4 py-3">{row.accountStatus ? <StatusBadge status={row.accountStatus === 'active' ? 'success' : 'error'} label={row.accountStatus} /> : <StatusBadge status="pending" label="No account" />}</td>
                    <td className="px-4 py-3">{row.isDriver ? <StatusBadge status="info" label="Driver" /> : <span className="text-xs text-ink-500">—</span>}</td>
                    <td className="px-4 py-3">{row.isActing ? <StatusBadge status="info" label="Acting" /> : <span className="text-xs text-ink-500">—</span>}</td>
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
