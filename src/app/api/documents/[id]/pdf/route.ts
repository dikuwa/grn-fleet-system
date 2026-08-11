import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { generateDocumentPdf } from '@/lib/pdf/generate';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { and, eq } from 'drizzle-orm';
import { canSessionReadGeneratedDocument } from '@/lib/document-access';

/**
 * GET /api/documents/[id]/pdf
 *
 * Generate and download a PDF for a generated document. Tenant isolation is
 * necessary but not sufficient: Personal/Requester users must also be entitled
 * to the underlying request/trip/inspection record.
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
      // Hide document existence from users outside the underlying record scope.
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const result = await generateDocumentPdf(id);
    if (!result) {
      return NextResponse.json(
        {
          error:
            'PDF generation not available for this document type. Only Trip Authority and Inspection Report documents support PDF export.',
        },
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
      },
    });
  } catch (error) {
    console.error('[documents/pdf] Failed:', error);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
