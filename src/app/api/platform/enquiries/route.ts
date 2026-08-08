import { NextRequest, NextResponse } from 'next/server';
import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import { cmsEnquiries } from '@/db/schema/cms-content';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

const ALLOWED_STATUSES = ['new', 'in_progress', 'resolved', 'closed'] as const;
type EnquiryStatus = (typeof ALLOWED_STATUSES)[number];

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.SITE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() || '';
    const status = searchParams.get('status')?.trim() || '';
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit') || '25', 10) || 25));
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];
    if (status && ALLOWED_STATUSES.includes(status as EnquiryStatus)) {
      conditions.push(eq(cmsEnquiries.status, status));
    }
    if (q) {
      conditions.push(
        or(
          ilike(cmsEnquiries.name, `%${q}%`),
          ilike(cmsEnquiries.email, `%${q}%`),
          ilike(cmsEnquiries.subject, `%${q}%`),
          ilike(cmsEnquiries.message, `%${q}%`),
        )!,
      );
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const db = getDb();

    const [rows, totalRows, statsRows] = await Promise.all([
      db
        .select()
        .from(cmsEnquiries)
        .where(where)
        .orderBy(desc(cmsEnquiries.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: count() }).from(cmsEnquiries).where(where),
      db
        .select({
          total: count(),
          new: sql<number>`count(*) filter (where ${cmsEnquiries.status} = 'new')`,
          inProgress: sql<number>`count(*) filter (where ${cmsEnquiries.status} = 'in_progress')`,
          resolved: sql<number>`count(*) filter (where ${cmsEnquiries.status} = 'resolved')`,
          closed: sql<number>`count(*) filter (where ${cmsEnquiries.status} = 'closed')`,
        })
        .from(cmsEnquiries),
    ]);

    const total = Number(totalRows[0]?.count ?? 0);
    const stats = statsRows[0];

    return NextResponse.json({
      success: true,
      data: {
        enquiries: rows,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        stats: {
          total: Number(stats?.total ?? 0),
          new: Number(stats?.new ?? 0),
          inProgress: Number(stats?.inProgress ?? 0),
          resolved: Number(stats?.resolved ?? 0),
          closed: Number(stats?.closed ?? 0),
        },
      },
    });
  } catch (error) {
    console.error('[Platform Enquiries] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load enquiries' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.SITE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json().catch(() => null);
    const id = typeof body?.id === 'string' ? body.id : '';
    const status = typeof body?.status === 'string' ? body.status : '';
    const resolution = typeof body?.resolution === 'string' ? body.resolution.trim() : undefined;

    if (!id) return NextResponse.json({ error: 'Enquiry ID is required' }, { status: 400 });
    if (!ALLOWED_STATUSES.includes(status as EnquiryStatus)) {
      return NextResponse.json({ error: 'Invalid enquiry status' }, { status: 400 });
    }

    const db = getDb();
    const [existing] = await db.select().from(cmsEnquiries).where(eq(cmsEnquiries.id, id)).limit(1);
    if (!existing) return NextResponse.json({ error: 'Enquiry not found' }, { status: 404 });

    const now = new Date();
    const update: Record<string, unknown> = {
      status,
      updatedAt: now,
    };

    if (status === 'in_progress') {
      update.assignedToUserId = session.user.id;
      update.assignedAt = existing.assignedAt ?? now;
      update.resolvedAt = null;
    }
    if (status === 'resolved') {
      update.assignedToUserId = existing.assignedToUserId ?? session.user.id;
      update.assignedAt = existing.assignedAt ?? now;
      update.resolvedAt = now;
      if (resolution !== undefined) update.resolution = resolution || null;
    }
    if (status === 'closed') {
      update.resolvedAt = existing.resolvedAt ?? now;
      if (resolution !== undefined) update.resolution = resolution || existing.resolution;
    }
    if (status === 'new') {
      update.assignedToUserId = null;
      update.assignedAt = null;
      update.resolvedAt = null;
    }

    const [updated] = await db
      .update(cmsEnquiries)
      .set(update)
      .where(eq(cmsEnquiries.id, id))
      .returning();

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Platform Enquiries] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update enquiry' }, { status: 500 });
  }
}
