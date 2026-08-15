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
import { buildTransportRequestRenderSnapshot } from '@/lib/pdf/verified-transport-request';
import { resolveTenantBranding } from '@/lib/tenant-branding';
import { runAtomicMutations } from '@/lib/db-atomic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

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

    // Freeze the exact visual payload at issuance. Draft previews may continue
    // to reflect operational progress, but issued PDFs render from immutable
    // renderData and branding metadata captured here.
    let snapshotData = (doc.snapshotData || {}) as Record<string, unknown>;
    if (action === 'issue') {
      if (!snapshotData.brandingMeta) {
        const branding = await resolveTenantBranding(doc.tenantId);
        if (branding) {
          snapshotData = {
            ...snapshotData,
            brandingMeta: {
              tenantId: branding.tenantId,
              organisationName: branding.organisationName,
              code: branding.code,
              locale: branding.locale,
              timezone: branding.timezone,
              division: branding.division,
              address: branding.address,
              phone: branding.phone,
              email: branding.email,
              website: branding.website,
              registrationNumber: branding.registrationNumber,
              motto: branding.motto,
              primaryColor: branding.primaryColor,
              accentColor: branding.accentColor,
              documentFooter: branding.documentFooter,
              executiveSignatoryName: branding.executiveSignatoryName,
              executiveSignatoryTitle: branding.executiveSignatoryTitle,
            },
          };
        }
      }

      if (!snapshotData.renderData) {
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
        } else if (doc.documentType === 'transport_request') {
          const renderData = await buildTransportRequestRenderSnapshot(doc.id, { issuing: true });
          if (!renderData) {
            return NextResponse.json(
              { error: 'Transport Request could not be prepared for official issuance.' },
              { status: 409 },
            );
          }
          snapshotData = { ...snapshotData, renderData };
        }
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
          after: {
            status: nextStatus,
            renderSnapshotFrozen: Boolean(snapshotData.renderData),
            brandingSnapshotFrozen: Boolean(snapshotData.brandingMeta),
          },
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
