/**
 * Share Link Token Service
 *
 * Generates and verifies secure share links using SHA-256 HMAC with a
 * server-side pepper. The token is a URL-safe base64-encoded HMAC of
 * (documentId + expiresAt + nonce), preventing enumeration and tampering.
 *
 * The pepper is configured via SHARE_TOKEN_PEPPER in environment.
 *
 * NOTE: crypto.subtle requires a secure context (HTTPS or localhost).
 * In production this is guaranteed. For local dev, use localhost.
 */

import { env } from '@/env';
import { randomBytes } from 'node:crypto';
import { getDb } from '@/db';
import { shareLinks, shareAccessEvents, generatedDocuments } from '@/db/schema/documents';
import { and, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_BYTES = 32;
const NONCE_BYTES = 16;
const HASH_ALGORITHM = 'SHA-256';
const SHORT_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

type ShareAccessResult =
  | 'granted'
  | 'expired'
  | 'revoked'
  | 'not_found'
  | 'max_views_exceeded';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPepper(): Uint8Array {
  const pepper = env.SHARE_TOKEN_PEPPER;
  if (!pepper) {
    throw new Error(
      'SHARE_TOKEN_PEPPER is not configured. Share links cannot be created without a pepper.',
    );
  }
  return new TextEncoder().encode(pepper);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function uint8ToBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    uint8ToBuffer(key),
    { name: 'HMAC', hash: HASH_ALGORITHM },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, uint8ToBuffer(message));
  return new Uint8Array(signature);
}

async function logShareAccess(
  shareLinkId: string,
  result: ShareAccessResult,
  metadata?: { ipAddress?: string; userAgent?: string },
): Promise<void> {
  const db = getDb();
  await db.insert(shareAccessEvents).values({
    shareLinkId,
    ipAddress: metadata?.ipAddress || null,
    userAgent: metadata?.userAgent || null,
    result,
  });
}

function accessFailureReason(link: typeof shareLinks.$inferSelect): ShareAccessResult | null {
  if (link.isRevoked) return 'revoked';
  if (link.expiresAt < new Date()) return 'expired';
  if (link.maxViews && link.currentViews >= link.maxViews) return 'max_views_exceeded';
  return null;
}

/**
 * Atomically claim one successful view.
 *
 * The view-limit predicate and increment happen in the same UPDATE so two
 * concurrent requests cannot both consume the final permitted view.
 */
async function claimShareAccess(
  shareLinkId: string,
  metadata?: { ipAddress?: string; userAgent?: string },
): Promise<{ granted: true; link: typeof shareLinks.$inferSelect } | { granted: false; reason: ShareAccessResult }> {
  const db = getDb();
  const now = new Date();
  const [claimed] = await db
    .update(shareLinks)
    .set({
      currentViews: sql`${shareLinks.currentViews} + 1`,
      lastAccessedAt: now,
    })
    .where(
      and(
        eq(shareLinks.id, shareLinkId),
        eq(shareLinks.isRevoked, false),
        gte(shareLinks.expiresAt, now),
        or(isNull(shareLinks.maxViews), lt(shareLinks.currentViews, shareLinks.maxViews)),
      ),
    )
    .returning();

  if (claimed) {
    await logShareAccess(shareLinkId, 'granted', metadata);
    return { granted: true, link: claimed };
  }

  const [latest] = await db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.id, shareLinkId))
    .limit(1);
  const reason = latest ? accessFailureReason(latest) || 'not_found' : 'not_found';
  if (latest) await logShareAccess(shareLinkId, reason, metadata);
  return { granted: false, reason };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a secure share token for a document.
 *
 * Returns the raw token (URL-safe base64) and the SHA-256 hash to store.
 * Requires a secure context (HTTPS or localhost) for crypto.subtle.
 */
export async function generateShareToken(
  documentId: string,
  expiresAt: Date,
): Promise<{ token: string; tokenHash: string }> {
  const pepper = getPepper();
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));

  // Message = documentId + expiresAt (ISO) + nonce
  const message = new TextEncoder().encode(
    `${documentId}|${expiresAt.toISOString()}|${bytesToBase64(nonce)}`,
  );
  const hmac = await hmacSha256(pepper, message);

  // Token = base64(nonce + hmac) — contains everything needed to verify
  const combined = new Uint8Array(NONCE_BYTES + TOKEN_BYTES);
  combined.set(nonce);
  combined.set(hmac, NONCE_BYTES);
  const token = bytesToBase64(combined);

  // Hash the full token for DB storage
  const hashBytes = await crypto.subtle.digest(HASH_ALGORITHM, new TextEncoder().encode(token));
  const tokenHash = bytesToBase64(new Uint8Array(hashBytes));
  return { token, tokenHash };
}

