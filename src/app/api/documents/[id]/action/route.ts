import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, ne } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { auditEvents } from '@/db/schema/audit';
import { requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';
import { canSessionReadGeneratedDocument } from '@/lib/document-access';
import { buildTripAuthorityRenderSnapshot } from '@/lib/pdf/verified-trip-authority';
import { buildInspectionReportRenderSnapshot } from '@/lib/pdf/verified-inspection-report';
import { runAtomicMutations } from '@/lib/db-atomic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    // Document lifecycle is an operational mutation, not a generic file upload.
    // Drivers and personal users may upload evidence/files but only a workspace
    // with update rights on the canonical Documents route may issue/supersede.
    const actionCheck = await requireDashboardAction(
      session,
      '/dashboard/documents',
      'update',
    );
    if (actionCheck instanceof NextResponse) return actionCheck;

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

    // Never allow an older draft to be promoted after a newer version exists.
    // Doing so would create multiple plausible "current" official records and
    // can resurrect stale snapshot data after a regeneration.
    if (action === 'issue') {
      const [latest] = await db
        .select({ id: generatedDocuments.id, documentVersion: generatedDocuments.documentVersion })
        .from(generatedDocuments)
        .where(
          and(
            eq(generatedDocuments.tenantId, session.tenantId),
            eq(generatedDocuments.entityType, doc.entityType),
            eq(generatedDocuments.entityId, doc.entityId),
            eq(generatedDocuments.documentType, doc.documentType),
          ),
        )
        .orderBy(desc(generatedDocuments.documentVersion))
        .limit(1);

      if (!latest || latest.id !== doc.id) {
        return NextResponse.json(
          {
            error: `Only the latest document version can be issued. Version ${latest?.documentVersion ?? 'unknown'} is newer than version ${doc.documentVersion}.`,
          },
          { status: 409 },
        );
      }
    }

    // Freeze the complete visual payload at the actual issuance boundary.
    // Trip Authority generated-document shells are created at allocation time,
    // before the canonical authority may exist, so issuance refuses to proceed
    // until a complete authority payload can be captured. Inspection reports
    // similarly store the exact checklist/signatory/branding render payload.
    let snapshotData = (doc.snapshotData || {}) as Record<string, unknown>;
    if (action === 'issue' && !snapshotData.renderData) {
      if (doc.documentType === 'trip_authority') {
        const renderData = await buildTripAuthorityRenderSnapshot(doc.id, { requireAuthority: true });
        if (!renderData) {
          return NextResponse.json(
            {
              error:
                'Trip Authority cannot be issued until the canonical authority has been provisioned with its approved driver, passenger and authorisation data.',
            },
            { status: 409 },
          );
        }
        snapshotData = { ...snapshotData, renderData };
      } else if (doc.documentType === 'inspection_report') {
        const renderData = await buildInspectionReportRenderSnapshot(doc.id);
        if (!renderData) {
          return NextResponse.json(
            { error: 'Inspection Report cannot be issued until its completed inspection data is available.' },
            { status: 409 },
          );
        }
        snapshotData = { ...snapshotData, renderData };
      }
    }

    const now = new Date();
    const nextStatus = action === 'issue' ? 'issued' : 'superseded';
    const documentHash = action === 'issue'
      ? createHash('sha256')
          .update(
            JSON.stringify({
              documentType: doc.documentType,
              version: doc.documentVersion,
              snapshot: snapshotData,
            }),
          )
          .digest('hex')
      : doc.hash;

    await runAtomicMutations((tx) => {
      const mutations = [];

      if (action === 'issue') {
        // Enforce one current issued version at the write boundary. This also
        // self-heals any historical duplicate-issued state when the next version
        // is formally issued.
        mutations.push(
          tx.update(generatedDocuments)
            .set({ status: 'superseded', updatedAt: now })
            .where(
              and(
                eq(generatedDocuments.tenantId, session.tenantId),
                eq(generatedDocuments.entityType, doc.entityType),
                eq(generatedDocuments.entityId, doc.entityId),
                eq(generatedDocuments.documentType, doc.documentType),
                eq(generatedDocuments.status, 'issued'),
                ne(generatedDocuments.id, id),
              ),
            ),
        );
      }

      mutations.push(
        tx.update(generatedDocuments)
          .set({
            status: nextStatus,
            hash: documentHash,
            snapshotData,
            updatedAt: now,
          })
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
          after: { status: nextStatus, renderSnapshotFrozen: Boolean(snapshotData.renderData) },
          sourceChannel: 'web',
        }),
      );

      return mutations;
    });

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
