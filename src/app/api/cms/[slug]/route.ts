/**
 * Public CMS Content API
 *
 * GET /api/cms/[slug] — Return published CMS content by slug (no auth).
 *
 * Only rows with status `published` and `isLatest = true` are ever exposed.
 * A 404 is returned when the slug does not resolve to a published page.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPublishedContentBySlug } from '@/lib/platform/cms-public';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const content = await getPublishedContentBySlug(slug);
    if (!content) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: content });
  } catch (error) {
    console.error('[cms/content] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load content' }, { status: 500 });
  }
}