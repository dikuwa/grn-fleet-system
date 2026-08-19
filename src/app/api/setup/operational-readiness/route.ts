import { NextRequest, NextResponse } from 'next/server';
import { and, count, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { tenantSetupProgress } from '@/db/schema/invitations';
import { departments, employees, offices } from '@/db/schema/people';
import { vehicles } from '@/db/schema/fleet';
import { fleetPaymentProviders } from '@/db/schema/fleet-payments';
import { tenants } from '@/db/schema/tenants';
import { inspectionTemplates } from '@/db/schema/trips';
import { workflowDefinitions, workflowSteps } from '@/db/schema/workflows';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { isPublicEmployeeRequestEnabled } from '@/lib/public-request-access';

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
      activeInspectionTemplates,
      [fleetPaymentProviderTotal],
    ] = await Promise.all([
      db
        .select({
          id: tenants.id,
          name: tenants.name,
          lifecycleStatus: tenants.lifecycleStatus,
          metadata: tenants.metadata,
        })
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
      db
        .select({ type: inspectionTemplates.type })
        .from(inspectionTemplates)
        .where(
          and(
            eq(inspectionTemplates.tenantId, tenantId),
            eq(inspectionTemplates.isActive, true),
          ),
        ),
      db
        .select({ total: count() })
        .from(fleetPaymentProviders)
        .where(
          and(
            eq(fleetPaymentProviders.tenantId, tenantId),
            eq(fleetPaymentProviders.status, 'active'),
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

    const activeInspectionTypes = new Set(activeInspectionTemplates.map((template) => template.type));
    const inspectionTemplatesReady =
      activeInspectionTypes.has('departure') && activeInspectionTypes.has('return');
    const employeeRequestAccessEnabled = isPublicEmployeeRequestEnabled(tenant.metadata);
    const fleetPaymentsConfigured = Number(fleetPaymentProviderTotal?.total ?? 0) > 0;

    const counts = {
      offices: Number(officeTotal?.total ?? 0),
      departments: Number(departmentTotal?.total ?? 0),
      staff: Number(staffTotal?.total ?? 0),
      drivers: Number(driverTotal?.total ?? 0),
      vehicles: Number(vehicleTotal?.total ?? 0),
      workflows: activeWorkflows.length,
      inspectionTemplates: activeInspectionTypes.size,
      fleetPaymentProviders: Number(fleetPaymentProviderTotal?.total ?? 0),
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
        id: 'inspection-templates',
        label: 'Vehicle inspection checklists',
        description: inspectionTemplatesReady
          ? 'Active departure and return inspection templates are available for safe vehicle issue and return.'
          : 'Review inspection templates before physical vehicle issue. A passing departure inspection is required before release.',
        category: 'recommended',
        ready: inspectionTemplatesReady,
        href: '/dashboard/inspections/templates',
        actionLabel: 'Review templates',
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
        label: 'Employee request access',
        description: employeeRequestAccessEnabled
          ? 'The secure employee request link is enabled for staff who do not have dashboard accounts.'
          : 'The secure employee request link is disabled. Enable it only if this organisation wants staff without dashboard accounts to submit requests.',
        category: 'optional',
        ready: employeeRequestAccessEnabled,
        href: '/dashboard/settings/request-access',
        actionLabel: 'Review request access',
      },
      {
        id: 'fleet-payments',
        label: 'Fleet Payments / BlueFuel',
        description: fleetPaymentsConfigured
          ? `${counts.fleetPaymentProviders} active fleet-payment provider${counts.fleetPaymentProviders === 1 ? '' : 's'} configured.`
          : 'Optional: configure a provider or manual import workflow only if the organisation uses fleet-payment services.',
        category: 'optional',
        ready: fleetPaymentsConfigured,
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
