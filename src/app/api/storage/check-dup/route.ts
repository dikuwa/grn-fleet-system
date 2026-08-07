/**
 * POST /api/storage/check-dup
 *
 * Accepts a SHA-256 hash (hex string) and category, returns existing
 * R2 object keys if a duplicate exists.
 *
 * Request body:
 * {
 *   sha256: string;       // 64-char hex SHA-256
 *   category: string;     // one of CATEGORY_PATHS keys
 *   tenantId?: string;    // optional, defaults to session tenant
 * }
 *
 * Response:
 * { success: true, data: { keys: string[], existing: boolean } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { listFiles, CATEGORY_PATHS } from '@/lib/storage';
import { isStorageConfigured } from '@/lib/storage';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.FILE_UPLOAD);
    if (permCheck instanceof NextResponse) return permCheck;

    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: 'File storage is not configured.' },
        { status: 503 },
      );
    }

    const body = await request.json();
    const { sha256, category, tenantId } = body as {
      sha256: string;
      category: string;
      tenantId?: string;
    };

    if (!sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) {
      return NextResponse.json(
        { error: 'sha256 must be a 64-character hex string' },
        { status: 400 },
      );
    }

    if (!category || !CATEGORY_PATHS[category as keyof typeof CATEGORY_PATHS]) {
      return NextResponse.json(
        { error: `Invalid category "${category}"` },
        { status: 400 },
      );
    }

    const targetTenantId = tenantId || session.tenantId;
    const tenantPrefix = `tenant/${targetTenantId}`;

    // Search for existing objects with this hash prefix
    const hashPrefix = sha256.slice(0, 16);
    const searchPrefix = `${tenantPrefix}/${CATEGORY_PATHS[category as keyof typeof CATEGORY_PATHS]}/${hashPrefix}-`;

    const files = await listFiles(searchPrefix);
    const keys = files.map((f) => f.key);

    return NextResponse.json({
      success: true,
      data: {
        keys,
        existing: keys.length > 0,
      },
    });
  } catch (error) {
    console.error('[storage/check-dup] Failed:', error);
    return NextResponse.json(
      { error: 'Dedup check failed: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 },
    );
  }
}