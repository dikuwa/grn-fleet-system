/**
 * Platform CMS Content API
 *
 * GET   /api/platform/cms/content — List CMS content entries
 * POST  /api/platform/cms/content — Create a new CMS content entry
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import { cmsContent } from '@/db/schema/cms-content';
import { eq, and, desc, count, or, like, asc } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// GET — List CMS content
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.SITE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';
    const pageType = searchParams.get('pageType') || '';
    const q = searchParams.get('q') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = (page - 1) * limit;

    const db = getDb();

    const conditions: ReturnType<typeof and>[] = [];
    if (status) conditions.push(eq(cmsContent.status, status as any));
    if (pageType) conditions.push(eq(cmsContent.pageType, pageType as any));
    if (q) {
      conditions.push(
        or(
          like(cmsContent.title, `%${q}%`),
          like(cmsContent.slug, `%${q}%`),
        )!,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ count: count() })
      .from(cmsContent)
      .where(whereClause);

    const total = totalResult?.count || 0;

    const content = await db
      .select()
      .from(cmsContent)
      .where(whereClause)
      .orderBy(desc(cmsContent.updatedAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      success: true,
      data: { content, total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('[Platform CMS Content] GET failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Create CMS content
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.SITE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const {
      pageType,
      slug,
      title,
      description,
      featuredImage,
      content,
      metaData,
      status,
      isListed,
      navOrder,
      parentId,
      sortOrder,
    } = body;

    if (!pageType || !slug || !title) {
      return NextResponse.json(
        { error: 'pageType, slug, and title are required' },
        { status: 400 },
      );
    }

    const db = getDb();

    // Check for slug uniqueness
    const [existing] = await db
      .select()
      .from(cmsContent)
      .where(eq(cmsContent.slug, slug.trim().toLowerCase()))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: `A page with slug "${slug}" already exists` },
        { status: 409 },
      );
    }

    const [created] = await db
      .insert(cmsContent)
      .values({
        pageType,
        slug: slug.trim().toLowerCase(),
        title: title.trim(),
        description: description || null,
        featuredImage: featuredImage || null,
        content: content ?? {},
        metaData: metaData ?? {},
        status: status || 'draft',
        isListed: isListed ?? true,
        navOrder: navOrder ?? 0,
        parentId: parentId || null,
        sortOrder: sortOrder ?? 0,
        version: 1,
        isLatest: true,
        createdByUserId: session.user.id,
      })
      .returning();

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    console.error('[Platform CMS Content] POST failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
