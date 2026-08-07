/**
 * MVA Report API
 *
 * GET /api/incidents/[id]/mva-report — Generate and return the MVA PDF report
 * POST /api/incidents/[id]/mva-report — Regenerate the MVA report document snapshot
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  getTenantIncident,
  generateMvaReport,
} from '@/lib/incidents/mva';
import { generateDocumentPdf } from '@/lib/pdf/generate';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { and, eq, desc } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// GET — Download the MVA report as a PDF
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.FILE_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const incident = await getTenantIncident(session.tenantId, id);
    if (!incident) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
    }

    // Find the existing accident_report document for this incident
    const db = getDb();
    const [doc] = await db
      .select()
      .from(generatedDocuments)
      .where(
        and(
          eq(generatedDocuments.entityType, 'trip_incident'),
          eq(generatedDocuments.entityId, id),
          eq(generatedDocuments.documentType, 'accident_report'),
        ),
      )
      .orderBy(desc(generatedDocuments.documentVersion))
      .limit(1);

    if (!doc) {
      return NextResponse.json(
        { error: 'MVA report has not been generated yet. Use POST to generate.' },
        { status: 404 },
      );
    }

    const result = await generateDocumentPdf(doc.id);
    if (!result) {
      return NextResponse.json(
        { error: 'PDF rendering failed' },
        { status: 500 },
      );
    }

    return new NextResponse(result.buffer as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      },
    });
  } catch (error) {
    console.error('[mva-report] GET failed:', error);
    return NextResponse.json({ error: 'Failed to generate MVA PDF' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Generate/regenerate the MVA report document
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(
      session,
      Permissions.INCIDENT_INVESTIGATE,
    );
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const incident = await getTenantIncident(session.tenantId, id);
    if (!incident) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
    }

    const result = await generateMvaReport(
      session.tenantId,
      id,
      session.user.id,
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      data: {
        documentId: result.document.id,
        documentVersion: result.document.documentVersion,
        status: result.document.status,
      },
    });
  } catch (error) {
    console.error('[mva-report] POST failed:', error);
    return NextResponse.json({ error: 'Failed to generate MVA report' }, { status: 500 });
  }
}