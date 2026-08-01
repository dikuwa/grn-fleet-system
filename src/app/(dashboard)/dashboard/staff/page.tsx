import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { StyledSelect } from '@/components/ui/styled-select';
import { LiveSearchInput } from '@/components/ui/live-search-input';
import { Plus, Upload, Database, ChevronRight, ChevronLeft, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { isDbConnected, getDb } from '@/db';
import { employees, departments, offices, roleDelegations, userProfiles } from '@/db/schema';
import { tenantMemberships, roleAssignments, roles } from '@/db/schema/tenants';
import { eq, ilike, or, and, asc, count, sql } from 'drizzle-orm';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { getServerSession } from '@/lib/session';
import { getSessionRoleNames, hasPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { canPerformDashboardAction } from '@/lib/dashboard-access';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { hasActiveFilters, normalizeOptionalFilter } from '@/lib/filter-state';
import { StaffRowActions } from '@/components/staff/staff-row-actions';

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
    roleNames: string | null;
    userId: string | null;
  }>;
  totalCount: number;
  allOffices: Array<{ id: string; name: string }>;
  allDepartments: Array<{ id: string; name: string }>;
}

async function fetchStaffData(params: SearchParams, tenantId: string): Promise<StaffQueryResult> {
  const dbo = getDb();
  const query = params.q?.trim() || '';
  const officeFilter = normalizeOptionalFilter(params.office) || '';
  const departmentFilter = normalizeOptionalFilter(params.department) || '';
  const statusFilter = normalizeOptionalFilter(params.status) || '';
  const availabilityFilter = normalizeOptionalFilter(params.availability) || '';
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
  if (statusFilter) conditions.push(eq(employees.employmentStatus, statusFilter));
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
      userId: employees.userId,
      roleNames: sql<string | null>`(
        SELECT string_agg(${roles.name}, ', ' ORDER BY ${roles.name})
        FROM ${tenantMemberships}
        INNER JOIN ${roleAssignments} ON ${roleAssignments.tenantMembershipId} = ${tenantMemberships.id}
        INNER JOIN ${roles} ON ${roles.id} = ${roleAssignments.roleId}
        WHERE ${tenantMemberships.userId} = ${employees.userId}
          AND ${tenantMemberships.tenantId} = ${employees.tenantId}
          AND (${roleAssignments.endDate} IS NULL OR ${roleAssignments.endDate} > now())
      )`,
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

  const allOffices = await dbo
    .select({ id: offices.id, name: offices.name })
    .from(offices)
    .where(eq(offices.isActive, true))
    .orderBy(asc(offices.name));
  const allDepartments = await dbo
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(eq(departments.isActive, true))
    .orderBy(asc(departments.name));

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
        <Breadcrumbs
          items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Staff Directory' }]}
        />
        <PageHeader
          title="Staff Directory"
          description="Manage employee records, driver profiles, and licence documents"
        >
          <Button variant="primary" size="sm">
            <Plus className="h-4 w-4" />
            Add Employee
          </Button>
        </PageHeader>
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Authentication Required"
          description="Please sign in to view staff records."
        />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Staff Directory' }]}
        />
        <PageHeader
          title="Staff Directory"
          description="Manage employee records, driver profiles, and licence documents"
        >
          <Button variant="primary" size="sm">
            <Plus className="h-4 w-4" />
            Add Employee
          </Button>
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
  const roleNames = await getSessionRoleNames(session);
  const canCreate = canPerformDashboardAction('/dashboard/staff/new', roleNames, 'create');
  const canImport = canPerformDashboardAction('/dashboard/staff/import', roleNames, 'import');
  let data: StaffQueryResult;
  try {
    data = await fetchStaffData(sp, session.tenantId);
  } catch (error) {
    console.error('Staff directory query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Staff Directory' }]}
        />
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
  const officeFilter = normalizeOptionalFilter(sp.office) || '';
  const departmentFilter = normalizeOptionalFilter(sp.department) || '';
  const statusFilter = normalizeOptionalFilter(sp.status) || '';
  const availabilityFilter = normalizeOptionalFilter(sp.availability) || '';
  const currentPage = Math.max(1, parseInt(sp.page || '1', 10) || 1);
  const totalPages = Math.ceil(totalCount / DEFAULT_PAGE_SIZE);
  const offset = (currentPage - 1) * DEFAULT_PAGE_SIZE;

  // Serialized filter state so the row actions / detail links can restore the
  // exact directory view when the user navigates back.
  const returnQuery = new URLSearchParams();
  if (query) returnQuery.set('q', query);
  if (officeFilter) returnQuery.set('office', officeFilter);
  if (departmentFilter) returnQuery.set('department', departmentFilter);
  if (statusFilter) returnQuery.set('status', statusFilter);
  if (availabilityFilter) returnQuery.set('availability', availabilityFilter);
  if (currentPage > 1) returnQuery.set('page', String(currentPage));
  const returnQueryString = returnQuery.toString();

  const canManageRoles = await hasPermission(session, Permissions.TENANT_MANAGE);
  const canManageLifecycle = await hasPermission(session, Permissions.STAFF_LIFECYCLE_MANAGE);
  const canManageDriver = await hasPermission(session, Permissions.DRIVER_MANAGE);

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
      <Breadcrumbs
        items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Staff Directory' }]}
      />
      <PageHeader
        title="Staff Directory"
        description={`${totalCount} employee${totalCount !== 1 ? 's' : ''} on record`}
      >
        {canImport && (
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/staff/import">
              <Upload className="h-4 w-4" />
              Import
            </Link>
          </Button>
        )}
        {canCreate && (
          <Button variant="primary" size="sm" asChild>
            <Link href="/dashboard/staff/new">
              <Plus className="h-4 w-4" />
              Add Employee
            </Link>
          </Button>
        )}
      </PageHeader>

      <div className="border-border bg-surface rounded-[10px] border p-4">
        <FilterToolbar
          resetHref="/dashboard/staff"
          isFiltered={hasActiveFilters({
            q: query,
            office: officeFilter,
            department: departmentFilter,
            status: statusFilter,
            availability: availabilityFilter,
          })}
          className="items-center gap-3"
        >
          <LiveSearchInput
            name="q"
            defaultValue={query}
            placeholder="Search by name, employee number, email…"
          />
          <StyledSelect name="office" defaultValue={officeFilter} placeholder="All Offices">
            {allOffices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </StyledSelect>
          <StyledSelect
            name="department"
            defaultValue={departmentFilter}
            placeholder="All Departments"
          >
            {allDepartments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </StyledSelect>
          <StyledSelect name="status" defaultValue={statusFilter} placeholder="All employees">
            <option value="active">Active</option>
            <option value="on_leave">On leave</option>
            <option value="temporarily_unavailable">Temporarily unavailable</option>
            <option value="suspended">Suspended</option>
            <option value="transferred">Transferred</option>
            <option value="contract_ended">Contract ended</option>
            <option value="retired">Retired</option>
            <option value="archived">Archived</option>
          </StyledSelect>
          <StyledSelect
            name="availability"
            defaultValue={availabilityFilter}
            placeholder="All availability"
          >
            <option value="available">Available</option>
            <option value="annual_leave">Annual leave</option>
            <option value="sick_leave">Sick leave</option>
            <option value="official_travel">Official travel</option>
            <option value="training">Training</option>
            <option value="temporarily_unavailable">Temporarily unavailable</option>
          </StyledSelect>
        </FilterToolbar>
      </div>

      <div className="space-y-3 md:hidden">
        {staffList.map((row) => (
          <div key={row.id} className="border-border bg-surface rounded-[10px] border p-4">
            <div className="flex items-start gap-3">
              <div className="bg-brand-50 text-brand-800 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px] text-xs font-semibold">
                {row.profilePhotoUrl ? (
                  <img src={row.profilePhotoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <>
                    {row.firstName[0]}
                    {row.lastName[0]}
                  </>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/dashboard/staff/${row.id}${returnQueryString ? `?${returnQueryString}` : ''}`}
                  className="text-ink-950 font-medium"
                >
                  {row.firstName} {row.lastName}
                </Link>
                <p className="text-ink-500 truncate text-xs">
                  {row.employeeNumber} · {row.jobTitle || 'Position not recorded'}
                </p>
                <p className="text-ink-500 truncate text-xs">
                  {row.officeName || 'Office not recorded'}
                </p>
                {row.roleNames && (
                  <p className="text-brand-700 mt-0.5 truncate text-xs font-medium">
                    {row.roleNames}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <StaffRowActions
                  employeeId={row.id}
                  employeeName={`${row.firstName} ${row.lastName}`}
                  hasAccount={Boolean(row.userId)}
                  userId={row.userId}
                  archived={row.employmentStatus === 'archived'}
                  canManageRoles={canManageRoles}
                  canManageAvailability={canManageLifecycle}
                  canManageDriver={canManageDriver}
                  canArchive={canManageLifecycle}
                  returnQuery={returnQueryString}
                />
                <Link
                  href={`/dashboard/staff/${row.id}${returnQueryString ? `?${returnQueryString}` : ''}`}
                  className="border-border text-brand-700 rounded-[8px] border px-3 py-1.5 text-xs font-medium"
                >
                  View
                </Link>
              </div>
            </div>
            <details className="group mt-3">
              <summary className="text-ink-500 flex cursor-pointer list-none items-center gap-1 text-xs font-medium select-none [&::-webkit-details-marker]:hidden">
                More details
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-2 space-y-1.5 text-xs">
                <p className="text-ink-500">
                  <span className="font-medium text-ink-700">Department:</span>{' '}
                  {row.departmentName || '—'}
                </p>
                <p className="text-ink-500">
                  <span className="font-medium text-ink-700">Office:</span>{' '}
                  {row.officeName || '—'}
                </p>
                <p className="text-ink-500">
                  <span className="font-medium text-ink-700">Employee #:</span>{' '}
                  {row.employeeNumber}
                </p>
                {row.isActing && (
                  <p className="text-brand-700">Currently acting in a delegated role</p>
                )}
              </div>
            </details>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusBadge
                status={row.employmentStatus === 'active' ? 'success' : 'error'}
                label={row.employmentStatus.replaceAll('_', ' ')}
              />
              <StatusBadge
                status={row.availabilityStatus === 'available' ? 'success' : 'pending'}
                label={row.availabilityStatus.replaceAll('_', ' ')}
              />
              {row.isDriver && <StatusBadge status="info" label="Driver" />}
              {row.isActing && <StatusBadge status="info" label="Acting" />}
              {!row.accountStatus && <StatusBadge status="pending" label="No account" />}
            </div>
          </div>
        ))}
        {!staffList.length && (
          <div className="border-border text-ink-500 rounded-[10px] border border-dashed p-8 text-center text-sm">
            No employees match these filters.
          </div>
        )}
      </div>

      <div className="border-border bg-surface hidden overflow-hidden rounded-[10px] border md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border bg-muted border-b">
                <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                  Employee
                </th>
                <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                  Employee #
                </th>
                <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                  Department
                </th>
                <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                  Office
                </th>
                <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                  Status
                </th>
                <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                  Availability
                </th>
                <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                  Account
                </th>
                <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                  Driver
                </th>
                <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                  Acting
                </th>
                <th className="text-ink-500 px-4 py-3 text-right text-xs font-medium tracking-wider uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {staffList.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-ink-500 px-4 py-12 text-center text-sm">
                    {query || officeFilter || departmentFilter || statusFilter || availabilityFilter
                      ? 'No employees match your search criteria.'
                      : 'No active employees have been added yet.'}
                  </td>
                </tr>
              ) : (
                staffList.map((row) => (
                  <tr key={row.id} className="hover:bg-canvas/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="bg-brand-50 text-brand-800 flex h-8 w-8 items-center justify-center rounded-[6px] text-xs font-semibold">
                          {row.firstName.charAt(0)}
                          {row.lastName.charAt(0)}
                        </div>
                        <div>
                          <Link
                            href={`/dashboard/staff/${row.id}`}
                            className="text-ink-950 hover:text-brand-600 font-medium transition-colors"
                          >
                            {row.firstName} {row.lastName}
                          </Link>
                          <p className="text-ink-500 text-xs">{row.jobTitle}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-ink-500 px-4 py-3 text-xs tabular-nums">
                      {row.employeeNumber}
                    </td>
                    <td className="text-ink-700 px-4 py-3 text-sm">{row.departmentName || '—'}</td>
                    <td className="text-ink-700 px-4 py-3 text-sm">{row.officeName || '—'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={
                          row.employmentStatus === 'active'
                            ? 'success'
                            : row.employmentStatus === 'suspended'
                              ? 'pending'
                              : 'error'
                        }
                        label={
                          row.employmentStatus.charAt(0).toUpperCase() +
                          row.employmentStatus.slice(1)
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={row.availabilityStatus === 'available' ? 'success' : 'pending'}
                        label={row.availabilityStatus.replaceAll('_', ' ')}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {row.accountStatus ? (
                        <StatusBadge
                          status={row.accountStatus === 'active' ? 'success' : 'error'}
                          label={row.accountStatus}
                        />
                      ) : (
                        <StatusBadge status="pending" label="No account" />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.isDriver ? (
                        <StatusBadge status="info" label="Driver" />
                      ) : (
                        <span className="text-ink-500 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.isActing ? (
                        <StatusBadge status="info" label="Acting" />
                      ) : (
                        <span className="text-ink-500 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/dashboard/staff/${row.id}${returnQueryString ? `?${returnQueryString}` : ''}`}
                          className="text-brand-600 hover:text-brand-700 inline-flex items-center gap-1 text-xs font-medium transition-colors"
                        >
                          View <ChevronRight className="h-3 w-3" />
                        </Link>
                        <StaffRowActions
                          employeeId={row.id}
                          employeeName={`${row.firstName} ${row.lastName}`}
                          hasAccount={Boolean(row.userId)}
                          userId={row.userId}
                          archived={row.employmentStatus === 'archived'}
                          canManageRoles={canManageRoles}
                          canManageAvailability={canManageLifecycle}
                          canManageDriver={canManageDriver}
                          canArchive={canManageLifecycle}
                          returnQuery={returnQueryString}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="border-border flex items-center justify-between border-t px-4 py-3">
            <p className="text-ink-500 text-xs">
              Showing {offset + 1}–{Math.min(offset + DEFAULT_PAGE_SIZE, totalCount)} of{' '}
              {totalCount}
            </p>
            <div className="flex items-center gap-2">
              {currentPage > 1 ? (
                <Link
                  href={buildPageUrl({ page: String(currentPage - 1) })}
                  className="border-border text-ink-700 hover:bg-muted inline-flex h-8 items-center rounded-[6px] border px-3 text-xs transition-colors"
                >
                  <ChevronLeft className="mr-1 h-3 w-3" />
                  Previous
                </Link>
              ) : (
                <button
                  className="border-border text-ink-500 h-8 cursor-not-allowed rounded-[6px] border px-3 text-xs opacity-50"
                  disabled
                >
                  <ChevronLeft className="mr-1 h-3 w-3" />
                  Previous
                </button>
              )}
              {currentPage < totalPages ? (
                <Link
                  href={buildPageUrl({ page: String(currentPage + 1) })}
                  className="border-border text-ink-700 hover:bg-muted inline-flex h-8 items-center rounded-[6px] border px-3 text-xs transition-colors"
                >
                  Next
                  <ChevronRight className="ml-1 h-3 w-3" />
                </Link>
              ) : (
                <button
                  className="border-border text-ink-500 h-8 cursor-not-allowed rounded-[6px] border px-3 text-xs opacity-50"
                  disabled
                >
                  Next
                  <ChevronRight className="ml-1 h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
