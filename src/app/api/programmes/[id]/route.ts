import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { programmes } from '@/db/schema/programmes';
import { transportRequests } from '@/db/schema/requests';
import { employees, departments, offices } from '@/db/schema/people';
import { regions } from '@/db/schema/fleet';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, or, sql } from 'drizzle-orm';
import { recordAuditEvent } from '@/lib/audit-event';
import {
  isProgrammeOwnedByUser,
  resolveProgrammeAccess,
} from '@/lib/programme-access';

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
    const isShared =
      ['approved', 'published'].includes(programme.status) &&
      programme.archivedAt == null;
    if (!access.tenantWide && !isOwner && !isShared) {
      // Hide existence of another requester's private programme.
      return NextResponse.json({ error: 'Programme not found' }, { status: 404 });
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

    return NextResponse.json({ success: true, data: { programme, linkedRequests } });
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
      const permCheck = await requirePermission(session, Permissions.PROGRAMME_EDIT_OWN);
      if (permCheck instanceof NextResponse) return permCheck;
    } else {
      const permCheck = await requirePermission(session, Permissions.PROGRAMME_EDIT_ANY);
      if (permCheck instanceof NextResponse) return permCheck;
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
      (!Number.isFinite(Number(estimatedKilometres)) || Number(estimatedKilometres) < 0)
    ) {
      return NextResponse.json({ error: 'Estimated kilometres must be a non-negative number' }, { status: 400 });
    }
    if (
      expectedParticipants !== undefined &&
      expectedParticipants !== null &&
      expectedParticipants !== '' &&
      (!Number.isFinite(Number(expectedParticipants)) || Number(expectedParticipants) < 0)
    ) {
      return NextResponse.json({ error: 'Expected participants must be a non-negative number' }, { status: 400 });
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

    const [updated] = await db
      .update(programmes)
      .set({
        title: title !== undefined ? title.trim() : existing.title,
        description: description !== undefined ? description?.trim() || null : existing.description,
        purpose: purpose !== undefined ? purpose?.trim() || null : existing.purpose,
        department: department !== undefined ? department?.trim() || null : existing.department,
        departmentId: departmentId !== undefined ? departmentId || null : existing.departmentId,
        ownerEmployeeId: resolvedOwnerEmployeeId,
        ownerUserId: resolvedOwnerUserId,
        startDate: startDate !== undefined ? (startDate ? new Date(startDate) : null) : existing.startDate,
        endDate: endDate !== undefined ? (endDate ? new Date(endDate) : null) : existing.endDate,
        venue: venue !== undefined ? venue?.trim() || null : existing.venue,
        officeId: officeId !== undefined ? officeId || null : existing.officeId,
        regionId: regionId !== undefined ? regionId || null : existing.regionId,
        region: region !== undefined ? region?.trim() || null : existing.region,
        expectedParticipants:
          expectedParticipants !== undefined
            ? expectedParticipants != null && expectedParticipants !== ''
              ? Number(expectedParticipants)
              : null
            : existing.expectedParticipants,
        plannedActivities: plannedActivities !== undefined ? plannedActivities?.trim() || null : existing.plannedActivities,
        estimatedTravelRequirement:
          estimatedTravelRequirement !== undefined
            ? estimatedTravelRequirement?.trim() || null
            : existing.estimatedTravelRequirement,
        estimatedKilometres:
          estimatedKilometres !== undefined
            ? estimatedKilometres != null && estimatedKilometres !== ''
              ? Number(estimatedKilometres)
              : null
            : existing.estimatedKilometres,
        updatedAt: new Date(),
      })
      .where(and(
        eq(programmes.id, id),
        eq(programmes.tenantId, tenantId),
        eq(programmes.status, existing.status),
      ))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'This programme changed while you were editing it. Refresh and try again.' }, { status: 409 });
    }

    await recordAuditEvent({
      tenantId,
      actorUserId: userId,
      action: 'programme.edited',
      entityType: 'programme',
      entityId: id,
      sourceChannel: 'web',
      before: { status: existing.status, title: existing.title, ownerEmployeeId: existing.ownerEmployeeId },
      after: { status: updated.status, title: updated.title, ownerEmployeeId: updated.ownerEmployeeId },
      summary: `Programme ${existing.reference} was edited`,
    });

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
      const permCheck = await requirePermission(session, Permissions.PROGRAMME_EDIT_OWN);
      if (permCheck instanceof NextResponse) return permCheck;
    } else {
      const permCheck = await requirePermission(session, Permissions.PROGRAMME_EDIT_ANY);
      if (permCheck instanceof NextResponse) return permCheck;
    }

    await db
      .update(transportRequests)
      .set({ programmeId: null })
      .where(and(eq(transportRequests.programmeId, id), eq(transportRequests.tenantId, tenantId)));

    await db
      .delete(programmes)
      .where(and(eq(programmes.id, id), eq(programmes.tenantId, tenantId)));

    await recordAuditEvent({
      tenantId,
      actorUserId: userId,
      action: 'programme.deleted',
      entityType: 'programme',
      entityId: id,
      sourceChannel: 'web',
      before: { title: existing.title, reference: existing.reference, status: existing.status },
      summary: `Draft programme ${existing.reference} was deleted`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Programmes] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete programme' }, { status: 500 });
  }
}
