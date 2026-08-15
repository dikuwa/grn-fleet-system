import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { shareLinks, generatedDocuments } from '@/db/schema/documents';
import { eq, and, desc, count, gte, lt, ilike, sql } from 'drizzle-orm';
import { generateShareToken, generateShortShareIdentity } from '@/lib/share-token';
import { requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';
import { auditEvents } from '@/db/schema/audit';

const EXTERNAL_REDACTION_PROFILES = ['external_standard', 'external_minimal'] as const;
type ExternalRedactionProfile = (typeof EXTERNAL_REDACTION_PROFILES)[number];

/**
 * GET /api/share-links
 * List all share links with document info and analytics.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const accessCheck = await requireDashboardAction(
      session,
      '/dashboard/share-links',
      'view',
    );
    if (accessCheck instanceof NextResponse) return accessCheck;
    const revokeCheck = await requireDashboardAction(
      session,
      '/dashboard/share-links',
      'delete',
    );
    const createCheck = await requireDashboardAction(
      session,
      '/dashboard/share-links',
      'create',
    );
    const canRevoke = !(revokeCheck instanceof NextResponse);
    const canDistribute = !(createCheck instanceof NextResponse);

    const { searchParams } = new URL(request.url);
    const requestedPage = Number.parseInt(searchParams.get('page') || '1', 10);
    const requestedLimit = Number.parseInt(searchParams.get('limit') || '25', 10);
    const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1;
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, requestedLimit))
      : 25;
    const offset = (page - 1) * limit;
    const status = searchParams.get('status') || '';
    const search = searchParams.get('q')?.trim() || '';

    const db = getDb();

    const conditions = [
      eq(shareLinks.tenantId, session.tenantId),
      eq(generatedDocuments.tenantId, session.tenantId),
    ];
    if (status === 'active') {
      conditions.push(eq(shareLinks.isRevoked, false));
      conditions.push(gte(shareLinks.expiresAt, new Date()));
      conditions.push(
        sql<boolean>`(${shareLinks.maxViews} is null or ${shareLinks.currentViews} < ${shareLinks.maxViews})`,
      );
    } else if (status === 'expired') {
      conditions.push(eq(shareLinks.isRevoked, false));
      conditions.push(lt(shareLinks.expiresAt, new Date()));
    } else if (status === 'exhausted') {
      conditions.push(eq(shareLinks.isRevoked, false));
      conditions.push(gte(shareLinks.expiresAt, new Date()));
      conditions.push(
        sql<boolean>`${shareLinks.maxViews} is not null and ${shareLinks.currentViews} >= ${shareLinks.maxViews}`,
      );
    } else if (status === 'revoked') conditions.push(eq(shareLinks.isRevoked, true));
    if (search) conditions.push(ilike(generatedDocuments.documentType, `%${search}%`));

    const whereClause = and(...conditions);
    const documentJoin = and(
      eq(shareLinks.documentId, generatedDocuments.id),
      eq(generatedDocuments.tenantId, session.tenantId),
    );

    const [totalResult] = await db
      .select({ count: count() })
      .from(shareLinks)
      .innerJoin(generatedDocuments, documentJoin)
      .where(whereClause);
    const total = Number(totalResult?.count ?? 0);

    const [rows, [summary]] = await Promise.all([
      db
        .select({
          id: shareLinks.id,
          shortSlug: shareLinks.shortSlug,
          verificationCode: shareLinks.verificationCode,
          expiresAt: shareLinks.expiresAt,
          isExpired: sql<boolean>`${shareLinks.expiresAt} < now()`,
          isExhausted: sql<boolean>`${shareLinks.maxViews} is not null and ${shareLinks.currentViews} >= ${shareLinks.maxViews}`,
          isRevoked: shareLinks.isRevoked,
          maxViews: shareLinks.maxViews,
          currentViews: shareLinks.currentViews,
          redactionProfile: shareLinks.redactionProfile,
          accessPolicy: shareLinks.accessPolicy,
          lastAccessedAt: shareLinks.lastAccessedAt,
          createdAt: shareLinks.createdAt,
          documentId: shareLinks.documentId,
          documentType: generatedDocuments.documentType,
          documentVersion: generatedDocuments.documentVersion,
          documentStatus: generatedDocuments.status,
        })
        .from(shareLinks)
        .innerJoin(generatedDocuments, documentJoin)
        .where(whereClause)
        .orderBy(desc(shareLinks.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({
          active: sql<number>`count(*) filter (where ${shareLinks.isRevoked} = false and ${shareLinks.expiresAt} >= now() and (${shareLinks.maxViews} is null or ${shareLinks.currentViews} < ${shareLinks.maxViews}))`,
          exhausted: sql<number>`count(*) filter (where ${shareLinks.isRevoked} = false and ${shareLinks.expiresAt} >= now() and ${shareLinks.maxViews} is not null and ${shareLinks.currentViews} >= ${shareLinks.maxViews})`,
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
        capabilities: { canRevoke, canDistribute },
        summary: {
          active: Number(summary?.active ?? 0),
          exhausted: Number(summary?.exhausted ?? 0),
          expired: Number(summary?.expired ?? 0),
          revoked: Number(summary?.revoked ?? 0),
          views: Number(summary?.views ?? 0),
        },
      },
    });
  } catch (error) {
    console.error('[Share Links] GET failed:', error);
    return NextResponse.json({ error: 'Failed to list share links.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const accessCheck = await requireDashboardAction(
      session,
      '/dashboard/share-links',
      'create',
    );
    if (accessCheck instanceof NextResponse) return accessCheck;

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

    const parsedExpiryHours = Number(expiresInHours);
    if (!Number.isFinite(parsedExpiryHours) || parsedExpiryHours < 1 || parsedExpiryHours > 8760) {
      return NextResponse.json(
        { error: 'Share-link expiry must be between 1 hour and 1 year.' },
        { status: 422 },
      );
    }
    const normalizedExpiryHours = Math.round(parsedExpiryHours);

    const parsedMaxViews = maxViews === undefined || maxViews === null || Number(maxViews) === 0
      ? null
      : Number(maxViews);
    if (
      parsedMaxViews !== null &&
      (!Number.isInteger(parsedMaxViews) || parsedMaxViews < 1 || parsedMaxViews > 100000)
    ) {
      return NextResponse.json(
        { error: 'Maximum views must be 0 (unlimited) or a whole number between 1 and 100000.' },
        { status: 422 },
      );
    }

    const requestedRedactionProfile =
      typeof redactionProfile === 'string' && redactionProfile.trim()
        ? redactionProfile.trim()
        : 'external_standard';
    if (!EXTERNAL_REDACTION_PROFILES.includes(requestedRedactionProfile as ExternalRedactionProfile)) {
      return NextResponse.json(
        {
          error:
            'Public share links support External Standard or External Minimal disclosure only.',
        },
        { status: 422 },
      );
    }
    const normalizedRedactionProfile = requestedRedactionProfile as ExternalRedactionProfile;
    const normalizedAllowDownload = Boolean(allowDownload);
    const tenantId = session.tenantId;
    const expiresAt = new Date(Date.now() + normalizedExpiryHours * 60 * 60 * 1000);

    const db = getDb();
    const [doc] = await db
      .select()
      .from(generatedDocuments)
      .where(
        and(
          eq(generatedDocuments.id, documentId),
          eq(generatedDocuments.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: 'Document not found in your tenant' }, { status: 404 });
    }
    if (doc.status !== 'issued') {
      return NextResponse.json(
        {
          error:
            doc.status === 'draft'
              ? 'Issue the document before creating a public verification link'
              : `Only the current issued document can receive a new public verification link. Current status: ${doc.status}.`,
        },
        { status: 409 },
      );
    }

    if (!createSeparateLink) {
      const [existing] = await db
        .select()
        .from(shareLinks)
        .where(
          and(
            eq(shareLinks.tenantId, tenantId),
            eq(shareLinks.documentId, documentId),
            eq(shareLinks.isRevoked, false),
            gte(shareLinks.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(shareLinks.createdAt))
        .limit(1);

      if (existing?.shortSlug) {
        const existingPolicy = (existing.accessPolicy ?? {}) as {
          allowDownload?: boolean;
          allowPreview?: boolean;
        };
        const expiryDifferenceMs = Math.abs(existing.expiresAt.getTime() - expiresAt.getTime());
        const hasRemainingViews =
          existing.maxViews === null || existing.currentViews < existing.maxViews;
        const settingsMatch =
          hasRemainingViews &&
          existing.maxViews === parsedMaxViews &&
          existing.redactionProfile === normalizedRedactionProfile &&
          Boolean(existingPolicy.allowDownload) === normalizedAllowDownload &&
          expiryDifferenceMs <= 5 * 60 * 1000;

        if (settingsMatch) {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
          const { tokenHash: _tokenHash, ...safeExisting } = existing;
          return NextResponse.json({
            success: true,
            reused: true,
            data: { ...safeExisting, shareUrl: `${baseUrl}/v/${encodeURIComponent(existing.shortSlug)}` },
          });
        }
      }
    }

    const { tokenHash } = await generateShareToken(documentId, expiresAt);
    const snapshot = doc.snapshotData as Record<string, unknown>;
    const readablePrefix = String(
      snapshot.authorityNumber ||
        snapshot.reference ||
        `${doc.documentType.slice(0, 2)}${doc.documentVersion}`,
    );
    const { shortSlug, verificationCode } = await generateShortShareIdentity(readablePrefix);

    const [link] = await db
      .insert(shareLinks)
      .values({
        tenantId,
        documentId,
        tokenHash,
        shortSlug,
        verificationCode,
        expiresAt,
        maxViews: parsedMaxViews,
        redactionProfile: normalizedRedactionProfile,
        accessPolicy: { allowPreview: true, allowDownload: normalizedAllowDownload },
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
        maxViews: parsedMaxViews,
        allowDownload: normalizedAllowDownload,
        redactionProfile: normalizedRedactionProfile,
      },
      summary: `Secure link created for ${doc.documentType}`,
      sourceChannel: 'web',
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const shareUrl = `${baseUrl}/v/${encodeURIComponent(shortSlug)}`;
    const { tokenHash: _tokenHash, ...safeLink } = link;

    return NextResponse.json({
      success: true,
      data: {
        ...safeLink,
        shareUrl,
      },
    });
  } catch (error) {
    console.error('Share link creation failed:', error);
    return NextResponse.json({ error: 'Failed to create share link.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const accessCheck = await requireDashboardAction(
      session,
      '/dashboard/share-links',
      'delete',
    );
    if (accessCheck instanceof NextResponse) return accessCheck;

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

    const { tokenHash: _tokenHash, ...safeRevoked } = revoked;
    return NextResponse.json({ success: true, data: safeRevoked });
  } catch (error) {
    console.error('Share link revoke failed:', error);
    return NextResponse.json({ error: 'Failed to revoke share link.' }, { status: 500 });
  }
}
