import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { vehicleDocuments, vehicles } from '@/db/schema/fleet';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';

const VEHICLE_DOCUMENT_VERIFY_CONFLICT = 'vehicle_document_verify_conflict';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const routeCheck = await requireDashboardAction(session, '/dashboard/fleet', 'update');
    if (routeCheck instanceof NextResponse) return routeCheck;
    const permissionCheck = await requirePermission(session, Permissions.VEHICLE_UPDATE);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const { id, documentId } = await params;
    const body = await request.json().catch(() => ({}));
    const expectedUpdatedAt = String(body.expectedUpdatedAt || '').trim();
    const parsedExpectedUpdatedAt = new Date(expectedUpdatedAt);
    if (!expectedUpdatedAt || Number.isNaN(parsedExpectedUpdatedAt.getTime())) {
      return NextResponse.json({ error: 'Refresh the document review and try again' }, { status: 422 });
    }

    const db = getDb();
    const [current] = await db
      .select({
        id: vehicleDocuments.id,
        documentName: vehicleDocuments.documentName,
        documentType: vehicleDocuments.documentType,
        referenceNumber: vehicleDocuments.referenceNumber,
        expiryDate: vehicleDocuments.expiryDate,
        isVerified: vehicleDocuments.isVerified,
        updatedAt: vehicleDocuments.updatedAt,
        licenceNumber: vehicles.licenceNumber,
      })
      .from(vehicleDocuments)
      .innerJoin(vehicles, eq(vehicleDocuments.vehicleId, vehicles.id))
      .where(
        and(
          eq(vehicleDocuments.id, documentId),
          eq(vehicleDocuments.vehicleId, id),
          eq(vehicles.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (!current) return NextResponse.json({ error: 'Vehicle document not found' }, { status: 404 });
    if (current.isVerified) {
      return NextResponse.json({ document: current, idempotent: true });
    }

    const verified = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(vehicleDocuments)
        .set({ isVerified: true, updatedAt: sql`now()` })
        .where(
          and(
            eq(vehicleDocuments.id, documentId),
            eq(vehicleDocuments.vehicleId, id),
            eq(vehicleDocuments.isVerified, false),
            sql`date_trunc('milliseconds', ${vehicleDocuments.updatedAt}) = ${parsedExpectedUpdatedAt.toISOString()}::timestamptz`,
          ),
        )
        .returning({
          id: vehicleDocuments.id,
          documentName: vehicleDocuments.documentName,
          documentType: vehicleDocuments.documentType,
          referenceNumber: vehicleDocuments.referenceNumber,
          expiryDate: vehicleDocuments.expiryDate,
          isVerified: vehicleDocuments.isVerified,
          updatedAt: vehicleDocuments.updatedAt,
        });

      if (!updated) throw new Error(VEHICLE_DOCUMENT_VERIFY_CONFLICT);

      await recordAuditEvent(
        {
          tenantId: session.tenantId,
          actorUserId: session.user.id,
          eventType: 'vehicle_document_verified',
          action: 'vehicle.document.verify',
          entityType: 'vehicle',
          entityId: id,
          before: {
            documentId,
            isVerified: false,
            updatedAt: current.updatedAt.toISOString(),
          },
          after: {
            documentId,
            documentType: current.documentType,
            referenceNumber: current.referenceNumber,
            expiryDate: current.expiryDate,
            isVerified: true,
          },
          summary: `${current.documentName} verified for ${current.licenceNumber}`,
        },
        tx,
      );

      return updated;
    });

    return NextResponse.json({ document: verified });
  } catch (error) {
    if (error instanceof Error && error.message.includes(VEHICLE_DOCUMENT_VERIFY_CONFLICT)) {
      return NextResponse.json(
        { error: 'This document changed while it was being reviewed. Refresh and review the latest version.' },
        { status: 409 },
      );
    }
    console.error('[fleet/:id/documents/:documentId/verify] PATCH failed:', error);
    return NextResponse.json({ error: 'Vehicle document could not be verified' }, { status: 500 });
  }
}
