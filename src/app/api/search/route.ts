import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import { getSessionRoleNames, requireRequestAuth } from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';

export interface GlobalSearchResult {
  id: string;
  type: 'request' | 'vehicle' | 'employee';
  title: string;
  subtitle: string;
  href: string;
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const query = request.nextUrl.searchParams.get('q')?.trim().slice(0, 100) || '';
  if (query.length < 2) {
    return NextResponse.json({ success: true, data: [] });
  }

  const roleNames = await getSessionRoleNames(session);
  const requestAccess = resolveDashboardAccess('/dashboard/requests', roleNames);
  const vehicleAccess = resolveDashboardAccess('/dashboard/fleet', roleNames);
  const employeeAccess = resolveDashboardAccess('/dashboard/staff', roleNames);
  const db = getDb();
  const tasks: Array<Promise<GlobalSearchResult[]>> = [];

  if (requestAccess.allowed) {
    const canViewAll = requestAccess.recordScope === 'tenant';
    tasks.push(
      db
        .select({
          id: transportRequests.id,
          reference: transportRequests.reference,
          purpose: transportRequests.purpose,
          status: transportRequests.status,
        })
        .from(transportRequests)
        .where(and(
          eq(transportRequests.tenantId, session.tenantId),
          canViewAll ? undefined : eq(transportRequests.requesterUserId, session.user.id),
          or(
            ilike(transportRequests.reference, `%${query}%`),
            ilike(transportRequests.purpose, `%${query}%`),
            ilike(transportRequests.department, `%${query}%`),
          ),
        ))
        .orderBy(desc(transportRequests.createdAt))
        .limit(8)
        .then((rows) => rows.map((row) => ({
          id: row.id,
          type: 'request' as const,
          title: row.reference,
          subtitle: `${row.purpose || 'Transport request'} · ${row.status.replaceAll('_', ' ')}`,
          href: `/dashboard/requests/${row.id}`,
        }))),
    );
  }

  if (vehicleAccess.allowed) {
    tasks.push(
      db
        .select({
          id: vehicles.id,
          licenceNumber: vehicles.licenceNumber,
          make: vehicles.make,
          model: vehicles.model,
          status: vehicles.status,
        })
        .from(vehicles)
        .where(and(
          eq(vehicles.tenantId, session.tenantId),
          eq(vehicles.isActive, true),
          or(
            ilike(vehicles.licenceNumber, `%${query}%`),
            ilike(vehicles.vehicleRegisterNumber, `%${query}%`),
            ilike(vehicles.make, `%${query}%`),
            ilike(vehicles.model, `%${query}%`),
          ),
        ))
        .limit(8)
        .then((rows) => rows.map((row) => ({
          id: row.id,
          type: 'vehicle' as const,
          title: row.licenceNumber,
          subtitle: `${row.make} ${row.model} · ${row.status.replaceAll('_', ' ')}`,
          href: `/dashboard/fleet/${row.id}`,
        }))),
    );
  }

  if (employeeAccess.allowed) {
    tasks.push(
      db
        .select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          employeeNumber: employees.employeeNumber,
          jobTitle: employees.jobTitle,
        })
        .from(employees)
        .where(and(
          eq(employees.tenantId, session.tenantId),
          or(
            ilike(employees.firstName, `%${query}%`),
            ilike(employees.lastName, `%${query}%`),
            ilike(employees.employeeNumber, `%${query}%`),
            ilike(employees.email, `%${query}%`),
          ),
        ))
        .limit(8)
        .then((rows) => rows.map((row) => ({
          id: row.id,
          type: 'employee' as const,
          title: `${row.firstName} ${row.lastName}`,
          subtitle: `${row.employeeNumber}${row.jobTitle ? ` · ${row.jobTitle}` : ''}`,
          href: `/dashboard/staff/${row.id}`,
        }))),
    );
  }

  const data = (await Promise.all(tasks)).flat().slice(0, 20);
  return NextResponse.json(
    { success: true, data },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
