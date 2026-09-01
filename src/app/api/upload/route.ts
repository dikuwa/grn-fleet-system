import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { getSessionWorkspace, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { WorkspaceIds } from '@/lib/workspaces';
import {
  uploadFile,
  deleteFile,
  buildKey,
  isStorageConfigured,
  listFiles,
  CATEGORY_PATHS,
  type UploadCategory,
} from '@/lib/storage';
import { UPLOAD_MAX_SIZE_BYTES, ALLOWED_IMAGE_TYPES, ALLOWED_DOCUMENT_TYPES } from '@/lib/constants';
import { computeSha256FromBytes, buildDedupKey, findDuplicateKeys } from '@/lib/storage-dedup';
import { isUploadCategoryAllowedInWorkspace } from '@/lib/upload-workspace-policy';

const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOCUMENT_TYPES] as string[];
const ALLOWED_IMAGE_TYPE_SET = new Set<string>(ALLOWED_IMAGE_TYPES);

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: 'File storage is not configured. Set R2 credentials.' },
        { status: 503 },
      );
    }

    const permCheck = await requirePermission(session, Permissions.FILE_UPLOAD);
    if (permCheck instanceof NextResponse) return permCheck;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const category = (formData.get('category') as UploadCategory) || 'document';
    const requestedPublic = formData.get('public') === 'true';
    const clientSha256 = ((formData.get('sha256') as string | null) || '').trim().toLowerCase() || null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided. Use field name "file".' }, { status: 400 });
    }

    if (file.size > UPLOAD_MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${UPLOAD_MAX_SIZE_BYTES / (1024 * 1024)} MB.` },
        { status: 413 },
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          error: `File type "${file.type}" is not allowed. Allowed: ${ALLOWED_TYPES.join(', ')}`,
        },
        { status: 415 },
      );
    }

    if (!CATEGORY_PATHS[category]) {
      return NextResponse.json(
        {
          error: `Invalid category "${category}". Valid: ${Object.keys(CATEGORY_PATHS).join(', ')}`,
        },
        { status: 400 },
      );
    }

    const workspace = await getSessionWorkspace(session);
    if (!isUploadCategoryAllowedInWorkspace(workspace.activeWorkspace, category)) {
      return NextResponse.json(
        { error: 'This upload category is not available in the active workspace.' },
        { status: 403 },
      );
    }

    if (requestedPublic && category !== 'avatar') {
      return NextResponse.json(
        { error: 'Public uploads are allowed only for avatar images.' },
        { status: 403 },
      );
    }
    if (category === 'avatar' && !ALLOWED_IMAGE_TYPE_SET.has(file.type)) {
      return NextResponse.json(
        { error: 'Avatar uploads must be an allowed image type.' },
        { status: 415 },
      );
    }
    const isPublic = requestedPublic && category === 'avatar';

    const tenantPrefix = `tenant/${session.tenantId}`;
    const path = CATEGORY_PATHS[category];

    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = await computeSha256FromBytes(new Uint8Array(buffer));
    if (clientSha256 && clientSha256 !== sha256) {
      return NextResponse.json(
        { error: 'File integrity check failed: SHA-256 does not match the uploaded bytes.' },
        { status: 400 },
      );
    }

    // Inspection and trip-incident uploads are single-use official evidence.
    // Give each upload an isolated object identity and register its authoritative
    // tenant/uploader/hash metadata before the key is returned to the client.
    if (category === 'inspection' || category === 'trip-incident') {
      const key = buildKey(file.name, path, tenantPrefix);
      const result = await uploadFile(buffer, key, {
        contentType: file.type,
        tenantPrefix,
        isPublic: false,
      });

      try {
        const db = getDb();
        if (category === 'inspection') {
          await db.execute(sql`
            INSERT INTO inspection_evidence_uploads (
              tenant_id,
              file_key,
              uploaded_by_user_id,
              original_file_name,
              mime_type,
              file_size,
              sha256
            ) VALUES (
              ${session.tenantId}::uuid,
              ${result.key},
              ${session.user.id},
              ${file.name},
              ${file.type},
              ${result.size},
              ${sha256}
            )
          `);
        } else {
          await db.execute(sql`
            INSERT INTO active_trip_evidence_uploads (
              tenant_id,
              evidence_kind,
              file_key,
              uploaded_by_user_id,
              original_file_name,
              mime_type,
              file_size,
              sha256
            ) VALUES (
              ${session.tenantId}::uuid,
              'trip_incident',
              ${result.key},
              ${session.user.id},
              ${file.name},
              ${file.type},
              ${result.size},
              ${sha256}
            )
          `);
        }
      } catch (error) {
        try {
          await deleteFile(result.key);
        } catch (cleanupError) {
          console.warn('[Upload] Failed to clean unregistered official evidence:', cleanupError);
        }
        throw error;
      }

      return NextResponse.json({
        success: true,
        data: {
          key: result.key,
          size: result.size,
          etag: result.etag,
          publicUrl: result.publicUrl,
          category,
          originalName: file.name,
          sha256,
          deduplicated: false,
        },
      });
    }

    const existingKeys = await findDuplicateKeys(tenantPrefix, path, sha256);
    if (existingKeys.length > 0) {
      return NextResponse.json({
        success: true,
        data: {
          key: existingKeys[0],
          size: file.size,
          category,
          originalName: file.name,
          sha256,
          deduplicated: true,
        },
      });
    }

    const key = buildDedupKey(file.name, path, tenantPrefix, sha256);

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
        sha256,
        deduplicated: false,
      },
    });
  } catch (error) {
    console.error('[Upload] Failed:', error);
    return NextResponse.json({ error: 'Upload could not be completed.' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.FILE_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const workspace = await getSessionWorkspace(session);
    if (
      workspace.activeWorkspace !== WorkspaceIds.TENANT_ADMIN &&
      workspace.activeWorkspace !== WorkspaceIds.TRANSPORT_ADMIN
    ) {
      return NextResponse.json(
        { error: 'Tenant file inventory is available only in an administrative workspace.' },
        { status: 403 },
      );
    }

    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: 'File storage is not configured.' },
        { status: 503 },
      );
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    if (category && !CATEGORY_PATHS[category as UploadCategory]) {
      return NextResponse.json({ error: 'Invalid file category.' }, { status: 400 });
    }
    const prefix = `tenant/${session.tenantId}/${category ? CATEGORY_PATHS[category as UploadCategory] + '/' : ''}`;

    const files = await listFiles(prefix);

    return NextResponse.json({ success: true, data: files });
  } catch (error) {
    console.error('[Upload:GET] Failed:', error);
    return NextResponse.json({ error: 'Failed to list tenant files.' }, { status: 500 });
  }
}
