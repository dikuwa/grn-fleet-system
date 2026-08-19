import { NextRequest, NextResponse } from 'next/server';
import { and, count, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { tenantSetupProgress } from '@/db/schema/invitations';
import { departments, employees, offices } from '@/db/schema/people';
import { vehicles } from '@/db/schema/fleet';
import { tenants } from '@/db/schema/tenants';
import { workflowDefinitions, workflowSteps } from '@/db/schema/workflows';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;

    const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
    if (permission instanceof NextResponse) return permission;

    const tenantId = auth.session.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
    }

    const db = getDb();
    const [
      [tenant],
      [setup],
      [officeTotal],
      [departmentTotal],
      [staffTotal],
      [driverTotal],
      [vehicleTotal],
      activeWorkflows,
    ] = await Promise.all([
      db
        .select({ id: tenants.id, name: tenants.name, lifecycleStatus: tenants.lifecycleStatus })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1),
      db
        .select({ isReady: tenantSetupProgress.isReady })
        .from(tenantSetupProgress)
        .where(eq(tenantSetupProgress.tenantId, tenantId))
        .limit(1),
      db
        .select({ total: count() })
        .from(offices)
        .where(and(eq(offices.tenantId, tenantId), eq(offices.isActive, true))),
      db
        .select({ total: count() })
        .from(departments)
        .where(and(eq(departments.tenantId, tenantId), eq(departments.isActive, true))),
      db
        .select({ total: count() })
        .from(employees)
        .where(and(eq(employees.tenantId, tenantId), eq(employees.employmentStatus, 'active'))),
      db
        .select({ total: count() })
        .from(employees)
        .where(
          and(
            eq(employees.tenantId, tenantId),
            eq(employees.employmentStatus, 'active'),
            eq(employees.isDriver, true),
          ),
        ),
      db
        .select({ total: count() })
        .from(vehicles)
        .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.isActive, true))),
      db
        .select({ id: workflowDefinitions.id })
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.tenantId, tenantId),
            eq(workflowDefinitions.isActive, true),
          ),
        ),
    ]);

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    let workflowReady = false;
    if (activeWorkflows.length > 0) {
      const [stepTotal] = await db
        .select({ total: count() })
        .from(workflowSteps)
        .where(inArray(workflowSteps.definitionId, activeWorkflows.map((workflow) => workflow.id)));
      workflowReady = Number(stepTotal?.total ?? 0) > 0;
    }

    const counts = {
      offices: Number(officeTotal?.total ?? 0),
      departments: Number(departmentTotal?.total ?? 0),
      staff: Number(staffTotal?.total ?? 0),
      drivers: Number(driverTotal?.total ?? 0),
      vehicles: Number(vehicleTotal?.total ?? 0),
      workflows: activeWorkflows.length,
    };

    const checklist = [
      {
        id: 'initial-setup',
        label: 'Initial workspace setup',
        description: 'Organisation identity, offices and initial configuration have been saved.',
        category: 'required',
        ready: setup?.isReady === true,
        href: '/dashboard/setup',
        actionLabel: 'Review setup',
      },
      {
        id: 'workflow',
        label: 'Approval workflow',
        description: workflowReady
          ? `${counts.workflows} active workflow${counts.workflows === 1 ? '' : 's'} configured.`
          : 'Configure at least one active transport-request workflow with approval steps.',
        category: 'required',
        ready: workflowReady,
        href: '/dashboard/admin/workflows',
        actionLabel: 'Configure workflow',
      },
      {
        id: 'staff',
        label: 'Staff directory',
        description: counts.staff > 0
          ? `${counts.staff} active staff member${counts.staff === 1 ? '' : 's'} available for requests and assignments.`
          : 'Import or add staff so requesters, passengers and role assignments can be configured.',
        category: 'recommended',
        ready: counts.staff > 0,
        href: '/dashboard/staff/import',
        actionLabel: 'Import staff',
      },
      {
        id: 'vehicles',
        label: 'Fleet vehicles',
        description: counts.vehicles > 0
          ? `${counts.vehicles} active vehicle${counts.vehicles === 1 ? '' : 's'} registered.`
          : 'Add or import vehicles before physical trips are allocated.',
        category: 'recommended',
        ready: counts.vehicles > 0,
        href: '/dashboard/fleet',
        actionLabel: 'Manage fleet',
      },
      {
        id: 'drivers',
        label: 'Drivers',
        description: counts.drivers > 0
          ? `${counts.drivers} active staff driver${counts.drivers === 1 ? '' : 's'} identified.`
          : 'Identify authorised drivers and complete licence verification before trip release.',
        category: 'recommended',
        ready: counts.drivers > 0,
        href: '/dashboard/drivers',
        actionLabel: 'Manage drivers',
      },
      {
        id: 'departments',
        label: 'Departments / units',
        description: counts.departments > 0
          ? `${counts.departments} active organisational unit${counts.departments === 1 ? '' : 's'} configured.`
          : 'Optional for small tenants; useful for routing, reporting and staff organisation.',
        category: 'optional',
        ready: counts.departments > 0,
        href: '/dashboard/departments',
        actionLabel: 'Manage departments',
      },
      {
        id: 'request-access',
        label: 'External request access',
        description: 'Optional: enable the secure public request channel only if the organisation accepts requests from non-users.',
        category: 'optional',
        ready: false,
        href: '/dashboard/settings/request-access',
        actionLabel: 'Review request access',
      },
      {
        id: 'fleet-payments',
        label: 'Fleet Payments / BlueFuel',
        description: 'Optional: configure a payment provider or manual import workflow only if the organisation uses fleet-payment services.',
        category: 'optional',
        ready: false,
        href: '/dashboard/fuel/fleet-payments',
        actionLabel: 'Review Fleet Payments',
      },
    ] as const;

    const requiredRemaining = checklist.filter(
      (item) => item.category === 'required' && !item.ready,
    ).length;

    return NextResponse.json({
      success: true,
      data: {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          lifecycleStatus: tenant.lifecycleStatus,
        },
        counts,
        requiredRemaining,
        checklist,
      },
    });
  } catch (error) {
    console.error('[Operational Setup] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load operational setup status' }, { status: 500 });
  }
}
