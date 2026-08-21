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
import { assessTenantOperationalReadiness } from '@/lib/platform/tenant-readiness';
import { recordAuditEvent } from '@/lib/audit-event';

const REVIEW_RETURN_PREFIX = 'Platform review returned for changes:';

async function requireOperationalSetupAccess(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth;
  const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
  if (permission instanceof NextResponse) return { ok: false as const, error: permission };
  return auth;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireOperationalSetupAccess(request);
    if (!auth.ok) return auth.error;

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
          lifecycleReason: tenants.lifecycleReason,
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
    const reviewFeedback =
      tenant.lifecycleStatus === 'SETUP_IN_PROGRESS'
      && tenant.lifecycleReason?.startsWith(REVIEW_RETURN_PREFIX)
        ? tenant.lifecycleReason.slice(REVIEW_RETURN_PREFIX.length).trim()
        : null;

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
        description: 'Organisation identity and at least one operating location have been confirmed.',
        category: 'required',
        ready: setup?.isReady === true,
        href: '/dashboard/setup',
        actionLabel: 'Complete initial setup',
      },
      {
        id: 'workflow',
        label: 'Approval workflow',
        description: workflowReady
          ? `${counts.workflows} active workflow${counts.workflows === 1 ? '' : 's'} configured.`
          : 'Choose a simple, standard or controlled workflow and confirm who handles each approval stage.',
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
          : 'Active departure and return inspection templates are required before operational setup can be submitted. A passing departure inspection remains mandatory before physical vehicle release.',
        category: 'required',
        ready: inspectionTemplatesReady,
        href: '/dashboard/inspections/templates',
        actionLabel: 'Review templates',
      },
      {
        id: 'staff',
        label: 'Staff directory',
        description: counts.staff > 0
          ? `${counts.staff} active staff member${counts.staff === 1 ? '' : 's'} available for requests and assignments.`
          : 'Import or add staff when you are ready to assign requesters, passengers and operational roles.',
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
          : 'Disabled by default. Enable it only if staff without dashboard accounts should submit requests.',
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
          reviewFeedback,
        },
        counts,
        requiredRemaining,
        canSubmitForReview:
          requiredRemaining === 0 && tenant.lifecycleStatus === 'SETUP_IN_PROGRESS',
        checklist,
      },
    });
  } catch (error) {
    console.error('[Operational Setup] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load operational setup status' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireOperationalSetupAccess(request);
    if (!auth.ok) return auth.error;

    const tenantId = auth.session.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as { action?: string };
    if (body.action !== 'submit_for_review') {
      return NextResponse.json({ error: 'Unsupported operational setup action.' }, { status: 400 });
    }

    const db = getDb();
    const [tenant] = await db
      .select({ id: tenants.id, lifecycleStatus: tenants.lifecycleStatus })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    if (tenant.lifecycleStatus === 'PENDING_PLATFORM_REVIEW') {
      return NextResponse.json({
        success: true,
        data: { lifecycleStatus: tenant.lifecycleStatus, alreadySubmitted: true },
      });
    }
    if (tenant.lifecycleStatus !== 'SETUP_IN_PROGRESS') {
      return NextResponse.json(
        { error: `This tenant cannot be submitted for review while its lifecycle is ${tenant.lifecycleStatus}.` },
        { status: 409 },
      );
    }

    const readiness = await assessTenantOperationalReadiness(tenantId);
    if (!readiness.readyForActivation) {
      const blockers = readiness.checks
        .filter((check) => check.severity === 'blocker' && !check.ready)
        .map((check) => check.label);
      return NextResponse.json(
        {
          error: blockers.length
            ? `Resolve these required items before Platform Review: ${blockers.join(', ')}.`
            : 'Resolve the remaining activation requirements before Platform Review.',
          readiness,
        },
        { status: 409 },
      );
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(tenants)
        .set({
          lifecycleStatus: 'PENDING_PLATFORM_REVIEW',
          lifecycleReason: 'Tenant operational setup submitted for platform review',
          lifecycleChangedAt: now,
          updatedAt: now,
        })
        .where(eq(tenants.id, tenantId));

      await recordAuditEvent({
        tenantId,
        actorUserId: auth.session.user.id,
        eventType: 'tenant_operational_setup_submitted',
        action: 'submit',
        entityType: 'tenant',
        entityId: tenantId,
        before: { lifecycleStatus: tenant.lifecycleStatus },
        after: { lifecycleStatus: 'PENDING_PLATFORM_REVIEW' },
        summary: 'Tenant operational setup submitted for platform review',
      }, tx);
    });

    return NextResponse.json({
      success: true,
      data: {
        lifecycleStatus: 'PENDING_PLATFORM_REVIEW',
        readiness,
      },
    });
  } catch (error) {
    console.error('[Operational Setup] POST failed:', error);
    return NextResponse.json({ error: 'Failed to submit operational setup for review' }, { status: 500 });
  }
}
