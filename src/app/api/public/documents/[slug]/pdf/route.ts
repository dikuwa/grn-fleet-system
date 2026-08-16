import { NextResponse } from 'next/server';
import { resolveShortSharedDocument } from '@/lib/share-token';
import { generatePublicSharedDocumentPdf } from '@/lib/pdf/public-shared-document';

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

  // A public URL is always a public disclosure boundary. Even a historical
  // row labelled "internal" receives an allow-list-only shared PDF here; the
  // complete official PDF remains available only from authenticated document
  // routes with workspace/record authorization.
  const requestUrl = new URL(request.url);
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    `${requestUrl.protocol}//${requestUrl.host}`;
  const pdf = await generatePublicSharedDocumentPdf({
    document: result.document,
    shareLink: result.shareLink,
    baseUrl,
  });

  return new NextResponse(pdf.buffer as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdf.filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
