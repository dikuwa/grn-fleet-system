/**
 * Platform Tenant Detail API
 *
 * GET    /api/platform/tenants/[id] — tenant details + deletion/readiness assessment
 * PATCH  /api/platform/tenants/[id] — controlled tenant/lifecycle update
 * DELETE /api/platform/tenants/[id] — controlled hard-delete; populated tenants
 * require suspension/archive plus an explicit force confirmation
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, count, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { tenants, tenantBranding, tenantMemberships } from '@/db/schema/tenants';
import { employees } from '@/db/schema/people';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { trips } from '@/db/schema/trips';
import { programmes } from '@/db/schema/programmes';
import { requireRequestAuth, requirePermission, requireAnyPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';
import { assessTenantOperationalReadiness } from '@/lib/platform/tenant-readiness';

type DeletionAssessmentDb = Pick<ReturnType<typeof getDb>, 'select'>;

async function getDeletionAssessment(
  tenantId: string,
  db: DeletionAssessmentDb = getDb(),
) {
  const [members, staff, fleet, requests, tripRows, programmeRows] = await Promise.all([
    db.select({ count: count() }).from(tenantMemberships).where(eq(tenantMemberships.tenantId, tenantId)),
    db.select({ count: count() }).from(employees).where(eq(employees.tenantId, tenantId)),
    db.select({ count: count() }).from(vehicles).where(eq(vehicles.tenantId, tenantId)),
    db.select({ count: count() }).from(transportRequests).where(eq(transportRequests.tenantId, tenantId)),
    db.select({ count: count() }).from(trips).where(eq(trips.tenantId, tenantId)),
    db.select({ count: count() }).from(programmes).where(eq(programmes.tenantId, tenantId)),
  ]);

  const blockers = {
    members: Number(members[0]?.count ?? 0),
    staff: Number(staff[0]?.count ?? 0),
    vehicles: Number(fleet[0]?.count ?? 0),
    transportRequests: Number(requests[0]?.count ?? 0),
    trips: Number(tripRows[0]?.count ?? 0),
    programmes: Number(programmeRows[0]?.count ?? 0),
  };
  const substantiveRecordCount = Object.values(blockers).reduce((sum, value) => sum + value, 0);

  return {
    canDelete: substantiveRecordCount === 0,
    substantiveRecordCount,
    blockers,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requireAnyPermission(session, [Permissions.PLATFORM_ADMIN, Permissions.TENANT_VIEW]);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    // Keep the long-standing tenant-detail contract independent from the
    // readiness summary. A readiness read failure must not hide branding,
    // activity or deletion information. Activation itself remains strict in
    // PATCH below and never falls back when readiness cannot be assessed.
    const [[branding], deletion] = await Promise.all([
      db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, id)).limit(1),
      getDeletionAssessment(id),
    ]);

    let readiness = null;
    try {
      readiness = await assessTenantOperationalReadiness(id);
    } catch (readinessError) {
      console.error('[Platform Tenant Detail] Readiness assessment failed:', readinessError);
    }

    return NextResponse.json({
      success: true,
      data: {
        ...tenant,
        branding: branding || null,
        stats: { memberCount: deletion.blockers.members },
        deletion,
        readiness,
      },
    });
  } catch (error) {
    console.error('[Platform Tenant Detail] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load tenant: ' + String(error) }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.PLATFORM_ADMIN);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const db = getDb();
    const [existing] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    if (!existing) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    const LIFECYCLE_TRANSITIONS: Record<string, string[]> = {
      DRAFT: ['PENDING_INVITATION', 'ARCHIVED'],
      PENDING_INVITATION: ['INVITATION_SENT', 'ONBOARDING_FAILED', 'ARCHIVED'],
      INVITATION_SENT: ['SETUP_IN_PROGRESS', 'INVITATION_EXPIRED', 'ONBOARDING_FAILED', 'ARCHIVED'],
      INVITATION_EXPIRED: ['PENDING_INVITATION', 'ONBOARDING_FAILED', 'ARCHIVED'],
      SETUP_IN_PROGRESS: ['PENDING_PLATFORM_REVIEW', 'ONBOARDING_FAILED', 'ARCHIVED'],
      PENDING_PLATFORM_REVIEW: ['READY_FOR_ACTIVATION', 'ACTIVE', 'ONBOARDING_FAILED', 'ARCHIVED'],
      READY_FOR_ACTIVATION: ['ACTIVE', 'ONBOARDING_FAILED', 'ARCHIVED'],
      ACTIVE: ['SUSPENDED', 'RESTRICTED', 'ARCHIVED'],
      SUSPENDED: ['ACTIVE', 'RESTRICTED', 'ARCHIVED'],
      RESTRICTED: ['ACTIVE', 'SUSPENDED', 'ARCHIVED'],
      ONBOARDING_FAILED: ['DRAFT', 'ARCHIVED'],
      ARCHIVED: ['ACTIVE'],
    };

    const lifecycleTarget = body.lifecycleStatus;
    const lifecycleChanges = lifecycleTarget !== undefined && lifecycleTarget !== existing.lifecycleStatus;
    if (lifecycleChanges) {
      const allowed = LIFECYCLE_TRANSITIONS[existing.lifecycleStatus] ?? [];
      if (!allowed.includes(lifecycleTarget)) {
        return NextResponse.json(
          { error: `Invalid lifecycle transition from ${existing.lifecycleStatus} to ${lifecycleTarget}.` },
          { status: 400 },
        );
      }

      if (lifecycleTarget === 'READY_FOR_ACTIVATION' || lifecycleTarget === 'ACTIVE') {
        const readiness = await assessTenantOperationalReadiness(id);
        if (!readiness.readyForActivation) {
          return NextResponse.json(
            {
              error: 'Tenant is not ready for activation. Resolve the operational blockers first.',
              readiness,
            },
            { status: 409 },
          );
        }
      }
    }

    const tenantUpdate: Record<string, unknown> = {};
    if (body.name !== undefined) tenantUpdate.name = String(body.name).trim();
    if (body.status !== undefined) tenantUpdate.status = String(body.status).toUpperCase();
    if (body.timezone !== undefined) tenantUpdate.timezone = body.timezone;
    if (body.locale !== undefined) tenantUpdate.locale = body.locale;
    if (body.type !== undefined) tenantUpdate.type = body.type;
    if (body.metadata !== undefined) tenantUpdate.metadata = body.metadata;
    if (lifecycleTarget !== undefined) {
      tenantUpdate.lifecycleStatus = lifecycleTarget;
      tenantUpdate.lifecycleChangedAt = new Date();
      tenantUpdate.lifecycleReason = body.lifecycleReason ?? null;
    }
    tenantUpdate.updatedAt = new Date();

    if (Object.keys(tenantUpdate).length > 1) {
      if (lifecycleChanges) {
        const [updatedLifecycle] = await db
          .update(tenants)
          .set(tenantUpdate)
          .where(and(
            eq(tenants.id, id),
            eq(tenants.lifecycleStatus, existing.lifecycleStatus),
          ))
          .returning({ id: tenants.id });
        if (!updatedLifecycle) {
          return NextResponse.json(
            {
              error: 'This tenant lifecycle changed while the update was being prepared. Refresh the tenant and review its current state before retrying.',
            },
            { status: 409 },
          );
        }
      } else {
        await db.update(tenants).set(tenantUpdate).where(eq(tenants.id, id));
      }
    }

    if (lifecycleChanges) {
      await recordAuditEvent({
        tenantId: existing.id,
        actorUserId: session.user.id,
        action: 'tenant.lifecycle_changed',
        entityType: 'tenant',
        entityId: existing.id,
        summary: `Tenant lifecycle changed from ${existing.lifecycleStatus} to ${lifecycleTarget}`,
        before: { lifecycleStatus: existing.lifecycleStatus },
        after: { lifecycleStatus: lifecycleTarget },
      }).catch(() => {});
    }

    const brandingFields = [
      'contactEmail', 'contactPhone', 'address', 'primaryColor', 'accentColor',
      'logoUrl', 'logoDarkUrl', 'documentFooter', 'senderName', 'senderEmail',
    ];
    const brandingUpdate: Record<string, unknown> = {};
    for (const field of brandingFields) {
      if (body[field] !== undefined) brandingUpdate[field] = body[field];
    }

    if (Object.keys(brandingUpdate).length > 0) {
      const [existingBranding] = await db
        .select()
        .from(tenantBranding)
        .where(eq(tenantBranding.tenantId, id))
        .limit(1);
      if (existingBranding) {
        brandingUpdate.updatedAt = new Date();
        await db.update(tenantBranding).set(brandingUpdate).where(eq(tenantBranding.tenantId, id));
      } else {
        await db.insert(tenantBranding).values({ tenantId: id, ...brandingUpdate } as never);
      }
    }

    const [updated] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Platform Tenant Detail] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update tenant: ' + String(error) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.PLATFORM_ADMIN);
    if (permCheck instanceof NextResponse) return permCheck;

    const force = request.nextUrl.searchParams.get('force') === 'true';
    const confirmation = request.nextUrl.searchParams.get('confirm') ?? '';
    const db = getDb();

    const deletionResult = await db.transaction(async (tx) => {
      const [tenant] = await tx
        .select()
        .from(tenants)
        .where(eq(tenants.id, id))
        .limit(1)
        .for('update');
      if (!tenant) return { kind: 'not_found' } as const;

      // Lock the parent tenant row before assessing children. PostgreSQL foreign-key
      // checks for new tenant-owned rows require a conflicting key-share lock, so
      // concurrent inserts cannot slip in between this assessment and the delete.
      const deletion = await getDeletionAssessment(id, tx);
      const expectedConfirmation = deletion.canDelete ? tenant.code : `DELETE ${tenant.code}`;
      if (confirmation !== expectedConfirmation) {
        return { kind: 'invalid_confirmation', expectedConfirmation } as const;
      }

      const isInactive = tenant.status === 'SUSPENDED'
        || tenant.status === 'ARCHIVED'
        || tenant.lifecycleStatus === 'ARCHIVED';
      if (!deletion.canDelete && (!force || !isInactive)) {
        return { kind: 'blocked', tenant, deletion, isInactive } as const;
      }

      await recordAuditEvent({
        tenantId: tenant.id,
        actorUserId: session.user.id,
        action: 'tenant.permanent_delete_requested',
        entityType: 'tenant',
        entityId: tenant.id,
        summary: `Platform administrator permanently deleted ${deletion.canDelete ? 'empty' : 'populated'} tenant ${tenant.name} (${tenant.code}).`,
        before: { name: tenant.name, code: tenant.code, slug: tenant.slug, status: tenant.status, lifecycleStatus: tenant.lifecycleStatus },
      }, tx).catch(() => {});

      await tx.delete(tenants).where(eq(tenants.id, id));

      return { kind: 'deleted', tenant, deletion } as const;
    });

    if (deletionResult.kind === 'not_found') {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    if (deletionResult.kind === 'invalid_confirmation') {
      return NextResponse.json(
        { error: `Type ${deletionResult.expectedConfirmation} to confirm permanent deletion.` },
        { status: 400 },
      );
    }

    if (deletionResult.kind === 'blocked') {
      return NextResponse.json(
        {
          error: deletionResult.isInactive
            ? 'This tenant contains records. Use the populated-tenant confirmation to delete it and its tenant-owned data.'
            : 'Suspend or archive this tenant before deleting it with records.',
          deletion: deletionResult.deletion,
          alternatives: ['SUSPENDED', 'ARCHIVED'],
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: deletionResult.tenant.id,
        name: deletionResult.tenant.name,
        code: deletionResult.tenant.code,
        deleted: true,
        removedRecordAssessment: deletionResult.deletion,
      },
    });
  } catch (error) {
    console.error('[Platform Tenant Detail] DELETE failed:', error);
    return NextResponse.json(
      { error: 'Tenant could not be permanently deleted. It may still have protected dependent records.' },
      { status: 409 },
    );
  }
}
