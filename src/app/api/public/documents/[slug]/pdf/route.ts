import { NextResponse } from 'next/server';
import { resolveShortSharedDocument } from '@/lib/share-token';
import { generateVerifiedTripAuthorityPdf } from '@/lib/pdf/verified-trip-authority';
import { generateVerifiedInspectionReportPdf } from '@/lib/pdf/verified-inspection-report';
import { generateVerifiedTransportRequestPdf } from '@/lib/pdf/verified-transport-request';
import { generateVerifiedSnapshotDocumentPdf } from '@/lib/pdf/verified-snapshot-documents';
import { generatePublicSharedDocumentPdf } from '@/lib/pdf/public-shared-document';
import { normalizePublicDocumentRedactionProfile } from '@/lib/public-document-redaction';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
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

  const profile = normalizePublicDocumentRedactionProfile(result.shareLink.redactionProfile);
  let pdf: { buffer: Uint8Array; filename: string } | null;

  if (profile === 'internal') {
    pdf = result.document.documentType === 'trip_authority'
      ? await generateVerifiedTripAuthorityPdf(result.document.id)
      : result.document.documentType === 'inspection_report'
        ? await generateVerifiedInspectionReportPdf(result.document.id)
        : result.document.documentType === 'transport_request'
          ? await generateVerifiedTransportRequestPdf(result.document.id)
          : await generateVerifiedSnapshotDocumentPdf(result.document.id);
  } else {
    const requestUrl = new URL(request.url);
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      `${requestUrl.protocol}//${requestUrl.host}`;
    pdf = await generatePublicSharedDocumentPdf({
      document: result.document,
      shareLink: result.shareLink,
      baseUrl,
    });
  }

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
