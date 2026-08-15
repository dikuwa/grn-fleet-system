import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { auditEvents } from '@/db/schema/audit';
import { requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';
import { canSessionReadGeneratedDocument } from '@/lib/document-access';
import { buildTripAuthorityRenderSnapshot } from '@/lib/pdf/verified-trip-authority';
import { buildInspectionReportRenderSnapshot } from '@/lib/pdf/verified-inspection-report';
import { buildTransportRequestRenderSnapshot } from '@/lib/pdf/verified-transport-request';
import { resolveTenantDocumentBranding } from '@/lib/tenant-branding';
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
    const action = body?.action as string | undefined;
    if (action === 'supersede') {
      return NextResponse.json(
        {
          error:
            'Documents are superseded automatically when a newer draft is formally issued. Create or regenerate the replacement version, then issue that version.',
        },
        { status: 409 },
      );
    }
    if (action !== 'issue') {
      return NextResponse.json({ error: 'Invalid action. Must be "issue".' }, { status: 400 });
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

    if (doc.status !== 'draft') {
      return NextResponse.json(
        { error: `Only draft documents can be issued. Current status: ${doc.status}` },
        { status: 409 },
      );
    }

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

    // Issuance is the immutable boundary. Always refresh branding and the
    // document-type visual payload here, even if the draft already contains a
    // preview snapshot. This prevents changes made between draft generation and
    // issue from leaving the official version with stale data.
    const preparedAt = new Date();
    const draftUpdatedAt = doc.updatedAt;
    let snapshotData = (doc.snapshotData || {}) as Record<string, unknown>;
    const branding = await resolveTenantDocumentBranding(doc.tenantId);
    if (branding) {
      snapshotData = {
        ...snapshotData,
        documentIdentity: {
          organisationName: branding.organisationName,
          logoUrl: branding.logoUrl,
          primaryColor: branding.primaryColor,
          accentColor: branding.accentColor,
          executiveSignatoryName: branding.executiveSignatoryName,
          executiveSignatoryTitle: branding.executiveSignatoryTitle || 'Chief Executive Officer',
          executiveSignatureUrl: branding.executiveSignatureUrl,
          snapshottedAt: preparedAt.toISOString(),
        },
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

    const documentHash = createHash('sha256')
      .update(
        JSON.stringify({
          documentType: doc.documentType,
          version: doc.documentVersion,
          snapshot: snapshotData,
        }),
      )
      .digest('hex');

    // The target must still be the exact draft revision read above. Generation
    // can refresh a pending draft in place; updated_at is therefore the
    // optimistic concurrency token that prevents issuance from overwriting a
    // newer source snapshot prepared while this request was rendering.
    const targetStillDraft = sql`exists (
      select 1
      from generated_documents target
      where target.id = ${id}::uuid
        and target.tenant_id = ${session.tenantId}::uuid
        and target.status = 'draft'
        and target.updated_at = ${draftUpdatedAt}
    )`;

    await runAtomicMutations((tx) => [
      tx.update(generatedDocuments)
        .set({ status: 'superseded', updatedAt: preparedAt })
        .where(
          and(
            eq(generatedDocuments.tenantId, session.tenantId),
            eq(generatedDocuments.entityType, doc.entityType),
            eq(generatedDocuments.entityId, doc.entityId),
            eq(generatedDocuments.documentType, doc.documentType),
            eq(generatedDocuments.status, 'issued'),
            ne(generatedDocuments.id, id),
            targetStillDraft,
          ),
        ),
      tx.update(generatedDocuments)
        .set({
          status: 'issued',
          hash: documentHash,
          snapshotData,
          updatedAt: preparedAt,
        })
        .where(
          and(
            eq(generatedDocuments.id, id),
            eq(generatedDocuments.tenantId, session.tenantId),
            eq(generatedDocuments.status, 'draft'),
            eq(generatedDocuments.updatedAt, draftUpdatedAt),
          ),
        ),
    ]);

    const [updated] = await db
      .select()
      .from(generatedDocuments)
      .where(and(eq(generatedDocuments.id, id), eq(generatedDocuments.tenantId, session.tenantId)))
      .limit(1);
    if (
      !updated ||
      updated.status !== 'issued' ||
      updated.updatedAt.getTime() !== preparedAt.getTime()
    ) {
      return NextResponse.json(
        { error: 'This draft changed while the issue action was being prepared. Refresh and review the latest version before issuing.' },
        { status: 409 },
      );
    }

    try {
      await db.insert(auditEvents).values({
        tenantId: doc.tenantId,
        tenantSequence: Date.now(),
        eventType: 'document_issued',
        actorUserId: session.user.id,
        action: 'issue',
        entityType: 'document',
        entityId: id,
        summary: `Document issued: ${doc.documentType || 'unknown'}`,
        before: { status: doc.status },
        after: {
          status: 'issued',
          documentVersion: doc.documentVersion,
          renderSnapshotFrozen: Boolean(snapshotData.renderData),
          brandingSnapshotFrozen: Boolean(snapshotData.brandingMeta),
          fingerprint: documentHash,
        },
        sourceChannel: 'web',
      });
    } catch (auditError) {
      console.error('[documents/action] Issuance committed but audit event failed:', auditError);
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('Document action failed:', error);
    return NextResponse.json({ error: 'Failed to update document' }, { status: 500 });
  }
}
