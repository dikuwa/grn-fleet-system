/**
 * Storage Deduplication Helpers
 *
 * Provides SHA-256 hashing and duplicate detection for uploaded files.
 * Embeds the hash in the R2 object key (prefix) so duplicate checks are
 * cheap listFile prefix scans — no DB required for core dedup.
 *
 * The hash is also recorded in `tripIncidents.attachmentHashes` for
 * DB-side audit lookups.
 */

import { listFiles } from '@/lib/storage';
import { sanitiseKey } from '@/lib/storage';

// ---------------------------------------------------------------------------
// SHA-256 hashing
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hex digest of a File/Blob. Works in both browser
 * (Web Crypto) and Node.js environments.
 */
export async function computeSha256(file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute SHA-256 from a raw Uint8Array (for Node.js streams or buffers).
 */
export async function computeSha256FromBytes(
  bytes: Uint8Array,
): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Dedup key construction
// ---------------------------------------------------------------------------

/**
 * Build an R2 object key with the SHA-256 hash embedded as the leading
 * segment of the file name:
 *
 *   `{prefix}/{category}/{sanitisedHash}-{sanitisedOriginalName}`
 *
 * When two files have the same SHA-256, they produce the same key — the
 * first upload wins and subsequent uploads are skipped by the dedup check.
 */
export function buildDedupKey(
  filename: string,
  category: string,
  tenantPrefix: string,
  sha256: string,
): string {
  const base = sanitiseKey(filename);
  const hash = sha256.slice(0, 16); // first 16 hex chars (64 bits) are unique enough
  const name = `${hash}-${base}`;
  const parts = [tenantPrefix, category, name].filter(Boolean);
  return parts.join('/');
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

/**
 * Check whether a file with the given SHA-256 already exists in R2 under
 * the given prefix. Returns the key(s) of matching objects, or an empty
 * array if none found.
 *
 * This is a cheap prefix scan (listFiles with `{hash}-` prefix) rather
 * than a full listing or DB query.
 */
export async function findDuplicateKeys(
  tenantPrefix: string,
  category: string,
  sha256: string,
): Promise<string[]> {
  const prefix = `${tenantPrefix}/${category}/${sha256.slice(0, 16)}-`;
  try {
    const files = await listFiles(prefix);
    return files.map((f) => f.key);
  } catch (err) {
    console.warn('[storage-dedup] listFiles failed:', err);
    return [];
  }
}

/**
 * Resolve the storage key for a file with deduplication.
 *
 * Returns `{ key, existing }`:
 * - If a duplicate exists, `key` is the existing object key and `existing` is true
 * - If no duplicate, `key` is a new dedup-aware key and `existing` is false
 */
export async function resolveDedupKey(
  filename: string,
  category: string,
  tenantPrefix: string,
  sha256: string,
): Promise<{ key: string; existing: boolean }> {
  const existingKeys = await findDuplicateKeys(tenantPrefix, category, sha256);
  if (existingKeys.length > 0) {
    return { key: existingKeys[0], existing: true };
  }
  return { key: buildDedupKey(filename, category, tenantPrefix, sha256), existing: false };
}
