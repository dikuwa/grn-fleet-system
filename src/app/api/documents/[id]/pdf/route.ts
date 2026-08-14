import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { generateVerifiedTripAuthorityPdf } from '@/lib/pdf/verified-trip-authority';
import { generateVerifiedInspectionReportPdf } from '@/lib/pdf/verified-inspection-report';
import { generateVerifiedTransportRequestPdf } from '@/lib/pdf/verified-transport-request';
import { generateVerifiedSnapshotDocumentPdf } from '@/lib/pdf/verified-snapshot-documents';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { and, eq } from 'drizzle-orm';
import { canSessionReadGeneratedDocument } from '@/lib/document-access';

/**
 * GET /api/documents/[id]/pdf
 *
 * Generate one canonical PDF for preview, print and download. Tenant isolation
 * is necessary but not sufficient: Personal/Requester users must also be
 * entitled to the underlying request/trip/inspection record.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.FILE_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const [doc] = await db
      .select()
      .from(generatedDocuments)
      .where(and(eq(generatedDocuments.id, id), eq(generatedDocuments.tenantId, session.tenantId)))
      .limit(1);

    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const canRead = await canSessionReadGeneratedDocument(session, doc);
    if (!canRead) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const result = doc.documentType === 'trip_authority'
      ? await generateVerifiedTripAuthorityPdf(id)
      : doc.documentType === 'inspection_report'
        ? await generateVerifiedInspectionReportPdf(id)
        : doc.documentType === 'transport_request'
          ? await generateVerifiedTransportRequestPdf(id)
          : await generateVerifiedSnapshotDocumentPdf(id);
    if (!result) {
      return NextResponse.json(
        { error: 'PDF generation is not available for this document.' },
        { status: 400 },
      );
    }

    const disposition = new URL(request.url).searchParams.get('preview') === '1'
      ? 'inline'
      : 'attachment';
    return new NextResponse(result.buffer as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${result.filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[documents/pdf] Failed:', error);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
