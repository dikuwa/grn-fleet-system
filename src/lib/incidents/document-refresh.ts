import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { trips } from '@/db/schema/trips';
import { generateDocument, type DocumentType } from '@/lib/document-generator';

const INCIDENT_DOCUMENT_TYPES: DocumentType[] = ['trip_incident_report', 'accident_report'];

/**
 * Refresh the established incident document family after an operational review
 * changes fields printed on that report. If the trip is already closed, also
 * refresh/version Trip Completion so its printed event outcome remains aligned.
 * Issued historical versions are never mutated by generateDocument().
 */
export async function refreshIncidentOperationalDocuments(input: {
  tenantId: string;
  incidentId: string;
  tripId: string;
  actorUserId: string;
}) {
  const db = getDb();
  const [trip, existingIncidentDocuments] = await Promise.all([
    db
      .select({ status: trips.status })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.tenantId, input.tenantId)))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({ documentType: generatedDocuments.documentType })
      .from(generatedDocuments)
      .where(
        and(
          eq(generatedDocuments.tenantId, input.tenantId),
          eq(generatedDocuments.entityType, 'trip_incident'),
          eq(generatedDocuments.entityId, input.incidentId),
          inArray(generatedDocuments.documentType, INCIDENT_DOCUMENT_TYPES),
        ),
      ),
  ]);

  const documentTypes = [
    ...new Set(
      existingIncidentDocuments
        .map((document) => document.documentType)
        .filter((type): type is DocumentType => INCIDENT_DOCUMENT_TYPES.includes(type as DocumentType)),
    ),
  ];

  const effects = documentTypes.map((documentType) =>
    generateDocument({
      documentType,
      entityType: 'trip_incident',
      entityId: input.incidentId,
      tenantId: input.tenantId,
      generatedByUserId: input.actorUserId,
    }),
  );

  if (trip?.status === 'closed') {
    effects.push(
      generateDocument({
        documentType: 'trip_completion',
        entityType: 'trip',
        entityId: input.tripId,
        tenantId: input.tenantId,
        generatedByUserId: input.actorUserId,
      }),
    );
  }

  return Promise.allSettled(effects);
}
