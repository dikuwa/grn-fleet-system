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
import { and, eq, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_BYTES = 32;
const NONCE_BYTES = 16;
const HASH_ALGORITHM = 'SHA-256';
const SHORT_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

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

/**
 * Verify a share token against its stored hash.
 */
export async function verifyShareToken(token: string): Promise<{
  valid: boolean;
  shareLink?: typeof shareLinks.$inferSelect;
  reason?: string;
}> {
  try {
    // Hash the provided token
    const hashBytes = await crypto.subtle.digest(HASH_ALGORITHM, new TextEncoder().encode(token));
    const tokenHash = bytesToBase64(new Uint8Array(hashBytes));

    // Look up by hash
    const db = getDb();
    const [link] = await db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.tokenHash, tokenHash))
      .limit(1);

    if (!link) {
      return { valid: false, reason: 'not_found' };
    }

    if (link.isRevoked) {
      return { valid: false, reason: 'revoked', shareLink: link };
    }

    if (new Date(link.expiresAt) < new Date()) {
      return { valid: false, reason: 'expired', shareLink: link };
    }

    if (link.maxViews && link.currentViews >= link.maxViews) {
      return { valid: false, reason: 'max_views_exceeded', shareLink: link };
    }

    return { valid: true, shareLink: link };
  } catch {
    return { valid: false, reason: 'verification_error' };
  }
}

/**
 * Record a share access event and increment view count.
 */
export async function recordShareAccess(
  shareLinkId: string,
  result: 'granted' | 'expired' | 'revoked' | 'not_found',
  metadata?: { ipAddress?: string; userAgent?: string },
): Promise<void> {
  const db = getDb();

  // Update view count
  if (result === 'granted') {
    await db
      .update(shareLinks)
      .set({
        currentViews: sql`${shareLinks.currentViews} + 1`,
        lastAccessedAt: new Date(),
      })
      .where(eq(shareLinks.id, shareLinkId));
  }

  // Insert audit event
  await db.insert(shareAccessEvents).values({
    shareLinkId,
    ipAddress: metadata?.ipAddress || null,
    userAgent: metadata?.userAgent || null,
    result,
  });
}

/**
 * Resolve the document behind a share token.
 */
export async function resolveSharedDocument(token: string): Promise<{
  document?: typeof generatedDocuments.$inferSelect;
  error?: string;
}> {
  const verification = await verifyShareToken(token);
  if (!verification.valid) {
    return { error: verification.reason };
  }

  const db = getDb();
  const shareLink = verification.shareLink!;

  const [doc] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, shareLink.documentId))
    .limit(1);

  if (!doc) {
    return { error: 'document_not_found' };
  }

  // Record access
  await recordShareAccess(shareLink.id, 'granted');

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
  if (shareLink.isRevoked) {
    await recordShareAccess(shareLink.id, 'revoked');
    return { error: 'revoked', shareLink };
  }
  if (shareLink.expiresAt < new Date()) {
    await recordShareAccess(shareLink.id, 'expired');
    return { error: 'expired', shareLink };
  }
  if (shareLink.maxViews && shareLink.currentViews >= shareLink.maxViews) {
    return { error: 'max_views_exceeded', shareLink };
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
  await recordShareAccess(shareLink.id, 'granted');
  return { document, shareLink };
}
