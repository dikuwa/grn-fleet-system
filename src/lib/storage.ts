/**
 * Cloudflare R2 / S3-Compatible Storage Client
 *
 * Provides file upload, download, deletion, and signed-URL generation
 * using the AWS SDK for JavaScript. Configure via environment variables:
 *
 *   R2_ACCOUNT_ID       — Cloudflare account ID
 *   R2_ACCESS_KEY_ID    — R2 API access key
 *   R2_SECRET_ACCESS_KEY — R2 API secret key
 *   R2_BUCKET_NAME      — Bucket name (default: 'grn-fleet')
 *   R2_ENDPOINT         — Optional custom endpoint (otherwise auto-derived)
 *
 * Falls back gracefully when credentials are not configured.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  type PutObjectCommandInput,
  type GetObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env, hasEnvVar } from '@/env';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UploadOptions {
  /** MIME type of the file */
  contentType: string;
  /** Optional tenant prefix for isolation */
  tenantPrefix?: string;
  /** Whether the file is publicly readable (default: false) */
  isPublic?: boolean;
}

export interface UploadResult {
  /** The full object key (including any tenant prefix) */
  key: string;
  /** Public URL (only if isPublic was set) */
  publicUrl?: string;
  /** Size in bytes */
  size: number;
  /** ETag from the server */
  etag?: string;
}

export interface StorageFile {
  /** Object key */
  key: string;
  /** File body as a ReadableStream */
  body: ReadableStream | null;
  /** Content type */
  contentType: string;
  /** Content length */
  contentLength?: number;
  /** ETag */
  etag?: string;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

let _isConfigured: boolean | null = null;

/**
 * Check whether R2 storage is configured with credentials.
 */
export function isStorageConfigured(): boolean {
  if (_isConfigured !== null) return _isConfigured;
  _isConfigured =
    hasEnvVar('R2_ACCOUNT_ID') &&
    hasEnvVar('R2_ACCESS_KEY_ID') &&
    hasEnvVar('R2_SECRET_ACCESS_KEY');
  return _isConfigured;
}

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let _client: S3Client | null = null;

function getClient(): S3Client | null {
  if (!isStorageConfigured()) return null;
  if (_client) return _client;

  const region = 'auto'; // R2 uses 'auto'
  const endpoint =
    env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  _client = new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true, // R2 requires path-style addressing
  });

  return _client;
}

const BUCKET = env.R2_BUCKET_NAME || 'grn-fleet';

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Sanitise a filename for use as an object key — lowercases, replaces
 * special characters with hyphens, and trims.
 */
export function sanitiseKey(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Build a namespaced object key: `{tenantPrefix}/{type}/{sanitised-name}-{timestamp}`
 */
export function buildKey(
  filename: string,
  type: string,
  tenantPrefix?: string,
): string {
  const base = sanitiseKey(filename);
  const ts = Date.now();
  const name = `${ts}-${base}`;
  const parts = [tenantPrefix, type, name].filter(Boolean);
  return parts.join('/');
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Upload a file buffer to R2.
 *
 * @param buffer  — File contents as a Buffer or Uint8Array
 * @param key     — Object key (use `buildKey()` to generate one)
 * @param options — Content type, tenant prefix, public flag
 */
export async function uploadFile(
  buffer: Buffer | Uint8Array,
  key: string,
  options: UploadOptions,
): Promise<UploadResult> {
  const client = getClient();
  if (!client) {
    throw new Error(
      'R2 storage is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.',
    );
  }

  const input: PutObjectCommandInput = {
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: options.contentType,
  };

  if (options.isPublic) {
    input.ACL = 'public-read';
  }

  const command = new PutObjectCommand(input);
  const result = await client.send(command);

  const publicUrl = options.isPublic
    ? `https://${BUCKET}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`
    : undefined;

  return {
    key,
    publicUrl,
    size: buffer.byteLength,
    etag: result.ETag,
  };
}

/**
 * Download a file from R2 by key.
 * Returns the file body, content type, and metadata — or null if not found.
 */
export async function downloadFile(key: string): Promise<StorageFile | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const input: GetObjectCommandInput = {
      Bucket: BUCKET,
      Key: key,
    };

    const command = new GetObjectCommand(input);
    const result = await client.send(command);

    return {
      key,
      body: result.Body as ReadableStream | null,
      contentType: result.ContentType || 'application/octet-stream',
      contentLength: result.ContentLength,
      etag: result.ETag,
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'NoSuchKey') {
      return null;
    }
    throw err;
  }
}

/**
 * Delete a file from R2 by key.
 */
export async function deleteFile(key: string): Promise<void> {
  const client = getClient();
  if (!client) return;

  const command = new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  await client.send(command);
}

/**
 * Generate a time-limited signed URL for secure file access.
 * Defaults to 1 hour expiry.
 */
export async function getSignedFileUrl(
  key: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/**
 * List objects under a given prefix (e.g. a tenant's folder).
 * Returns up to 1000 keys.
 */
export async function listFiles(
  prefix: string,
): Promise<Array<{ key: string; size: number; etag?: string }>> {
  const client = getClient();
  if (!client) return [];

  const command = new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
  });

  const result = await client.send(command);
  return (result.Contents || []).map((obj) => ({
    key: obj.Key || '',
    size: obj.Size || 0,
    etag: obj.ETag,
  }));
}

/**
 * Get the raw S3 client (for advanced operations).
 */
export function getRawClient(): S3Client | null {
  return getClient();
}
