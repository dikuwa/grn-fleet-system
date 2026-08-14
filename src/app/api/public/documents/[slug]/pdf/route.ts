import { NextResponse } from 'next/server';
import { resolveShortSharedDocument } from '@/lib/share-token';
import { generateDocumentPdf } from '@/lib/pdf/generate';
import { generateVerifiedTripAuthorityPdf } from '@/lib/pdf/verified-trip-authority';
import { generateVerifiedInspectionReportPdf } from '@/lib/pdf/verified-inspection-report';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await resolveShortSharedDocument(slug);
  if (!result.document || !result.shareLink) {
    return NextResponse.json({ error: 'Secure document link is unavailable.' }, { status: 404 });
  }
  if (result.shareLink.accessPolicy?.allowDownload !== true) {
    return NextResponse.json(
      { error: 'This share link permits verification only, not PDF download.' },
      { status: 403 },
    );
  }
  if (result.document.status === 'draft') {
    return NextResponse.json(
      { error: 'Draft documents cannot be downloaded publicly.' },
      { status: 403 },
    );
  }
  const pdf = result.document.documentType === 'trip_authority'
    ? await generateVerifiedTripAuthorityPdf(result.document.id)
    : result.document.documentType === 'inspection_report'
      ? await generateVerifiedInspectionReportPdf(result.document.id)
      : await generateDocumentPdf(result.document.id);
  if (!pdf) return NextResponse.json({ error: 'PDF is unavailable.' }, { status: 404 });
  return new NextResponse(pdf.buffer as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdf.filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
