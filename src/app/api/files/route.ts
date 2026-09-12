import { NextRequest, NextResponse } from 'next/server';
import { and, eq, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { inspectionPhotos, vehicleInspections } from '@/db/schema/trips';
import { requestAttachments, transportRequests } from '@/db/schema/requests';
import {
  getSessionRoleNames,
  getSessionWorkspace,
  requireDashboardAction,
  requireRequestAuth,
  requirePermission,
} from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { canTenantAdminUseGenericFileKey } from '@/lib/file-access-policy';
import { Permissions } from '@/lib/permissions';
import { inspectionScopeCondition } from '@/lib/record-scope';
import { WorkspaceIds } from '@/lib/workspaces';
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

    // A tenant prefix alone is not enough for Personal workspace users: it
    // would turn every tenant object key into a bearer capability. Requesters
    // may retrieve only attachment objects linked to requests they own or that
    // were entered on their behalf. Other operational workspaces retain their
    // existing permission boundary until their domain-specific file records
    // are audited in their own role passes.
    const workspace = await getSessionWorkspace(session);
    if (workspace.activeWorkspace === WorkspaceIds.PERSONAL) {
      const db = getDb();
      const [attachment] = await db
        .select({ id: requestAttachments.id })
        .from(requestAttachments)
        .innerJoin(transportRequests, eq(requestAttachments.requestId, transportRequests.id))
        .where(
          and(
            eq(requestAttachments.fileKey, key),
            eq(transportRequests.tenantId, session.tenantId),
            or(
              eq(transportRequests.requesterUserId, session.user.id),
              eq(transportRequests.enteredByUserId, session.user.id),
            )!,
          ),
        )
        .limit(1);

      if (!attachment) {
        return NextResponse.json(
          { error: 'Access denied: this file is not attached to one of your requests.' },
          { status: 403 },
        );
      }
    }

    const tenantRelativeKey = key.slice(expectedPrefix.length);
    if (
      workspace.activeWorkspace === WorkspaceIds.TENANT_ADMIN &&
      !canTenantAdminUseGenericFileKey(tenantRelativeKey)
    ) {
      return NextResponse.json(
        {
          error:
            'Transport Operations evidence must be accessed from an authorised operational or audit workspace.',
        },
        { status: 403 },
      );
    }

    if (tenantRelativeKey.startsWith('inspections/')) {
      const db = getDb();
      const rawPreviewAccess = (await db.execute(sql`
        SELECT 1
        FROM inspection_evidence_uploads ieu
        WHERE ieu.tenant_id = ${session.tenantId}::uuid
          AND ieu.file_key = ${key}
          AND ieu.uploaded_by_user_id = ${session.user.id}
          AND ieu.claimed_inspection_id IS NULL
        LIMIT 1
      `)) as unknown as { rows?: unknown[] } | unknown[];
      const canPreviewUnclaimedUpload = Array.isArray(rawPreviewAccess)
        ? rawPreviewAccess.length > 0
        : Array.isArray(rawPreviewAccess.rows) && rawPreviewAccess.rows.length > 0;

      if (!canPreviewUnclaimedUpload) {
        const inspectionRouteCheck = await requireDashboardAction(
          session,
          '/dashboard/inspections',
          'view',
        );
        if (inspectionRouteCheck instanceof NextResponse) return inspectionRouteCheck;

        const inspectionPermCheck = await requirePermission(session, Permissions.INSPECTION_VIEW);
        if (inspectionPermCheck instanceof NextResponse) return inspectionPermCheck;

        const roleNames = await getSessionRoleNames(session);
        const access = resolveDashboardAccess('/dashboard/inspections', roleNames);
        const [photo] = await db
          .select({ id: inspectionPhotos.id })
          .from(inspectionPhotos)
          .innerJoin(vehicleInspections, eq(inspectionPhotos.inspectionId, vehicleInspections.id))
          .where(
            and(
              eq(inspectionPhotos.fileKey, key),
              inspectionScopeCondition({
                tenantId: session.tenantId,
                userId: session.user.id,
                recordScope: access.recordScope ?? 'assigned',
              }),
            ),
          )
          .limit(1);

        if (!photo) {
          return NextResponse.json(
            { error: 'Access denied: this file is not available in your inspection scope.' },
            { status: 403 },
          );
        }
      }
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
      { error: 'File could not be retrieved.' },
      { status: 500 },
    );
  }
}
