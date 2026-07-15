import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { eq } from 'drizzle-orm';
import { getServerSessionFromRequest } from '@/lib/session';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { action } = body; // 'issue' | 'supersede'

    if (!action || !['issue', 'supersede'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "issue" or "supersede".' },
        { status: 400 },
      );
    }

    const db = getDb();

    const [doc] = await db
      .select()
      .from(generatedDocuments)
      .where(eq(generatedDocuments.id, id))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    if (action === 'issue') {
      if (doc.status === 'issued') {
        return NextResponse.json(
          { error: 'Document is already issued' },
          { status: 409 },
        );
      }

      const [updated] = await db
        .update(generatedDocuments)
        .set({
          status: 'issued',
          updatedAt: new Date(),
        })
        .where(eq(generatedDocuments.id, id))
        .returning();

      return NextResponse.json({ success: true, data: updated });
    }

    if (action === 'supersede') {
      if (doc.status === 'superseded') {
        return NextResponse.json(
          { error: 'Document is already superseded' },
          { status: 409 },
        );
      }

      const [updated] = await db
        .update(generatedDocuments)
        .set({
          status: 'superseded',
          updatedAt: new Date(),
        })
        .where(eq(generatedDocuments.id, id))
        .returning();

      return NextResponse.json({ success: true, data: updated });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Document action failed:', error);
    return NextResponse.json(
      { error: 'Failed to update document: ' + String(error) },
      { status: 500 },
    );
  }
}
