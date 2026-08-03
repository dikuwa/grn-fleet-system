import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { programmes } from '@/db/schema/programmes';
import { transportRequests } from '@/db/schema/requests';
import { employees, departments, offices } from '@/db/schema/people';
import { regions } from '@/db/schema/fleet';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, sql } from 'drizzle-orm';
import { recordAuditEvent } from '@/lib/audit-event';

/**
 * Programme detail API
 *
 * GET    /api/programmes/[id]  — full detail + linked transport requests
 * PATCH  /api/programmes/[id]  — edit a draft / changes-requested programme
 * DELETE /api/programmes/[id]  — delete a draft (creator or edit-any)
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

    if (!programme) {
      return NextResponse.json({ error: 'Programme not found' }, { status: 404 });
    }

    // Linked transport requests (tenant-scoped)
    const linkedRequests = await db
      .select({
        id: transportRequests.id,
        reference: transportRequests.reference,
        status: transportRequests.status,
        purpose: transportRequests.purpose,
        createdAt: transportRequests.createdAt,
      })
      .from(transportRequests)
      .where(
        and(
          eq(transportRequests.programmeId, id),
          eq(transportRequests.tenantId, session.tenantId),
        ),
      )
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

    const [existing] = await db
      .select()
      .from(programmes)
      .where(and(eq(programmes.id, id), eq(programmes.tenantId, tenantId)))
      .limit(1);
    if (!existing) {
      return NextResponse.json({ error: 'Programme not found' }, { status: 404 });
    }

    const isOwner = existing.createdByUserId === userId;
    if (isOwner) {
      const permCheck = await requirePermission(session, Permissions.PROGRAMME_EDIT_OWN);
      if (permCheck instanceof NextResponse) return permCheck;
    } else {
      const permCheck = await requirePermission(session, Permissions.PROGRAMME_EDIT_ANY);
      if (permCheck instanceof NextResponse) return permCheck;
    }

    // Only drafts and changes-requested programmes can be edited.
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

    if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
      return NextResponse.json({ error: 'Programme title cannot be empty' }, { status: 400 });
    }
    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      return NextResponse.json(
        { error: 'End date must be on or after the start date' },
        { status: 400 },
      );
    }

    const [updated] = await db
      .update(programmes)
      .set({
        title: title !== undefined ? title.trim() : existing.title,
        description: description !== undefined ? description?.trim() || null : existing.description,
        purpose: purpose !== undefined ? purpose?.trim() || null : existing.purpose,
        department: department !== undefined ? department?.trim() || null : existing.department,
        departmentId: departmentId !== undefined ? departmentId || null : existing.departmentId,
        ownerEmployeeId:
          ownerEmployeeId !== undefined ? ownerEmployeeId || null : existing.ownerEmployeeId,
        ownerUserId:
          ownerEmployeeId !== undefined
            ? ownerEmployeeId
              ? null
              : userId
            : existing.ownerUserId,
        startDate: startDate !== undefined ? (startDate ? new Date(startDate) : null) : existing.startDate,
        endDate: endDate !== undefined ? (endDate ? new Date(endDate) : null) : existing.endDate,
        venue: venue !== undefined ? venue?.trim() || null : existing.venue,
        officeId: officeId !== undefined ? officeId || null : existing.officeId,
        regionId: regionId !== undefined ? regionId || null : existing.regionId,
        region: region !== undefined ? region?.trim() || null : existing.region,
        expectedParticipants:
          expectedParticipants !== undefined
            ? expectedParticipants != null && Number.isFinite(Number(expectedParticipants))
              ? Number(expectedParticipants)
              : null
            : existing.expectedParticipants,
        plannedActivities:
          plannedActivities !== undefined
            ? plannedActivities?.trim() || null
            : existing.plannedActivities,
        estimatedTravelRequirement:
          estimatedTravelRequirement !== undefined
            ? estimatedTravelRequirement?.trim() || null
            : existing.estimatedTravelRequirement,
        estimatedKilometres:
          estimatedKilometres !== undefined
            ? estimatedKilometres != null && Number.isFinite(Number(estimatedKilometres))
              ? Number(estimatedKilometres)
              : null
            : existing.estimatedKilometres,
        updatedAt: new Date(),
      })
      .where(eq(programmes.id, id))
      .returning();

    await recordAuditEvent({
      tenantId,
      actorUserId: userId,
      action: 'programme.edited',
      entityType: 'programme',
      entityId: id,
      sourceChannel: 'web',
      before: { status: existing.status, title: existing.title },
      after: { status: updated.status, title: updated.title },
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

    const [existing] = await db
      .select()
      .from(programmes)
      .where(and(eq(programmes.id, id), eq(programmes.tenantId, tenantId)))
      .limit(1);
    if (!existing) {
      return NextResponse.json({ error: 'Programme not found' }, { status: 404 });
    }

    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: 'Only draft programmes can be deleted. Submitted or processed programmes must be archived.' },
        { status: 409 },
      );
    }

    const isOwner = existing.createdByUserId === userId;
    if (isOwner) {
      const permCheck = await requirePermission(session, Permissions.PROGRAMME_EDIT_OWN);
      if (permCheck instanceof NextResponse) return permCheck;
    } else {
      const permCheck = await requirePermission(session, Permissions.PROGRAMME_EDIT_ANY);
      if (permCheck instanceof NextResponse) return permCheck;
    }

    // Unlink any transport requests that reference this draft.
    await db
      .update(transportRequests)
      .set({ programmeId: null })
      .where(
        and(eq(transportRequests.programmeId, id), eq(transportRequests.tenantId, tenantId)),
      );

    await db.delete(programmes).where(eq(programmes.id, id));

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
