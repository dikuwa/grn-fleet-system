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
import { getDb } from '@/db';
import { shareLinks, shareAccessEvents, generatedDocuments } from '@/db/schema/documents';
import { eq, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_BYTES = 32;
const NONCE_BYTES = 16;
const HASH_ALGORITHM = 'SHA-256';

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
    const hashBytes = await crypto.subtle.digest(
      HASH_ALGORITHM,
      new TextEncoder().encode(token),
    );
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
  await db
    .insert(shareAccessEvents)
    .values({
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
