import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  uploadFile,
  buildKey,
  isStorageConfigured,
} from '@/lib/storage';
import { UPLOAD_MAX_SIZE_BYTES, ALLOWED_IMAGE_TYPES, ALLOWED_DOCUMENT_TYPES } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOCUMENT_TYPES] as string[];

type UploadCategory = 'inspection' | 'document' | 'receipt' | 'signature' | 'vehicle' | 'import';

const CATEGORY_PATHS: Record<UploadCategory, string> = {
  inspection: 'inspections',
  document: 'documents',
  receipt: 'receipts',
  signature: 'signatures',
  vehicle: 'vehicles',
  import: 'imports',
};

// ---------------------------------------------------------------------------
// POST — Upload a file
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // Auth
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    // Check storage is configured
    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: 'File storage is not configured. Set R2 credentials.' },
        { status: 503 },
      );
    }

    // Require upload permission
    const permCheck = await requirePermission(session, Permissions.FILE_UPLOAD);
    if (permCheck instanceof NextResponse) return permCheck;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const category = (formData.get('category') as UploadCategory) || 'document';
    const isPublic = formData.get('public') === 'true';

    if (!file) {
      return NextResponse.json({ error: 'No file provided. Use field name "file".' }, { status: 400 });
    }

    // Validate file size
    if (file.size > UPLOAD_MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${UPLOAD_MAX_SIZE_BYTES / (1024 * 1024)} MB.` },
        { status: 413 },
      );
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          error: `File type "${file.type}" is not allowed. Allowed: ${ALLOWED_TYPES.join(', ')}`,
        },
        { status: 415 },
      );
    }

    // Validate category
    if (!CATEGORY_PATHS[category]) {
      return NextResponse.json(
        {
          error: `Invalid category "${category}". Valid: ${Object.keys(CATEGORY_PATHS).join(', ')}`,
        },
        { status: 400 },
      );
    }

    // Build the object key with tenant isolation
    const tenantPrefix = `tenant/${session.tenantId}`;
    const key = buildKey(file.name, CATEGORY_PATHS[category], tenantPrefix);

    // Read the file into a buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Upload to R2
    const result = await uploadFile(buffer, key, {
      contentType: file.type,
      tenantPrefix,
      isPublic,
    });

    return NextResponse.json({
      success: true,
      data: {
        key: result.key,
        size: result.size,
        etag: result.etag,
        publicUrl: result.publicUrl,
        category,
        originalName: file.name,
      },
    });
  } catch (error) {
    console.error('[Upload] Failed:', error);
    return NextResponse.json(
      { error: 'Upload failed: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET — List uploaded files (tenant-scoped)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: 'File storage is not configured.' },
        { status: 503 },
      );
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const prefix = `tenant/${session.tenantId}/${category ? CATEGORY_PATHS[category as UploadCategory] + '/' : ''}`;

    // Use dynamic import to avoid bundling S3 SDK in every request
    const { listFiles } = await import('@/lib/storage');
    const files = await listFiles(prefix);

    return NextResponse.json({ success: true, data: files });
  } catch (error) {
    console.error('[Upload:GET] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to list files: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 },
    );
  }
}
