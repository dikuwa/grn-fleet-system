import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { generateDocumentPdf } from '@/lib/pdf/generate';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { eq } from 'drizzle-orm';

/**
 * GET /api/documents/[id]/pdf
 *
 * Generate and download a PDF for a generated document.
 * Only Trip Authority and Inspection Report documents currently support PDF generation.
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

    // Verify the document exists and belongs to this tenant
    const db = getDb();
    const [doc] = await db
      .select()
      .from(generatedDocuments)
      .where(
        eq(generatedDocuments.id, id),
      )
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Tenant isolation check
    if (doc.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Document not found in your tenant' }, { status: 404 });
    }

    const result = await generateDocumentPdf(id);
    if (!result) {
      return NextResponse.json(
        { error: 'PDF generation not available for this document type. Only Trip Authority and Inspection Report documents support PDF export.' },
        { status: 400 },
      );
    }

    // Return the PDF as a downloadable response
    return new NextResponse(result.buffer as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      },
    });
  } catch (error) {
    console.error('[documents/pdf] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to generate PDF: ' + String(error) },
      { status: 500 },
    );
  }
}
