import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { shareLinks, generatedDocuments } from '@/db/schema/documents';
import { eq, and, desc, count, gte, lt, ilike, sql } from 'drizzle-orm';
import { generateShareToken, generateShortShareIdentity } from '@/lib/share-token';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { auditEvents } from '@/db/schema/audit';

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
    const search = searchParams.get('q')?.trim() || '';

    const db = getDb();

    // Build conditions
    const conditions = [eq(shareLinks.tenantId, session.tenantId)];
    if (status === 'active') {
      conditions.push(eq(shareLinks.isRevoked, false));
      conditions.push(gte(shareLinks.expiresAt, new Date()));
    } else if (status === 'expired') {
      conditions.push(eq(shareLinks.isRevoked, false));
      conditions.push(lt(shareLinks.expiresAt, new Date()));
    } else if (status === 'revoked') conditions.push(eq(shareLinks.isRevoked, true));
    if (search) conditions.push(ilike(generatedDocuments.documentType, `%${search}%`));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Count total
    const [totalResult] = await db
      .select({ count: count() })
      .from(shareLinks)
      .innerJoin(generatedDocuments, eq(shareLinks.documentId, generatedDocuments.id))
      .where(whereClause);
    const total = Number(totalResult?.count ?? 0);

    // Fetch share links with document info
    const [rows, [summary]] = await Promise.all([
      db
        .select({
          id: shareLinks.id,
          tokenHash: shareLinks.tokenHash,
          shortSlug: shareLinks.shortSlug,
          expiresAt: shareLinks.expiresAt,
          isExpired: sql<boolean>`${shareLinks.expiresAt} < now()`,
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
        .offset(offset),
      db
        .select({
          active: sql<number>`count(*) filter (where ${shareLinks.isRevoked} = false and ${shareLinks.expiresAt} >= now())`,
          expired: sql<number>`count(*) filter (where ${shareLinks.isRevoked} = false and ${shareLinks.expiresAt} < now())`,
          revoked: sql<number>`count(*) filter (where ${shareLinks.isRevoked} = true)`,
          views: sql<number>`coalesce(sum(${shareLinks.currentViews}), 0)`,
        })
        .from(shareLinks)
        .where(eq(shareLinks.tenantId, session.tenantId)),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        links: rows,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        summary: {
          active: Number(summary?.active ?? 0),
          expired: Number(summary?.expired ?? 0),
          revoked: Number(summary?.revoked ?? 0),
          views: Number(summary?.views ?? 0),
        },
      },
    });
  } catch (error) {
    console.error('[Share Links] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to list share links: ' + String(error) },
      { status: 500 },
    );
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
    const {
      documentId,
      expiresInHours = 168,
      maxViews,
      redactionProfile,
      allowDownload = false,
      createSeparateLink = false,
    } = body;

    if (!documentId) {
      return NextResponse.json({ error: 'Missing required field: documentId' }, { status: 400 });
    }

    const db = getDb();

    // Verify document exists and belongs to this tenant
    const [doc] = await db
      .select()
      .from(generatedDocuments)
      .where(
        and(
          eq(generatedDocuments.id, documentId),
          eq(generatedDocuments.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: 'Document not found in your tenant' }, { status: 404 });
    }
    if (doc.status === 'draft') {
      return NextResponse.json(
        { error: 'Issue the document before creating a public verification link' },
        { status: 409 },
      );
    }

    if (!createSeparateLink) {
      const [existing] = await db
        .select()
        .from(shareLinks)
        .where(
          and(
            eq(shareLinks.tenantId, session.tenantId),
            eq(shareLinks.documentId, documentId),
            eq(shareLinks.isRevoked, false),
            gte(shareLinks.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(shareLinks.createdAt))
        .limit(1);
      if (existing?.shortSlug) {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        return NextResponse.json({
          success: true,
          reused: true,
          data: { ...existing, shareUrl: `${baseUrl}/v/${existing.shortSlug}` },
        });
      }
    }

    const tenantId = session.tenantId;
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    // Generate secure token
    const { token, tokenHash } = await generateShareToken(documentId, expiresAt);
    const snapshot = doc.snapshotData as Record<string, unknown>;
    const readablePrefix = String(
      snapshot.authorityNumber ||
        snapshot.reference ||
        `${doc.documentType.slice(0, 2)}${doc.documentVersion}`,
    );
    const { shortSlug, verificationCode } = await generateShortShareIdentity(readablePrefix);

    // Store share link
    const [link] = await db
      .insert(shareLinks)
      .values({
        tenantId,
        documentId,
        tokenHash,
        shortSlug,
        verificationCode,
        expiresAt,
        maxViews: maxViews || null,
        redactionProfile: redactionProfile || 'external_standard',
        accessPolicy: { allowPreview: true, allowDownload: Boolean(allowDownload) },
        createdByUserId: userId || 'system',
      })
      .returning();
    await db.insert(auditEvents).values({
      tenantId,
      tenantSequence: Date.now(),
      eventType: 'document_share_link_created',
      actorUserId: userId,
      action: 'create_share_link',
      entityType: 'document',
      entityId: documentId,
      after: {
        shortSlug,
        expiresAt: expiresAt.toISOString(),
        maxViews: maxViews || null,
        allowDownload: Boolean(allowDownload),
      },
      summary: `Secure link created for ${doc.documentType}`,
      sourceChannel: 'web',
    });

    // Build shareable URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const shareUrl = `${baseUrl}/v/${encodeURIComponent(shortSlug)}`;

    return NextResponse.json({
      success: true,
      data: {
        ...link,
        shareUrl,
        legacyShareUrl: `${baseUrl}/share/${encodeURIComponent(token)}`,
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
      return NextResponse.json({ error: 'Missing required param: linkId' }, { status: 400 });
    }

    const db = getDb();
    const [revoked] = await db
      .update(shareLinks)
      .set({ isRevoked: true })
      .where(and(eq(shareLinks.id, linkId), eq(shareLinks.tenantId, session.tenantId)))
      .returning();

    if (!revoked) {
      return NextResponse.json({ error: 'Share link not found' }, { status: 404 });
    }
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: Date.now(),
      eventType: 'document_share_link_revoked',
      actorUserId: session.user.id,
      action: 'revoke_share_link',
      entityType: 'document',
      entityId: revoked.documentId,
      summary: 'Secure document share link revoked',
      sourceChannel: 'web',
    });

    return NextResponse.json({ success: true, data: revoked });
  } catch (error) {
    console.error('Share link revoke failed:', error);
    return NextResponse.json(
      { error: 'Failed to revoke share link: ' + String(error) },
      { status: 500 },
    );
  }
}
