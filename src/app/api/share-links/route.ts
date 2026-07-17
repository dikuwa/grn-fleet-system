import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { shareLinks, generatedDocuments } from '@/db/schema/documents';
import { eq, and } from 'drizzle-orm';
import { generateShareToken } from '@/lib/share-token';
import { getServerSessionFromRequest } from '@/lib/session';
import { requireRequestAuth } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
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
    const session = await getServerSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
