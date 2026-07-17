import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { isStorageConfigured } from '@/lib/storage';

// ---------------------------------------------------------------------------
// GET — Serve a file by key (via signed URL redirect)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    // Require file view permission
    const permCheck = await requirePermission(session, Permissions.FILE_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: 'File storage is not configured.' },
        { status: 503 },
      );
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (!key) {
      return NextResponse.json(
        { error: 'Query parameter "key" is required.' },
        { status: 400 },
      );
    }

    // Tenant isolation — ensure the key belongs to this tenant
    const expectedPrefix = `tenant/${session.tenantId}/`;
    if (!key.startsWith(expectedPrefix)) {
      return NextResponse.json(
        { error: 'Access denied: file does not belong to your organisation.' },
        { status: 403 },
      );
    }

    const { getSignedFileUrl, downloadFile } = await import('@/lib/storage');

    // Try signed URL first (preferred for larger files)
    const signedUrl = await getSignedFileUrl(key, 3600);
    if (signedUrl) {
      return NextResponse.redirect(signedUrl);
    }

    // Fall back to streaming the file through the API
    const file = await downloadFile(key);
    if (!file) {
      return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    }

    return new NextResponse(file.body as ReadableStream, {
      headers: {
        'Content-Type': file.contentType,
        'Content-Length': String(file.contentLength ?? ''),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('[Files] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve file: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 },
    );
  }
}
