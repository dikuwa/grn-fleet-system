import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { shareLinks, generatedDocuments } from '@/db/schema/documents';
import { eq, and, desc, count } from 'drizzle-orm';
import { generateShareToken } from '@/lib/share-token';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

/**
 * GET /api/share-links
 * List all active share links with document info and analytics.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.FILE_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '25', 10);
    const offset = (page - 1) * limit;
    const status = searchParams.get('status') || ''; // active, expired, revoked, all

    const db = getDb();

    // Build conditions
    const conditions = [eq(shareLinks.tenantId, session.tenantId)];
    if (status === 'active') conditions.push(eq(shareLinks.isRevoked, false));
    else if (status === 'revoked') conditions.push(eq(shareLinks.isRevoked, true));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Count total
    const [totalResult] = await db
      .select({ count: count() })
      .from(shareLinks)
      .where(whereClause);
    const total = Number(totalResult?.count ?? 0);

    // Fetch share links with document info
    const rows = await db
      .select({
        id: shareLinks.id,
        tokenHash: shareLinks.tokenHash,
        expiresAt: shareLinks.expiresAt,
        isRevoked: shareLinks.isRevoked,
        maxViews: shareLinks.maxViews,
        currentViews: shareLinks.currentViews,
        redactionProfile: shareLinks.redactionProfile,
        lastAccessedAt: shareLinks.lastAccessedAt,
        createdAt: shareLinks.createdAt,
        documentId: shareLinks.documentId,
        documentType: generatedDocuments.documentType,
        documentVersion: generatedDocuments.documentVersion,
        documentStatus: generatedDocuments.status,
      })
      .from(shareLinks)
      .innerJoin(generatedDocuments, eq(shareLinks.documentId, generatedDocuments.id))
      .where(whereClause)
      .orderBy(desc(shareLinks.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      success: true,
      data: {
        links: rows,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[Share Links] GET failed:', error);
    return NextResponse.json({ error: 'Failed to list share links: ' + String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.FILE_UPLOAD);
    if (permCheck instanceof NextResponse) return permCheck;

    const userId = session.user.id;

    const body = await request.json();
    const { documentId, expiresInHours = 168, maxViews, redactionProfile } = body;

    if (!documentId) {
      return NextResponse.json(
        { error: 'Missing required field: documentId' },
        { status: 400 },
      );
    }

    const db = getDb();

    // Verify document exists and belongs to this tenant
    const [doc] = await db
      .select()
      .from(generatedDocuments)
      .where(
        and(eq(generatedDocuments.id, documentId), eq(generatedDocuments.tenantId, session.tenantId))
      )
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: 'Document not found in your tenant' }, { status: 404 });
    }

    const tenantId = session.tenantId;
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    // Generate secure token
    const { token, tokenHash } = await generateShareToken(documentId, expiresAt);

    // Store share link
    const [link] = await db
      .insert(shareLinks)
      .values({
        tenantId,
        documentId,
        tokenHash,
        expiresAt,
        maxViews: maxViews || null,
        redactionProfile: redactionProfile || 'external_standard',
        createdByUserId: userId || 'system',
      })
      .returning();

    // Build shareable URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const shareUrl = `${baseUrl}/share/${encodeURIComponent(token)}`;

    return NextResponse.json({
      success: true,
      data: {
        ...link,
        shareUrl,
      },
    });
  } catch (error) {
    console.error('Share link creation failed:', error);
    return NextResponse.json(
      { error: 'Failed to create share link: ' + String(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.FILE_UPLOAD);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const linkId = searchParams.get('linkId');

    if (!linkId) {
      return NextResponse.json(
        { error: 'Missing required param: linkId' },
        { status: 400 },
      );
    }

    const db = getDb();
    const [revoked] = await db
      .update(shareLinks)
      .set({ isRevoked: true })
      .where(eq(shareLinks.id, linkId))
      .returning();

    if (!revoked) {
      return NextResponse.json({ error: 'Share link not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: revoked });
  } catch (error) {
    console.error('Share link revoke failed:', error);
    return NextResponse.json(
      { error: 'Failed to revoke share link: ' + String(error) },
      { status: 500 },
    );
  }
}
