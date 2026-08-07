/**
 * Platform CMS Content Detail API
 *
 * GET    /api/platform/cms/content/[id] — Get a content entry
 * PATCH  /api/platform/cms/content/[id] — Update a content entry (with versioning)
 * DELETE /api/platform/cms/content/[id] — Archive a content entry
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import { cmsContent, cmsContentVersions } from '@/db/schema/cms-content';
import { eq, and, desc } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// GET — Get a content entry
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(_request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.SITE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const db = getDb();

    const [content] = await db
      .select()
      .from(cmsContent)
      .where(eq(cmsContent.id, id))
      .limit(1);

    if (!content) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    // Fetch version history
    const versions = await db
      .select()
      .from(cmsContentVersions)
      .where(eq(cmsContentVersions.contentId, id))
      .orderBy(desc(cmsContentVersions.version));

    return NextResponse.json({
      success: true,
      data: { content, versions },
    });
  } catch (error) {
    console.error('[Platform CMS Content] GET failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — Update content entry (creates a new version snapshot)
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.SITE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const body = await request.json();
    const db = getDb();

    const [current] = await db
      .select()
      .from(cmsContent)
      .where(eq(cmsContent.id, id))
      .limit(1);

    if (!current) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    // Snapshot the previous version before making changes
    const newVersion = current.version + 1;
    await db.insert(cmsContentVersions).values({
      contentId: current.id,
      version: current.version,
      title: current.title,
      content: current.content,
      metaData: current.metaData ?? {},
      status: current.status,
      publishedAt: current.publishedAt,
      publishedByUserId: current.publishedByUserId,
    });

    const updates: Record<string, unknown> = {
      version: newVersion,
      updatedByUserId: session.user.id,
      updatedAt: new Date(),
    };

    if (body.title !== undefined) updates.title = body.title;
    if (body.slug !== undefined) updates.slug = body.slug.trim().toLowerCase();
    if (body.description !== undefined) updates.description = body.description;
    if (body.featuredImage !== undefined) updates.featuredImage = body.featuredImage;
    if (body.content !== undefined) updates.content = body.content;
    if (body.metaData !== undefined) updates.metaData = body.metaData;
    if (body.isListed !== undefined) updates.isListed = body.isListed;
    if (body.navOrder !== undefined) updates.navOrder = body.navOrder;
    if (body.parentId !== undefined) updates.parentId = body.parentId;
    if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;

    // Status transitions
    if (body.status) {
      updates.status = body.status;
      if (body.status === 'published') {
        updates.publishedAt = new Date();
        updates.publishedByUserId = session.user.id;
      }
      if (body.status === 'archived') {
        updates.archivedAt = new Date();
      }
      if (body.status === 'scheduled' && body.scheduledFor) {
        updates.scheduledFor = new Date(body.scheduledFor);
      }
    }

    const [updated] = await db
      .update(cmsContent)
      .set(updates)
      .where(eq(cmsContent.id, id))
      .returning();

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Platform CMS Content] PATCH failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — Archive a content entry (soft delete)
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(_request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.SITE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const db = getDb();

    const [updated] = await db
      .update(cmsContent)
      .set({
        status: 'archived',
        archivedAt: new Date(),
        isLatest: false,
        updatedAt: new Date(),
        updatedByUserId: session.user.id,
      })
      .where(eq(cmsContent.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: { id, status: 'archived' } });
  } catch (error) {
    console.error('[Platform CMS Content] DELETE failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
