import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { auditEvents } from '@/db/schema/audit';
import { tripAuthorities } from '@/db/schema/trips';
import { requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';
import { canSessionReadGeneratedDocument } from '@/lib/document-access';
import { buildTripAuthorityRenderSnapshot } from '@/lib/pdf/verified-trip-authority';
import { buildInspectionReportRenderSnapshot } from '@/lib/pdf/verified-inspection-report';
import { buildTransportRequestRenderSnapshot } from '@/lib/pdf/verified-transport-request';
import { resolveTenantDocumentBranding } from '@/lib/tenant-branding';
import { runAtomicMutations } from '@/lib/db-atomic';
import { findPendingVehicleReplacementAcceptance } from '@/lib/trip-amendment-acceptance';
import { enrichClosedTripFuelSummary } from '@/lib/trip-closure-document-enrichment';
import { refreshTripCompletionDraftForIssue } from '@/lib/trip-completion-issue-refresh';

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
    const [loadedDoc] = await db
      .select()
      .from(generatedDocuments)
      .where(and(eq(generatedDocuments.id, id), eq(generatedDocuments.tenantId, session.tenantId)))
      .limit(1);
    if (!loadedDoc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    let doc = loadedDoc;

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

    // Closure-generated Fuel Summaries may include legacy aggregate-only drafts.
    // Refresh the final verified transaction table and trip/vehicle identity at
    // the formal issue boundary. The helper is draft-only and requires a closed
    // tenant-scoped trip, so issued historical rows remain immutable.
    if (doc.documentType === 'fuel_summary' && doc.entityType === 'trip') {
      const enriched = await enrichClosedTripFuelSummary(doc.entityId, doc.tenantId, doc.id);
      if (enriched) doc = enriched;
      const fuelSnapshot = (doc.snapshotData || {}) as Record<string, unknown>;
      if (
        !String(fuelSnapshot.tripReference || '').trim() ||
        !String(fuelSnapshot.vehicleLicence || '').trim() ||
        !Array.isArray(fuelSnapshot.transactions)
      ) {
        return NextResponse.json(
          {
            error:
              'Fuel Summary cannot be formally issued until the closed-trip transaction detail and vehicle identity have been reconciled.',
          },
          { status: 409 },
        );
      }
    }

    // Incident investigations may legitimately progress after operational trip
    // closure. Refresh an unissued completion draft immediately before Issue so
    // the official report freezes the latest investigation outcome without
    // blocking later safety work or rewriting an already-issued document.
    if (doc.documentType === 'trip_completion' && doc.entityType === 'trip') {
      const refreshed = await refreshTripCompletionDraftForIssue(doc.entityId, doc.tenantId, doc.id);
      if (refreshed) doc = refreshed;
      const completionSnapshot = (doc.snapshotData || {}) as Record<string, unknown>;
      if (
        completionSnapshot.status !== 'closed' ||
        !completionSnapshot.closure ||
        !completionSnapshot.vehicle ||
        !completionSnapshot.eventSummary
      ) {
        return NextResponse.json(
          {
            error:
              'Trip Completion cannot be formally issued until the trip is closed and its reconciliation and safety summary can be rebuilt.',
          },
          { status: 409 },
        );
      }
    }

    // Trip Authority issuance is the final pre-release document boundary. The
    // driver's acceptance must cover the current vehicle and the current
    // vehicle must have passed its official departure inspection before the
    // immutable PDF is frozen.
    if (doc.documentType === 'trip_authority' && doc.entityType === 'vehicle_allocation') {
      const [authority] = await db
        .select({
          id: tripAuthorities.id,
          status: tripAuthorities.status,
          acceptedAt: tripAuthorities.acceptedAt,
        })
        .from(tripAuthorities)
        .where(
          and(
            eq(tripAuthorities.allocationId, doc.entityId),
            eq(tripAuthorities.tenantId, session.tenantId),
          ),
        )
        .limit(1);
      if (authority) {
        const pendingAmendment = await findPendingVehicleReplacementAcceptance({
          authorityId: authority.id,
          acceptedAt: authority.acceptedAt,
        });
        if (pendingAmendment) {
          return NextResponse.json(
            {
              error:
                'The vehicle changed after the driver accepted this Trip Authority. The revised authority must be acknowledged before this document version can be formally issued.',
              amendmentId: pendingAmendment.amendmentId,
              requiresAmendmentAcceptance: true,
            },
            { status: 409 },
          );
        }
        if (authority.status !== 'ready_for_departure') {
          return NextResponse.json(
            {
              error:
                'Trip Authority can only be formally issued after the current vehicle has passed its official departure inspection.',
              authorityStatus: authority.status,
              requiresDepartureInspection: true,
            },
            { status: 409 },
          );
        }
      }
    }

    const preparedAt = new Date();
    const draftHash = doc.hash;
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
      const renderData = await buildTripAuthorityRenderSnapshot(doc.id, {
        requireAuthority: true,
        issuedAt: preparedAt.toISOString(),
      });
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
      const renderData = await buildTransportRequestRenderSnapshot(doc.id, {
        issuing: true,
        issuedAt: preparedAt.toISOString(),
      });
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

    const tripAuthorityLifecycleCurrent =
      doc.documentType === 'trip_authority' && doc.entityType === 'vehicle_allocation'
        ? sql`exists (
            select 1
            from trip_authorities ta
            where ta.tenant_id = ${session.tenantId}::uuid
              and ta.allocation_id = ${doc.entityId}::uuid
              and ta.status = 'ready_for_departure'
              and ta.accepted_at is not null
              and not exists (
                select 1
                from trip_amendments am
                where am.authority_id = ta.id
                  and am.amendment_type = 'vehicle_replacement'
                  and am.status = 'approved'
                  and am.created_at > ta.accepted_at
              )
          )`
        : sql`true`;

    const targetStillDraft = sql`exists (
      select 1
      from generated_documents target
      where target.id = ${id}::uuid
        and target.tenant_id = ${session.tenantId}::uuid
        and target.status = 'draft'
        and target.hash is not distinct from ${draftHash}
        and ${tripAuthorityLifecycleCurrent}
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
            sql`${generatedDocuments.hash} is not distinct from ${draftHash}`,
            tripAuthorityLifecycleCurrent,
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
        { error: 'This draft or its authority lifecycle changed while the issue action was being prepared. Refresh and review the latest version before issuing.' },
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
