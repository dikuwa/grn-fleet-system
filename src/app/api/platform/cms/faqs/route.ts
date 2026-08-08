/**
 * Platform FAQ Admin API
 *
 * GET  /api/platform/cms/faqs — List all FAQs (published and unpublished),
 *      ordered by sort order. Optional ?category= filter.
 * POST /api/platform/cms/faqs — Create a new FAQ.
 *
 * Both require an authenticated Platform Admin with SITE_MANAGE permission.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import { cmsFaqs } from '@/db/schema/cms-content';
import { asc, eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// GET — List FAQs
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.SITE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || '';

    const db = getDb();
    const faqs = category
      ? await db
          .select()
          .from(cmsFaqs)
          .where(eq(cmsFaqs.category, category))
          .orderBy(asc(cmsFaqs.sortOrder), asc(cmsFaqs.createdAt))
      : await db
          .select()
          .from(cmsFaqs)
          .orderBy(asc(cmsFaqs.sortOrder), asc(cmsFaqs.createdAt));

    return NextResponse.json({ success: true, data: { faqs } });
  } catch (error) {
    console.error('[Platform FAQ] GET failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Create FAQ
// ---------------------------------------------------------------------------

const cleanFaqText = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.SITE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const question = cleanFaqText(body.question, 300);
    const answer = cleanFaqText(body.answer, 4000);

    if (!question || !answer) {
      return NextResponse.json(
        { error: 'question and answer are required' },
        { status: 400 },
      );
    }

    const db = getDb();
    const [created] = await db
      .insert(cmsFaqs)
      .values({
        category: cleanFaqText(body.category, 80) || 'general',
        question,
        answer,
        sortOrder:
          typeof body.sortOrder === 'number' && Number.isFinite(body.sortOrder)
            ? Math.max(0, Math.round(body.sortOrder))
            : 0,
        isPublished: body.isPublished !== false,
      })
      .returning();

    return NextResponse.json({ success: true, data: { faq: created } }, { status: 201 });
  } catch (error) {
    console.error('[Platform FAQ] POST failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
