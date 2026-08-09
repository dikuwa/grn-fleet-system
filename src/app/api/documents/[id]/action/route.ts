import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { auditEvents } from '@/db/schema/audit';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { canSessionReadGeneratedDocument } from '@/lib/document-access';
import { runAtomicMutations } from '@/lib/db-atomic';

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
    const action = body?.action as 'issue' | 'supersede' | undefined;
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
      .where(and(eq(generatedDocuments.id, id), eq(generatedDocuments.tenantId, session.tenantId)))
      .limit(1);
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const canRead = await canSessionReadGeneratedDocument(session, doc);
    if (!canRead) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    if (action === 'issue' && doc.status !== 'draft') {
      return NextResponse.json(
        { error: `Only draft documents can be issued. Current status: ${doc.status}` },
        { status: 409 },
      );
    }
    if (action === 'supersede' && doc.status !== 'issued') {
      return NextResponse.json(
        { error: 'Only an issued document can be superseded.' },
        { status: 409 },
      );
    }

    const now = new Date();
    const nextStatus = action === 'issue' ? 'issued' : 'superseded';
    const documentHash = action === 'issue'
      ? createHash('sha256')
          .update(
            JSON.stringify({
              documentType: doc.documentType,
              version: doc.documentVersion,
              snapshot: doc.snapshotData,
            }),
          )
          .digest('hex')
      : doc.hash;

    await runAtomicMutations((tx) => [
      tx.update(generatedDocuments)
        .set({ status: nextStatus, hash: documentHash, updatedAt: now })
        .where(
          and(
            eq(generatedDocuments.id, id),
            eq(generatedDocuments.tenantId, session.tenantId),
            eq(generatedDocuments.status, doc.status),
          ),
        ),
      tx.insert(auditEvents).values({
        tenantId: doc.tenantId,
        tenantSequence: Date.now(),
        eventType: action === 'issue' ? 'document_issued' : 'document_superseded',
        actorUserId: session.user.id,
        action,
        entityType: 'document',
        entityId: id,
        summary: `Document ${action === 'issue' ? 'issued' : 'superseded'}: ${doc.documentType || 'unknown'}`,
        before: { status: doc.status },
        after: { status: nextStatus },
        sourceChannel: 'web',
      }),
    ]);

    const [updated] = await db
      .select()
      .from(generatedDocuments)
      .where(and(eq(generatedDocuments.id, id), eq(generatedDocuments.tenantId, session.tenantId)))
      .limit(1);
    if (!updated || updated.status !== nextStatus) {
      return NextResponse.json(
        { error: 'This document changed while the action was being processed. Refresh and try again.' },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('Document action failed:', error);
    return NextResponse.json({ error: 'Failed to update document' }, { status: 500 });
  }
}
