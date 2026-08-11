import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { programmes } from '@/db/schema/programmes';
import { programmeReferenceSequences } from '@/db/schema/request-sequences';
import { auditEvents } from '@/db/schema/audit';
import { employees, departments, offices } from '@/db/schema/people';
import { regions } from '@/db/schema/fleet';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, ilike, or, desc, sql, type SQL } from 'drizzle-orm';
import {
  programmeOwnershipCondition,
  resolveProgrammeAccess,
} from '@/lib/programme-access';
import { runAtomicMutations } from '@/lib/db-atomic';

/**
 * Programme management API
 *
 * GET  /api/programmes              — own programmes in personal scope; tenant-wide for Tenant Admin
 * GET  /api/programmes?selectable=1 — approved/published tenant programmes available for request linking
 * POST /api/programmes              — create a programme draft
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.PROGRAMME_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const status = (searchParams.get('status') || '').trim();
    const selectable = searchParams.get('selectable') === '1';
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const requestedLimit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 25));
    // The current request wizard historically asks for only 50 selectable
    // programmes and then filters locally. Honour normal pagination for the
    // management register, but return a larger bounded set for selector mode
    // so tenants with 100+ valid programmes do not silently lose choices.
    const limit = selectable ? 500 : requestedLimit;
    const offset = (page - 1) * limit;

    const db = getDb();
    const tenantId = session.tenantId;
    const access = await resolveProgrammeAccess(session);

    const conditions: SQL[] = [eq(programmes.tenantId, tenantId)];
    if (status) conditions.push(eq(programmes.status, status));
    if (q) {
      conditions.push(
        or(
          ilike(programmes.title, `%${q}%`),
          ilike(programmes.reference, `%${q}%`),
          ilike(programmes.department, `%${q}%`),
          ilike(programmes.venue, `%${q}%`),
        )!,
      );
    }

    if (selectable) {
      conditions.push(sql`${programmes.status} IN ('approved', 'published')`);
      conditions.push(sql`${programmes.archivedAt} IS NULL`);
      conditions.push(sql`(${programmes.endDate} IS NULL OR ${programmes.endDate} >= now())`);
    } else if (!access.tenantWide) {
      // The Personal workspace is explicitly own-scope. Do not expose another
      // requester's drafts, review notes, rejected programmes or history.
      conditions.push(programmeOwnershipCondition(session.user.id, access.employeeId));
    }

    const where = and(...conditions);

    const [rows, totalResult] = await Promise.all([
      db
        .select({
          id: programmes.id,
          reference: programmes.reference,
          title: programmes.title,
          description: programmes.description,
          purpose: programmes.purpose,
          department: programmes.department,
          status: programmes.status,
          venue: programmes.venue,
          region: programmes.region,
          startDate: programmes.startDate,
          endDate: programmes.endDate,
          expectedParticipants: programmes.expectedParticipants,
          estimatedKilometres: programmes.estimatedKilometres,
          createdByUserId: programmes.createdByUserId,
          createdAt: programmes.createdAt,
          ownerFirstName: employees.firstName,
          ownerLastName: employees.lastName,
          departmentName: departments.name,
          officeName: offices.name,
          regionName: regions.name,
        })
        .from(programmes)
        .leftJoin(employees, eq(programmes.ownerEmployeeId, employees.id))
        .leftJoin(departments, eq(programmes.departmentId, departments.id))
        .leftJoin(offices, eq(programmes.officeId, offices.id))
        .leftJoin(regions, eq(programmes.regionId, regions.id))
        .where(where)
        .orderBy(desc(programmes.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(programmes).where(where),
    ]);

    const total = Number(totalResult[0]?.count || 0);
    return NextResponse.json({
      success: true,
      data: rows.map((row) => ({
        ...row,
        ownerName: row.ownerFirstName
          ? `${row.ownerFirstName} ${row.ownerLastName ?? ''}`.trim()
          : null,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('[Programmes] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load programmes' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.PROGRAMME_CREATE);
    if (permCheck instanceof NextResponse) return permCheck;

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

    if (typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ error: 'Programme title is required' }, { status: 400 });
    }
    if (title.trim().length > 300) {
      return NextResponse.json({ error: 'Programme title must be 300 characters or fewer' }, { status: 400 });
    }

    const parsedStart = startDate ? new Date(startDate) : null;
    const parsedEnd = endDate ? new Date(endDate) : null;
    if ((parsedStart && Number.isNaN(parsedStart.getTime())) || (parsedEnd && Number.isNaN(parsedEnd.getTime()))) {
      return NextResponse.json({ error: 'Programme dates are invalid' }, { status: 400 });
    }
    if (parsedStart && parsedEnd && parsedEnd < parsedStart) {
      return NextResponse.json({ error: 'End date must be on or after the start date' }, { status: 400 });
    }
    if (estimatedKilometres != null && (!Number.isFinite(Number(estimatedKilometres)) || Number(estimatedKilometres) < 0)) {
      return NextResponse.json({ error: 'Estimated kilometres must be a non-negative number' }, { status: 400 });
    }
    if (expectedParticipants != null && expectedParticipants !== '' && (!Number.isFinite(Number(expectedParticipants)) || Number(expectedParticipants) < 0)) {
      return NextResponse.json({ error: 'Expected participants must be a non-negative number' }, { status: 400 });
    }

    const db = getDb();
    const tenantId = session.tenantId;
    const userId = session.user.id;
    const access = await resolveProgrammeAccess(session);

    if (departmentId) {
      const [dept] = await db
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.id, departmentId), eq(departments.tenantId, tenantId)))
        .limit(1);
      if (!dept) return NextResponse.json({ error: 'Department not found in your organisation' }, { status: 400 });
    }

    let resolvedOwnerEmployeeId: string | null = null;
    let resolvedOwnerUserId: string | null = userId;
    if (ownerEmployeeId) {
      const [owner] = await db
        .select({ id: employees.id, userId: employees.userId, employmentStatus: employees.employmentStatus })
        .from(employees)
        .where(and(eq(employees.id, ownerEmployeeId), eq(employees.tenantId, tenantId)))
        .limit(1);
      if (!owner || owner.employmentStatus !== 'active') {
        return NextResponse.json({ error: 'Programme owner must be an active employee in your organisation' }, { status: 400 });
      }
      if (!access.tenantWide && owner.id !== access.employeeId) {
        return NextResponse.json({ error: 'You may only create a programme for your own employee record' }, { status: 403 });
      }
      resolvedOwnerEmployeeId = owner.id;
      resolvedOwnerUserId = owner.userId ?? (owner.id === access.employeeId ? userId : null);
    } else if (access.employeeId) {
      resolvedOwnerEmployeeId = access.employeeId;
    }

    if (officeId) {
      const [office] = await db
        .select({ id: offices.id })
        .from(offices)
        .where(and(eq(offices.id, officeId), eq(offices.tenantId, tenantId)))
        .limit(1);
      if (!office) return NextResponse.json({ error: 'Office not found in your organisation' }, { status: 400 });
    }
    if (regionId) {
      const [regionRow] = await db
        .select({ id: regions.id })
        .from(regions)
        .where(and(eq(regions.id, regionId), eq(regions.tenantId, tenantId)))
        .limit(1);
      if (!regionRow) return NextResponse.json({ error: 'Region not found in your organisation' }, { status: 400 });
    }

    const now = new Date();
    const sequenceYear = Number(
      new Intl.DateTimeFormat('en', { timeZone: 'Africa/Windhoek', year: 'numeric' }).format(now),
    );
    const [sequence] = await db
      .insert(programmeReferenceSequences)
      .values({ tenantId, sequenceYear, currentValue: 1, updatedAt: now })
      .onConflictDoUpdate({
        target: [programmeReferenceSequences.tenantId, programmeReferenceSequences.sequenceYear],
        set: {
          currentValue: sql`${programmeReferenceSequences.currentValue} + 1`,
          updatedAt: now,
        },
      })
      .returning({ currentValue: programmeReferenceSequences.currentValue });
    if (!sequence?.currentValue) {
      throw new Error('Unable to allocate a programme reference');
    }
    const reference = `GRN/PGM/${sequenceYear}/${String(sequence.currentValue).padStart(6, '0')}`;
    const programmeId = randomUUID();

    await runAtomicMutations((tx) => [
      tx.insert(programmes).values({
        id: programmeId,
        tenantId,
        reference,
        title: title.trim(),
        description: description?.trim() || null,
        purpose: purpose?.trim() || null,
        department: department?.trim() || null,
        departmentId: departmentId || null,
        ownerEmployeeId: resolvedOwnerEmployeeId,
        ownerUserId: resolvedOwnerUserId,
        startDate: parsedStart,
        endDate: parsedEnd,
        venue: venue?.trim() || null,
        officeId: officeId || null,
        regionId: regionId || null,
        region: region?.trim() || null,
        expectedParticipants:
          expectedParticipants != null && expectedParticipants !== ''
            ? Number(expectedParticipants)
            : null,
        plannedActivities: plannedActivities?.trim() || null,
        estimatedTravelRequirement: estimatedTravelRequirement?.trim() || null,
        estimatedKilometres:
          estimatedKilometres != null && estimatedKilometres !== ''
            ? Number(estimatedKilometres)
            : null,
        status: 'draft',
        createdByUserId: userId,
      }),
      tx.insert(auditEvents).values({
        tenantId,
        tenantSequence: Date.now(),
        eventType: 'programme_created',
        actorUserId: userId,
        action: 'programme.created',
        entityType: 'programme',
        entityId: programmeId,
        sourceChannel: 'web',
        after: {
          reference,
          title: title.trim(),
          status: 'draft',
          ownerEmployeeId: resolvedOwnerEmployeeId,
        },
        summary: `Programme ${reference} created as a draft`,
      }),
    ]);

    const [created] = await db
      .select()
      .from(programmes)
      .where(and(eq(programmes.id, programmeId), eq(programmes.tenantId, tenantId)))
      .limit(1);
    if (!created) throw new Error('Programme committed but could not be reloaded');

    return NextResponse.json({ success: true, data: created });
  } catch (error) {
    console.error('[Programmes] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create programme' }, { status: 500 });
  }
}
