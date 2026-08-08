/**
 * Platform FAQ Detail API
 *
 * PATCH  /api/platform/cms/faqs/[id] — Update an FAQ
 * DELETE /api/platform/cms/faqs/[id] — Delete an FAQ (hard delete with
 *         confirmation — FAQs are small content rows, not audit records)
 *
 * Both require an authenticated Platform Admin with SITE_MANAGE permission.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import { cmsFaqs } from '@/db/schema/cms-content';
import { eq } from 'drizzle-orm';

const cleanFaqText = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.SITE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const body = await request.json();
    const db = getDb();

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (body.question !== undefined) {
      const question = cleanFaqText(body.question, 300);
      if (!question) {
        return NextResponse.json({ error: 'question cannot be empty' }, { status: 400 });
      }
      updates.question = question;
    }
    if (body.answer !== undefined) {
      const answer = cleanFaqText(body.answer, 4000);
      if (!answer) {
        return NextResponse.json({ error: 'answer cannot be empty' }, { status: 400 });
      }
      updates.answer = answer;
    }
    if (body.category !== undefined) {
      updates.category = cleanFaqText(body.category, 80) || 'general';
    }
    if (body.sortOrder !== undefined && typeof body.sortOrder === 'number') {
      updates.sortOrder = Math.max(0, Math.round(body.sortOrder));
    }
    if (body.isPublished !== undefined) {
      updates.isPublished = body.isPublished === true;
    }

    const [updated] = await db
      .update(cmsFaqs)
      .set(updates)
      .where(eq(cmsFaqs.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'FAQ not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: { faq: updated } });
  } catch (error) {
    console.error('[Platform FAQ] PATCH failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.SITE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const db = getDb();

    const deleted = await db
      .delete(cmsFaqs)
      .where(eq(cmsFaqs.id, id))
      .returning({ id: cmsFaqs.id });

    if (deleted.length === 0) {
      return NextResponse.json({ error: 'FAQ not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: { id } });
  } catch (error) {
    console.error('[Platform FAQ] DELETE failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
