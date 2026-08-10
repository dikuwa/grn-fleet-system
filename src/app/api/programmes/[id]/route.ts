import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { programmes } from '@/db/schema/programmes';
import { transportRequests } from '@/db/schema/requests';
import { employees, departments, offices } from '@/db/schema/people';
import { regions } from '@/db/schema/fleet';
import { hasPermission, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, or, sql } from 'drizzle-orm';
import { resolveActiveRoleRecipients } from '@/lib/notification-service';
import { SystemRoles } from '@/lib/workspaces';
import {
  isProgrammeOwnedByUser,
  resolveProgrammeAccess,
} from '@/lib/programme-access';

function isAtomicProgrammeMarker(error: unknown, marker: string) {
  return String((error as { message?: string })?.message || error).includes(marker);
}

/**
 * Programme detail API
 *
 * GET    /api/programmes/[id]  — own detail, tenant-wide for Tenant Admin, or shared approved/published detail
 * PATCH  /api/programmes/[id]  — edit own draft/changes-requested programme; Tenant Admin may edit any
 * DELETE /api/programmes/[id]  — delete own draft; Tenant Admin may delete any draft
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.PROGRAMME_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const access = await resolveProgrammeAccess(session);
    const [programme] = await db
      .select({
        id: programmes.id,
        reference: programmes.reference,
        title: programmes.title,
        description: programmes.description,
        purpose: programmes.purpose,
        departmentId: programmes.departmentId,
        department: programmes.department,
        ownerEmployeeId: programmes.ownerEmployeeId,
        ownerUserId: programmes.ownerUserId,
        startDate: programmes.startDate,
        endDate: programmes.endDate,
        venue: programmes.venue,
        officeId: programmes.officeId,
        regionId: programmes.regionId,
        region: programmes.region,
        expectedParticipants: programmes.expectedParticipants,
        plannedActivities: programmes.plannedActivities,
        estimatedTravelRequirement: programmes.estimatedTravelRequirement,
        estimatedKilometres: programmes.estimatedKilometres,
        status: programmes.status,
        reviewNotes: programmes.reviewNotes,
        rejectionReason: programmes.rejectionReason,
        createdByUserId: programmes.createdByUserId,
        reviewedByUserId: programmes.reviewedByUserId,
        approvedByUserId: programmes.approvedByUserId,
        publishedByUserId: programmes.publishedByUserId,
        submittedAt: programmes.submittedAt,
        reviewedAt: programmes.reviewedAt,
        approvedAt: programmes.approvedAt,
        publishedAt: programmes.publishedAt,
        archivedAt: programmes.archivedAt,
        completedAt: programmes.completedAt,
        createdAt: programmes.createdAt,
        updatedAt: programmes.updatedAt,
        ownerFirstName: employees.firstName,
        ownerLastName: employees.lastName,
        ownerJobTitle: employees.jobTitle,
        ownerEmail: employees.email,
        departmentName: departments.name,
        officeName: offices.name,
        regionName: regions.name,
      })
      .from(programmes)
      .leftJoin(employees, eq(programmes.ownerEmployeeId, employees.id))
      .leftJoin(departments, eq(programmes.departmentId, departments.id))
      .leftJoin(offices, eq(programmes.officeId, offices.id))
      .leftJoin(regions, eq(programmes.regionId, regions.id))
      .where(and(eq(programmes.id, id), eq(programmes.tenantId, session.tenantId)))
      .limit(1);

    if (!programme) return NextResponse.json({ error: 'Programme not found' }, { status: 404 });

    const isOwner = isProgrammeOwnedByUser(programme, session.user.id, access.employeeId);
    const isShared = ['approved', 'published'].includes(programme.status) && programme.archivedAt == null;
    if (!access.tenantWide && !isOwner && !isShared) {
      return NextResponse.json({ error: 'Programme not found' }, { status: 404 });
    }

    const [
      canEditOwn,
      canEditAny,
      canSubmitPermission,
      canReview,
      canApprove,
      canReject,
      canPublish,
      canArchive,
    ] = await Promise.all([
      hasPermission(session, Permissions.PROGRAMME_EDIT_OWN),
      hasPermission(session, Permissions.PROGRAMME_EDIT_ANY),
      hasPermission(session, Permissions.PROGRAMME_SUBMIT),
      hasPermission(session, Permissions.PROGRAMME_REVIEW),
      hasPermission(session, Permissions.PROGRAMME_APPROVE),
      hasPermission(session, Permissions.PROGRAMME_REJECT),
      hasPermission(session, Permissions.PROGRAMME_PUBLISH),
      hasPermission(session, Permissions.PROGRAMME_ARCHIVE),
    ]);

    const editableState = ['draft', 'changes_requested'].includes(programme.status);
    const canEdit = editableState && (isOwner ? canEditOwn : canEditAny);
    const canDelete = programme.status === 'draft' && (isOwner ? canEditOwn : canEditAny);
    const allowedActions: string[] = [];

    if (['draft', 'changes_requested'].includes(programme.status)) {
      if (canSubmitPermission && (isOwner || canEditAny)) {
        const reviewers = await resolveActiveRoleRecipients(session.tenantId, [SystemRoles.TENANT_ADMIN]);
        if (reviewers.some((recipientUserId) => recipientUserId !== session.user.id)) {
          allowedActions.push('submit');
        }
      }
      if (canArchive) allowedActions.push('archive');
    } else if (programme.status === 'submitted' && !isOwner) {
      if (canApprove) allowedActions.push('approve');
      if (canReview) allowedActions.push('request_changes');
      if (canReject) allowedActions.push('reject');
    } else if (programme.status === 'approved') {
      if (canPublish) allowedActions.push('publish');
      if (canArchive) allowedActions.push('archive');
    } else if (programme.status === 'published') {
      if (canPublish) allowedActions.push('complete');
      if (canArchive) allowedActions.push('archive');
    } else if (programme.status === 'completed' && canArchive) {
      allowedActions.push('archive');
    }

    const linkedConditions = [
      eq(transportRequests.programmeId, id),
      eq(transportRequests.tenantId, session.tenantId),
    ];
    if (!access.tenantWide) {
      linkedConditions.push(
        or(
          eq(transportRequests.requesterUserId, session.user.id),
          eq(transportRequests.enteredByUserId, session.user.id),
        )!,
      );
    }

    const linkedRequests = await db
      .select({
        id: transportRequests.id,
        reference: transportRequests.reference,
        status: transportRequests.status,
        purpose: transportRequests.purpose,
        createdAt: transportRequests.createdAt,
      })
      .from(transportRequests)
      .where(and(...linkedConditions))
      .orderBy(sql`${transportRequests.createdAt} DESC`);

    return NextResponse.json({
      success: true,
      data: {
        programme,
        linkedRequests,
        capabilities: { canEdit, canDelete, allowedActions },
      },
    });
  } catch (error) {
    console.error('[Programmes] GET detail failed:', error);
    return NextResponse.json({ error: 'Failed to load programme' }, { status: 500 });
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

    const db = getDb();
    const tenantId = session.tenantId;
    const userId = session.user.id;
    const access = await resolveProgrammeAccess(session);

    const [existing] = await db
      .select()
      .from(programmes)
      .where(and(eq(programmes.id, id), eq(programmes.tenantId, tenantId)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Programme not found' }, { status: 404 });

    const isOwner = isProgrammeOwnedByUser(existing, userId, access.employeeId);
    if (isOwner) {
      const editCheck = await requirePermission(session, Permissions.PROGRAMME_EDIT_OWN);
      if (editCheck instanceof NextResponse) return editCheck;
    } else {
      const editCheck = await requirePermission(session, Permissions.PROGRAMME_EDIT_ANY);
      if (editCheck instanceof NextResponse) return editCheck;
    }

    if (!['draft', 'changes_requested'].includes(existing.status)) {
      return NextResponse.json(
        { error: `A programme with status "${existing.status}" cannot be edited` },
        { status: 409 },
      );
    }

    const body = await request.json();
    const {
      title,
      description,
      purpose,
      department,
      departmentId,
      ownerEmployeeId,
      startDate,
      endDate,
      venue,
      officeId,
      regionId,
      region,
      expectedParticipants,
      plannedActivities,
      estimatedTravelRequirement,
      estimatedKilometres,
    } = body;

    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        return NextResponse.json({ error: 'Programme title cannot be empty' }, { status: 400 });
      }
      if (title.trim().length > 300) {
        return NextResponse.json({ error: 'Programme title must be 300 characters or fewer' }, { status: 400 });
      }
    }

    const effectiveStart = startDate !== undefined ? (startDate ? new Date(startDate) : null) : existing.startDate;
    const effectiveEnd = endDate !== undefined ? (endDate ? new Date(endDate) : null) : existing.endDate;
    if (
      (effectiveStart && Number.isNaN(new Date(effectiveStart).getTime())) ||
      (effectiveEnd && Number.isNaN(new Date(effectiveEnd).getTime()))
    ) {
      return NextResponse.json({ error: 'Programme dates are invalid' }, { status: 400 });
    }
    if (effectiveStart && effectiveEnd && new Date(effectiveEnd) < new Date(effectiveStart)) {
      return NextResponse.json({ error: 'End date must be on or after the start date' }, { status: 400 });
    }

    if (
      estimatedKilometres !== undefined &&
      estimatedKilometres !== null &&
      estimatedKilometres !== '' &&
      (!Number.isInteger(Number(estimatedKilometres)) || Number(estimatedKilometres) < 0)
    ) {
      return NextResponse.json({ error: 'Estimated kilometres must be a non-negative whole number' }, { status: 400 });
    }
    if (
      expectedParticipants !== undefined &&
      expectedParticipants !== null &&
      expectedParticipants !== '' &&
      (!Number.isInteger(Number(expectedParticipants)) || Number(expectedParticipants) < 0)
    ) {
      return NextResponse.json({ error: 'Expected participants must be a non-negative whole number' }, { status: 400 });
    }

    if (departmentId !== undefined && departmentId) {
      const [departmentRow] = await db
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.id, departmentId), eq(departments.tenantId, tenantId)))
        .limit(1);
      if (!departmentRow) return NextResponse.json({ error: 'Department not found in your organisation' }, { status: 400 });
    }

    let resolvedOwnerEmployeeId = existing.ownerEmployeeId;
    let resolvedOwnerUserId = existing.ownerUserId;
    if (ownerEmployeeId !== undefined) {
      if (!ownerEmployeeId) {
        resolvedOwnerEmployeeId = access.employeeId;
        resolvedOwnerUserId = userId;
      } else {
        const [owner] = await db
          .select({ id: employees.id, userId: employees.userId, employmentStatus: employees.employmentStatus })
          .from(employees)
          .where(and(eq(employees.id, ownerEmployeeId), eq(employees.tenantId, tenantId)))
          .limit(1);
        if (!owner || owner.employmentStatus !== 'active') {
          return NextResponse.json({ error: 'Programme owner must be an active employee in your organisation' }, { status: 400 });
        }
        if (!access.tenantWide && owner.id !== access.employeeId) {
          return NextResponse.json({ error: 'You may only assign your own employee record as programme owner' }, { status: 403 });
        }
        resolvedOwnerEmployeeId = owner.id;
        resolvedOwnerUserId = owner.userId ?? (owner.id === access.employeeId ? userId : null);
      }
    }

    if (officeId !== undefined && officeId) {
      const [office] = await db
        .select({ id: offices.id })
        .from(offices)
        .where(and(eq(offices.id, officeId), eq(offices.tenantId, tenantId)))
        .limit(1);
      if (!office) return NextResponse.json({ error: 'Office not found in your organisation' }, { status: 400 });
    }
    if (regionId !== undefined && regionId) {
      const [regionRow] = await db
        .select({ id: regions.id })
        .from(regions)
        .where(and(eq(regions.id, regionId), eq(regions.tenantId, tenantId)))
        .limit(1);
      if (!regionRow) return NextResponse.json({ error: 'Region not found in your organisation' }, { status: 400 });
    }

    const nextTitle = title !== undefined ? title.trim() : existing.title;
    const nextDescription = description !== undefined ? description?.trim() || null : existing.description;
    const nextPurpose = purpose !== undefined ? purpose?.trim() || null : existing.purpose;
    const nextDepartment = department !== undefined ? department?.trim() || null : existing.department;
    const nextDepartmentId = departmentId !== undefined ? departmentId || null : existing.departmentId;
    const nextStartDate = startDate !== undefined ? (startDate ? new Date(startDate) : null) : existing.startDate;
    const nextEndDate = endDate !== undefined ? (endDate ? new Date(endDate) : null) : existing.endDate;
    const nextVenue = venue !== undefined ? venue?.trim() || null : existing.venue;
    const nextOfficeId = officeId !== undefined ? officeId || null : existing.officeId;
    const nextRegionId = regionId !== undefined ? regionId || null : existing.regionId;
    const nextRegion = region !== undefined ? region?.trim() || null : existing.region;
    const nextExpectedParticipants =
      expectedParticipants !== undefined
        ? expectedParticipants != null && expectedParticipants !== ''
          ? Number(expectedParticipants)
          : null
        : existing.expectedParticipants;
    const nextPlannedActivities =
      plannedActivities !== undefined ? plannedActivities?.trim() || null : existing.plannedActivities;
    const nextEstimatedTravelRequirement =
      estimatedTravelRequirement !== undefined
        ? estimatedTravelRequirement?.trim() || null
        : existing.estimatedTravelRequirement;
    const nextEstimatedKilometres =
      estimatedKilometres !== undefined
        ? estimatedKilometres != null && estimatedKilometres !== ''
          ? Number(estimatedKilometres)
          : null
        : existing.estimatedKilometres;
    const beforeAudit = JSON.stringify({
      status: existing.status,
      title: existing.title,
      ownerEmployeeId: existing.ownerEmployeeId,
    });
    const afterAudit = JSON.stringify({
      status: existing.status,
      title: nextTitle,
      ownerEmployeeId: resolvedOwnerEmployeeId,
    });

    try {
      await db.execute(sql`
        WITH programme_updated AS (
          UPDATE programmes
          SET
            title = ${nextTitle},
            description = ${nextDescription},
            purpose = ${nextPurpose},
            department = ${nextDepartment},
            department_id = ${nextDepartmentId}::uuid,
            owner_employee_id = ${resolvedOwnerEmployeeId}::uuid,
            owner_user_id = ${resolvedOwnerUserId},
            start_date = ${nextStartDate},
            end_date = ${nextEndDate},
            venue = ${nextVenue},
            office_id = ${nextOfficeId}::uuid,
            region_id = ${nextRegionId}::uuid,
            region = ${nextRegion},
            expected_participants = ${nextExpectedParticipants},
            planned_activities = ${nextPlannedActivities},
            estimated_travel_requirement = ${nextEstimatedTravelRequirement},
            estimated_kilometres = ${nextEstimatedKilometres},
            updated_at = now()
          WHERE id = ${id}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND status = ${existing.status}
          RETURNING id
        ),
        audit_inserted AS (
          INSERT INTO audit_events (
            tenant_id, tenant_sequence, event_type, actor_user_id, action,
            entity_type, entity_id, source_channel, before, after, summary, created_at
          )
          SELECT
            ${tenantId}::uuid,
            ${Date.now()},
            'programme.edited',
            ${userId},
            'programme.edited',
            'programme',
            pu.id,
            'web',
            ${beforeAudit}::jsonb,
            ${afterAudit}::jsonb,
            ${`Programme ${existing.reference} was edited`},
            now()
          FROM programme_updated pu
          RETURNING id
        )
        SELECT CAST(
          CASE
            WHEN (SELECT count(*) FROM programme_updated) = 1
             AND (SELECT count(*) FROM audit_inserted) = 1
            THEN '1'
            ELSE 'atomic_programme_edit_failed'
          END AS integer
        ) AS committed
      `);
    } catch (error) {
      if (isAtomicProgrammeMarker(error, 'atomic_programme_edit_failed')) {
        return NextResponse.json(
          { error: 'This programme changed while you were editing it. Refresh and try again.' },
          { status: 409 },
        );
      }
      throw error;
    }

    const [updated] = await db
      .select()
      .from(programmes)
      .where(and(eq(programmes.id, id), eq(programmes.tenantId, tenantId)))
      .limit(1);
    if (!updated) {
      return NextResponse.json({ error: 'Programme was updated but could not be reloaded' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Programmes] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update programme' }, { status: 500 });
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

    const db = getDb();
    const tenantId = session.tenantId;
    const userId = session.user.id;
    const access = await resolveProgrammeAccess(session);

    const [existing] = await db
      .select()
      .from(programmes)
      .where(and(eq(programmes.id, id), eq(programmes.tenantId, tenantId)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Programme not found' }, { status: 404 });

    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: 'Only draft programmes can be deleted. Submitted or processed programmes must be archived.' },
        { status: 409 },
      );
    }

    const isOwner = isProgrammeOwnedByUser(existing, userId, access.employeeId);
    if (isOwner) {
      const editCheck = await requirePermission(session, Permissions.PROGRAMME_EDIT_OWN);
      if (editCheck instanceof NextResponse) return editCheck;
    } else {
      const editCheck = await requirePermission(session, Permissions.PROGRAMME_EDIT_ANY);
      if (editCheck instanceof NextResponse) return editCheck;
    }

    const beforeAudit = JSON.stringify({
      title: existing.title,
      reference: existing.reference,
      status: existing.status,
    });

    try {
      await db.execute(sql`
        WITH programme_deleted AS (
          DELETE FROM programmes
          WHERE id = ${id}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND status = 'draft'
          RETURNING id
        ),
        audit_inserted AS (
          INSERT INTO audit_events (
            tenant_id, tenant_sequence, event_type, actor_user_id, action,
            entity_type, entity_id, source_channel, before, summary, created_at
          )
          SELECT
            ${tenantId}::uuid,
            ${Date.now()},
            'programme.deleted',
            ${userId},
            'programme.deleted',
            'programme',
            pd.id,
            'web',
            ${beforeAudit}::jsonb,
            ${`Draft programme ${existing.reference} was deleted`},
            now()
          FROM programme_deleted pd
          RETURNING id
        )
        SELECT CAST(
          CASE
            WHEN (SELECT count(*) FROM programme_deleted) = 1
             AND (SELECT count(*) FROM audit_inserted) = 1
            THEN '1'
            ELSE 'atomic_programme_delete_failed'
          END AS integer
        ) AS committed
      `);
    } catch (error) {
      if (isAtomicProgrammeMarker(error, 'atomic_programme_delete_failed')) {
        return NextResponse.json(
          { error: 'This programme changed before deletion. Refresh and try again.' },
          { status: 409 },
        );
      }
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Programmes] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete programme' }, { status: 500 });
  }
}
