import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { vehicleDocuments, vehicles } from '@/db/schema/fleet';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';
import { VEHICLE_DOCUMENT_TYPE_SET } from '@/lib/vehicle-documents';

function isDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const routeCheck = await requireDashboardAction(session, '/dashboard/fleet', 'update');
    if (routeCheck instanceof NextResponse) return routeCheck;
    const vehiclePermission = await requirePermission(session, Permissions.VEHICLE_UPDATE);
    if (vehiclePermission instanceof NextResponse) return vehiclePermission;

    const { id } = await params;
    const db = getDb();
    const documents = await db
      .select({
        id: vehicleDocuments.id,
        documentType: vehicleDocuments.documentType,
        documentName: vehicleDocuments.documentName,
        referenceNumber: vehicleDocuments.referenceNumber,
        issueDate: vehicleDocuments.issueDate,
        expiryDate: vehicleDocuments.expiryDate,
        fileKey: vehicleDocuments.fileKey,
        isVerified: vehicleDocuments.isVerified,
        updatedAt: vehicleDocuments.updatedAt,
      })
      .from(vehicleDocuments)
      .innerJoin(vehicles, eq(vehicleDocuments.vehicleId, vehicles.id))
      .where(
        and(
          eq(vehicleDocuments.vehicleId, id),
          eq(vehicles.tenantId, session.tenantId),
          eq(vehicleDocuments.isVerified, false),
        ),
      )
      .orderBy(desc(vehicleDocuments.createdAt));

    return NextResponse.json({ documents });
  } catch (error) {
    console.error('[fleet/:id/documents] GET failed:', error);
    return NextResponse.json({ error: 'Vehicle documents could not be loaded' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const routeCheck = await requireDashboardAction(session, '/dashboard/fleet', 'update');
    if (routeCheck instanceof NextResponse) return routeCheck;
    const vehiclePermission = await requirePermission(session, Permissions.VEHICLE_UPDATE);
    if (vehiclePermission instanceof NextResponse) return vehiclePermission;
    const filePermission = await requirePermission(session, Permissions.FILE_UPLOAD);
    if (filePermission instanceof NextResponse) return filePermission;

    const { id } = await params;
    const body = await request.json();
    const documentType = String(body.documentType || '').trim();
    const documentName = String(body.documentName || '').trim();
    const fileKey = String(body.fileKey || '').trim();
    const issueDate = String(body.issueDate || '').trim() || null;
    const expiryDate = String(body.expiryDate || '').trim() || null;
    if (!VEHICLE_DOCUMENT_TYPE_SET.has(documentType)) {
      return NextResponse.json({ error: 'Select a valid vehicle document type' }, { status: 422 });
    }
    if (!documentName) return NextResponse.json({ error: 'Document name is required' }, { status: 422 });
    if (!fileKey.startsWith(`tenant/${session.tenantId}/documents/`)) {
      return NextResponse.json({ error: 'The uploaded file does not belong to this organisation' }, { status: 422 });
    }
    if (issueDate && !isDateOnly(issueDate)) {
      return NextResponse.json({ error: 'Issue date must use YYYY-MM-DD' }, { status: 422 });
    }
    if (expiryDate && !isDateOnly(expiryDate)) {
      return NextResponse.json({ error: 'Expiry date must use YYYY-MM-DD' }, { status: 422 });
    }
    if (issueDate && expiryDate && expiryDate < issueDate) {
      return NextResponse.json({ error: 'Expiry date cannot be before the issue date' }, { status: 422 });
    }

    const db = getDb();
    const [vehicle] = await db
      .select({ id: vehicles.id, licenceNumber: vehicles.licenceNumber })
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);
    if (!vehicle) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });

    const document = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(vehicleDocuments)
        .values({
          vehicleId: id,
          documentType,
          documentName,
          referenceNumber: String(body.referenceNumber || '').trim() || null,
          issueDate,
          expiryDate,
          fileKey,
          notes: String(body.notes || '').trim() || null,
          isVerified: false,
        })
        .returning();
      await recordAuditEvent(
        {
          tenantId: session.tenantId,
          actorUserId: session.user.id,
          eventType: 'vehicle_document_uploaded',
          action: 'vehicle.document.upload',
          entityType: 'vehicle',
          entityId: id,
          after: {
            documentId: created.id,
            documentType,
            referenceNumber: created.referenceNumber,
            expiryDate: created.expiryDate,
          },
          summary: `${documentName} uploaded for ${vehicle.licenceNumber}; previous ${documentType.replaceAll('_', ' ')} records retained`,
        },
        tx,
      );
      return created;
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    console.error('[fleet/:id/documents] POST failed:', error);
    return NextResponse.json({ error: 'Vehicle document could not be saved' }, { status: 500 });
  }
}
