import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { tripIncidents, trips } from '@/db/schema/trips';
import { generateDocument, type DocumentType } from '@/lib/document-generator';
import { getIncidentCategory } from '@/lib/incidents/categories';
import { requiresMvaForm, type CreateIncidentInput } from '@/lib/incidents/create-incident';

const INCIDENT_DOCUMENT_TYPES: DocumentType[] = ['trip_incident_report', 'accident_report'];

type DocumentRefreshPayload = Parameters<typeof generateDocument>[0];

async function generateSerializedDocument(payload: DocumentRefreshPayload) {
  const db = getDb();
  const lockKey = [
    payload.tenantId,
    payload.entityType,
    payload.entityId,
    payload.documentType,
  ].join(':');

  // A transaction-scoped PostgreSQL advisory lock serializes refreshes for the
  // same mutable draft across requests and serverless instances. The document
  // generator uses ordinary Neon HTTP reads/writes while this session lock is
  // held, so a slower snapshot cannot overwrite evidence produced by a newer
  // mutation that targeted the same document key.
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    return generateDocument(payload);
  });
}

function logRejectedRefreshes(
  label: string,
  results: PromiseSettledResult<unknown>[],
) {
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(`[incidents/document-refresh] ${label} failed:`, result.reason);
    }
  }
}

export async function refreshIncidentTripCompletionIfClosed(input: {
  tenantId: string;
  tripId: string;
  actorUserId: string;
}) {
  try {
    const db = getDb();
    const [trip] = await db
      .select({ status: trips.status })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.tenantId, input.tenantId)))
      .limit(1);

    if (trip?.status !== 'closed') return [];

    const results = await Promise.allSettled([
      generateSerializedDocument({
        documentType: 'trip_completion',
        entityType: 'trip',
        entityId: input.tripId,
        tenantId: input.tenantId,
        generatedByUserId: input.actorUserId,
      }),
    ]);
    logRejectedRefreshes('Trip Completion refresh', results);
    return results;
  } catch (error) {
    console.error('[incidents/document-refresh] Trip Completion refresh failed:', error);
    return [];
  }
}

/**
 * Refresh the established incident document family after an operational review
 * changes fields printed on that report. If the original document side effect
 * failed, reconstruct the correct family from the current incident/category
 * rules. If the trip is closed, also refresh/version Trip Completion so its
 * printed event outcome remains aligned. Issued historical versions are never
 * mutated by generateDocument().
 */
export async function refreshIncidentOperationalDocuments(input: {
  tenantId: string;
  incidentId: string;
  tripId: string;
  actorUserId: string;
}) {
  const db = getDb();
  const [trip, incident, existingIncidentDocuments] = await Promise.all([
    db
      .select({ status: trips.status })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.tenantId, input.tenantId)))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        incidentType: tripIncidents.incidentType,
        incidentCategoryCode: tripIncidents.incidentCategoryCode,
        severity: tripIncidents.severity,
      })
      .from(tripIncidents)
      .where(
        and(
          eq(tripIncidents.id, input.incidentId),
          eq(tripIncidents.tripId, input.tripId),
          eq(tripIncidents.tenantId, input.tenantId),
        ),
      )
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

  if (!incident) return [];

  const category = incident.incidentCategoryCode
    ? await getIncidentCategory(input.tenantId, incident.incidentCategoryCode)
    : null;
  const expectedDocumentType: DocumentType = requiresMvaForm({
    incidentCategoryCode: incident.incidentCategoryCode,
    requiresMvaForm: category?.requiresMvaForm ?? false,
    incidentType: incident.incidentType,
    severity: incident.severity as CreateIncidentInput['severity'],
  })
    ? 'accident_report'
    : 'trip_incident_report';

  const documentTypes = [
    ...new Set<DocumentType>([
      expectedDocumentType,
      ...existingIncidentDocuments
        .map((document) => document.documentType)
        .filter((type): type is DocumentType => INCIDENT_DOCUMENT_TYPES.includes(type as DocumentType)),
    ]),
  ];

  const effects = documentTypes.map((documentType) =>
    generateSerializedDocument({
      documentType,
      entityType: 'trip_incident',
      entityId: input.incidentId,
      tenantId: input.tenantId,
      generatedByUserId: input.actorUserId,
    }),
  );

  if (trip?.status === 'closed') {
    effects.push(
      generateSerializedDocument({
        documentType: 'trip_completion',
        entityType: 'trip',
        entityId: input.tripId,
        tenantId: input.tenantId,
        generatedByUserId: input.actorUserId,
      }),
    );
  }

  const results = await Promise.allSettled(effects);
  logRejectedRefreshes('Operational document refresh', results);
  return results;
}
