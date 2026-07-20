import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { auditEvents } from '@/db/schema/audit';
import { eq } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.FILE_UPLOAD);
    if (permCheck instanceof NextResponse) return permCheck;

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

      // Audit log
      await db.insert(auditEvents).values({
        tenantId: doc.tenantId,
        tenantSequence: 0,
        eventType: 'document_issued',
        actorUserId: session.user.id,
        action: 'issue',
        entityType: 'document',
        entityId: id,
        summary: `Document issued: ${doc.documentType || 'unknown'}`,
        sourceChannel: 'web',
      });

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

      // Audit log
      await db.insert(auditEvents).values({
        tenantId: doc.tenantId,
        tenantSequence: 0,
        eventType: 'document_superseded',
        actorUserId: session.user.id,
        action: 'supersede',
        entityType: 'document',
        entityId: id,
        summary: `Document superseded: ${doc.documentType || 'unknown'}`,
        sourceChannel: 'web',
      });

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