function secureShortCode(length: number): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => SHORT_ALPHABET[byte % SHORT_ALPHABET.length]).join('');
}

export async function generateShortShareIdentity(prefix: string): Promise<{
  shortSlug: string;
  verificationCode: string;
}> {
  const db = getDb();
  const safePrefix =
    prefix
      .replace(/[^a-z0-9]/gi, '')
      .toUpperCase()
      .slice(-8) || 'DOC';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const verificationCode = secureShortCode(8);
    const shortSlug = `${safePrefix}-${verificationCode}`;
    const [collision] = await db
      .select({ id: shareLinks.id })
      .from(shareLinks)
      .where(eq(shareLinks.shortSlug, shortSlug))
      .limit(1);
    if (!collision) return { shortSlug, verificationCode };
  }
  throw new Error('Unable to allocate a unique secure link');
}

/** Verify a legacy share token against its stored hash. */
export async function verifyShareToken(token: string): Promise<{
  valid: boolean;
  shareLink?: typeof shareLinks.$inferSelect;
  reason?: string;
}> {
  try {
    const hashBytes = await crypto.subtle.digest(HASH_ALGORITHM, new TextEncoder().encode(token));
    const tokenHash = bytesToBase64(new Uint8Array(hashBytes));
    const db = getDb();
    const [link] = await db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.tokenHash, tokenHash))
      .limit(1);

    if (!link) return { valid: false, reason: 'not_found' };
    const reason = accessFailureReason(link);
    if (reason) return { valid: false, reason, shareLink: link };
    return { valid: true, shareLink: link };
  } catch {
    return { valid: false, reason: 'verification_error' };
  }
}

/**
 * Record a non-granted share access event. Successful views must go through
 * claimShareAccess so max-view enforcement remains atomic.
 */
export async function recordShareAccess(
  shareLinkId: string,
  result: Exclude<ShareAccessResult, 'granted'>,
  metadata?: { ipAddress?: string; userAgent?: string },
): Promise<void> {
  await logShareAccess(shareLinkId, result, metadata);
}

/** Resolve the document behind a legacy share token. */
export async function resolveSharedDocument(token: string): Promise<{
  document?: typeof generatedDocuments.$inferSelect;
  error?: string;
}> {
  const verification = await verifyShareToken(token);
  if (!verification.valid) {
    if (verification.shareLink && verification.reason && verification.reason !== 'not_found') {
      await logShareAccess(
        verification.shareLink.id,
        verification.reason as ShareAccessResult,
      );
    }
    return { error: verification.reason };
  }

  const db = getDb();
  const shareLink = verification.shareLink!;
  const [doc] = await db
    .select()
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.id, shareLink.documentId),
        eq(generatedDocuments.tenantId, shareLink.tenantId),
      ),
    )
    .limit(1);

  if (!doc) return { error: 'document_not_found' };
  const access = await claimShareAccess(shareLink.id);
  if (!access.granted) return { error: access.reason };
  return { document: doc };
}

export async function resolveShortSharedDocument(shortSlug: string): Promise<{
  document?: typeof generatedDocuments.$inferSelect;
  shareLink?: typeof shareLinks.$inferSelect;
  error?: string;
}> {
  const db = getDb();
  const [shareLink] = await db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.shortSlug, shortSlug.toUpperCase()))
    .limit(1);
  if (!shareLink) return { error: 'not_found' };

  const preflightFailure = accessFailureReason(shareLink);
  if (preflightFailure) {
    await logShareAccess(shareLink.id, preflightFailure);
    return { error: preflightFailure, shareLink };
  }

  const [document] = await db
    .select()
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.id, shareLink.documentId),
        eq(generatedDocuments.tenantId, shareLink.tenantId),
      ),
    )
    .limit(1);
  if (!document) return { error: 'document_not_found', shareLink };

  const access = await claimShareAccess(shareLink.id);
  if (!access.granted) return { error: access.reason, shareLink };
  return { document, shareLink: access.link };
}
