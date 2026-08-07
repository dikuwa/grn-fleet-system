/**
 * Public CMS FAQs API
 *
 * GET /api/cms/faqs?category=... — Return published FAQs, optionally filtered by category.
 * All published FAQs are public — no auth required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPublishedFaqs, getPublishedFaqCategories } from '@/lib/platform/cms-public';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category') || undefined;
    const faqs = await getPublishedFaqs(category);
    const categories = await getPublishedFaqCategories();
    return NextResponse.json({ success: true, data: { faqs, categories } });
  } catch (error) {
    console.error('[cms/faqs] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load FAQs' }, { status: 500 });
  }
}