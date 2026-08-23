/**
 * Motor Vehicle Accident (MVA) workflow service.
 *
 * Permissioned, transactional mutations for the accident-report lifecycle:
 * investigation, insurance, technical clearance. Guards enforce the
 * MVA state machine so partial data cannot be written out of order.
 */

import { getDb } from '@/db';
import { tripIncidents } from '@/db/schema/trips';
import { and, eq, sql } from 'drizzle-orm';
import { recordAuditEvent } from '@/lib/audit-event';
import { generateDocument } from '@/lib/document-generator';

// Re-export client-safe constants and types
export {
  INVESTIGATION_STATUSES,
  TECHNICAL_CLEARANCE_STATUSES,
  INVESTIGATION_STATUS_LABELS,
  TECHNICAL_CLEARANCE_STATUS_LABELS,
  type InvestigationStatus,
  type TechnicalClearanceStatus,
} from './mva-constants';
import {
  INVESTIGATION_STATUSES,
  type InvestigationStatus,
} from './mva-constants';

// ---------------------------------------------------------------------------
// Authorization-aware fetch
// ---------------------------------------------------------------------------

/** Load an incident scoped to a tenant. Returns null if not found. */
export async function getTenantIncident(tenantId: string, incidentId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(tripIncidents)
    .where(
      and(eq(tripIncidents.id, incidentId), eq(tripIncidents.tenantId, tenantId)),
    )
    .limit(1);
  return row || null;
}

/** Regenerate the stored MVAR document (fire-and-forget). */
function regenerateMvaReport(
  tenantId: string,
  incidentId: string,
  actorUserId: string,
) {
  generateDocument({
    documentType: 'accident_report',
    entityType: 'trip_incident',
    entityId: incidentId,
    tenantId,
    generatedByUserId: actorUserId,
  }).catch((err) =>
    console.error('[mva] MVAR regeneration failed:', err),
  );
}

// ---------------------------------------------------------------------------
// Investigation
// ---------------------------------------------------------------------------

export async function updateInvestigation(
  tenantId: string,
  incidentId: string,
  actorUserId: string,
  input: {
    status?: InvestigationStatus;
    notes?: string | null;
    addedWitnesses?: Array<Record<string, unknown>>;
    accidentReportNumber?: string;
  },
) {
  const db = getDb();
  const incident = await getTenantIncident(tenantId, incidentId);
  if (!incident) return { ok: false as const, error: 'Incident not found' };

  if (input.status && !INVESTIGATION_STATUSES.includes(input.status)) {
    return { ok: false as const, error: 'Invalid investigation status' };
  }

  // Closed investigation evidence is terminal. This service is shared by more
  // than one route, so protect the state here as well as in individual APIs.
  if (incident.investigationStatus === 'closed' || incident.status === 'resolved') {
    return { ok: false as const, error: 'investigation_already_closed' };
  }

  const isClosing = input.status === 'closed';
  const requiresTechnicalClearance =
    incident.vehicleDamage ||
    incident.vehicleSafe === false ||
    incident.severity === 'critical';

  if (
    isClosing &&
    requiresTechnicalClearance &&
    incident.technicalClearanceStatus !== 'cleared'
  ) {
    return { ok: false as const, error: 'technical_clearance_required' };
  }

  // Closing an investigation requires notes.
  if (isClosing && !input.notes?.trim()) {
    return {
      ok: false as const,
      error: 'Investigation notes are required before closing',
    };
  }

  const row = await db.transaction(async (tx) => {
    const set: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (input.status) set.investigationStatus = input.status;
    if (input.notes !== undefined) set.investigationNotes = input.notes;
    if (isClosing) {
      set.investigationClosedAt = new Date();
      if (input.notes?.trim()) {
        set.investigationNotes = input.notes.trim();
      }
    }
    if (input.accidentReportNumber) {
      set.accidentReportNumber = input.accidentReportNumber;
    }
    if (input.addedWitnesses) {
      const existing = Array.isArray(incident.witnessStatements)
        ? incident.witnessStatements
        : [];
      set.witnessStatements = [...existing, ...input.addedWitnesses];
    }

    const claimConditions = [
      eq(tripIncidents.id, incidentId),
      eq(tripIncidents.tenantId, tenantId),
      sql`${tripIncidents.investigationStatus} <> 'closed'`,
      sql`${tripIncidents.status} <> 'resolved'`,
    ];
    if (isClosing) {
      claimConditions.push(sql`(
        NOT (
          ${tripIncidents.vehicleDamage} IS TRUE
          OR ${tripIncidents.vehicleSafe} IS FALSE
          OR ${tripIncidents.severity} = 'critical'
        )
        OR ${tripIncidents.technicalClearanceStatus} = 'cleared'
      )`);
    }

    const [updated] = await tx
      .update(tripIncidents)
      .set(set)
      .where(and(...claimConditions))
      .returning();

    // Another workflow may have closed the investigation or changed its safety
    // state after the preflight read. Do not append an audit event for a write
    // that lost that race.
    if (!updated) return null;

    await recordAuditEvent(
      {
        tenantId,
        actorUserId,
        eventType: 'incident_investigation_updated',
        action: 'update',
        entityType: 'trip_incident',
        entityId: incidentId,
        summary:
          `${incident.officialNumber}: investigation → ${input.status ?? 'unchanged'}`,
        sourceChannel: 'web',
      },
      tx,
    );

    return updated;
  });

  if (!row) {
    return { ok: false as const, error: 'investigation_update_conflict' };
  }

  regenerateMvaReport(tenantId, incidentId, actorUserId);

  return { ok: true as const, data: row };
}

// ---------------------------------------------------------------------------
// Insurance
// ---------------------------------------------------------------------------

export async function updateInsurance(
  tenantId: string,
  incidentId: string,
  actorUserId: string,
  input: {
    insuranceClaimReference?: string | null;
    insuranceNotified?: boolean;
    policeReportFiled?: boolean;
    thirdPartyInsuranceDetails?: Record<string, unknown> | null;
  },
) {
  const db = getDb();
  const incident = await getTenantIncident(tenantId, incidentId);
  if (!incident) return { ok: false as const, error: 'Incident not found' };

  const row = await db.transaction(async (tx) => {
    const set: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (input.insuranceClaimReference !== undefined) {
      set.insuranceClaimReference = input.insuranceClaimReference || null;
    }
    if (input.insuranceNotified !== undefined) {
      set.insuranceNotified = input.insuranceNotified;
      set.insuranceNotifiedAt = input.insuranceNotified
        ? incident.insuranceNotifiedAt || new Date()
        : null;
    }
    if (input.policeReportFiled !== undefined) {
      set.policeReportFiled = input.policeReportFiled;
    }
    if (input.thirdPartyInsuranceDetails !== undefined) {
      set.thirdPartyInsuranceDetails = input.thirdPartyInsuranceDetails;
    }

    const [updated] = await tx
      .update(tripIncidents)
      .set(set)
      .where(
        and(
          eq(tripIncidents.id, incidentId),
          eq(tripIncidents.tenantId, tenantId),
        ),
      )
      .returning();

    await recordAuditEvent(
      {
        tenantId,
        actorUserId,
        eventType: 'incident_insurance_updated',
        action: 'update',
        entityType: 'trip_incident',
        entityId: incidentId,
        summary: `${incident.officialNumber}: insurance workflow updated`,
        sourceChannel: 'web',
      },
      tx,
    );

    return updated;
  });

  regenerateMvaReport(tenantId, incidentId, actorUserId);

  return { ok: true as const, data: row };
}

// ---------------------------------------------------------------------------
// Complete incident details
// ---------------------------------------------------------------------------

/**
 * Mark an incident's details as complete after verifying all mandatory
 * fields are filled. Only allowed when `detailsRequired` is true.
 */
export async function completeIncidentDetails(
  tenantId: string,
  incidentId: string,
  actorUserId: string,
) {
  const db = getDb();
  const incident = await getTenantIncident(tenantId, incidentId);
  if (!incident) return { ok: false as const, error: 'not_found' };
  if (!incident.detailsRequired) {
    return {
      ok: false as const,
      error: 'Incident details are already complete',
    };
  }

  // Validate mandatory fields are present
  if (!incident.description?.trim()) {
    return { ok: false as const, error: 'Description is required' };
  }
  if (!incident.incidentType) {
    return { ok: false as const, error: 'Incident type is required' };
  }

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(tripIncidents)
      .set({
        detailsRequired: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tripIncidents.id, incidentId),
          eq(tripIncidents.tenantId, tenantId),
        ),
      )
      .returning();

    await recordAuditEvent(
      {
        tenantId,
        actorUserId,
        eventType: 'incident_details_completed',
        action: 'complete',
        entityType: 'trip_incident',
        entityId: incidentId,
        summary: `${incident.officialNumber}: incident details completed`,
        sourceChannel: 'web',
      },
      tx,
    );

    return updated;
  });

  regenerateMvaReport(tenantId, incidentId, actorUserId);

  return { ok: true as const, data: row };
}

// ---------------------------------------------------------------------------
// Technical clearance
// ---------------------------------------------------------------------------

export async function recordTechnicalClearance(
  tenantId: string,
  incidentId: string,
  actorUserId: string,
  input: {
    status: 'cleared' | 'not_cleared';
  },
) {
  const db = getDb();
  const incident = await getTenantIncident(tenantId, incidentId);
  if (!incident) return { ok: false as const, error: 'not_found' };

  const status = input.status;
  if (incident.technicalClearanceStatus === 'cleared') {
    if (status === 'cleared') {
      return { ok: true as const, data: incident, idempotent: true as const };
    }
    return { ok: false as const, error: 'clearance_already_granted' };
  }

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(tripIncidents)
      .set({
        technicalClearanceStatus: status,
        technicalClearanceAt: new Date(),
        technicalClearanceByUserId: actorUserId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tripIncidents.id, incidentId),
          eq(tripIncidents.tenantId, tenantId),
          sql`${tripIncidents.technicalClearanceStatus} <> 'cleared'`,
        ),
      )
      .returning();

    // If another reviewer granted clearance first, leave the original decision
    // untouched and do not emit a duplicate audit event.
    if (!updated) return null;

    await recordAuditEvent(
      {
        tenantId,
        actorUserId,
        eventType: 'incident_technical_clearance',
        action: 'update',
        entityType: 'trip_incident',
        entityId: incidentId,
        summary: `${incident.officialNumber}: technical clearance → ${status}`,
        sourceChannel: 'web',
      },
      tx,
    );

    return updated;
  });

  if (!row) {
    const current = await getTenantIncident(tenantId, incidentId);
    if (current?.technicalClearanceStatus === 'cleared' && status === 'cleared') {
      return { ok: true as const, data: current, idempotent: true as const };
    }
    return { ok: false as const, error: 'technical_clearance_conflict' };
  }

  regenerateMvaReport(tenantId, incidentId, actorUserId);

  return { ok: true as const, data: row, idempotent: false as const };
}

// ---------------------------------------------------------------------------
// MVA report generation
// ---------------------------------------------------------------------------

/** Generate and issue the MVAR. Returns the generated document. */
export async function generateMvaReport(
  tenantId: string,
  incidentId: string,
  actorUserId: string,
) {
  const incident = await getTenantIncident(tenantId, incidentId);
  if (!incident) return { ok: false as const, error: 'not_found' };

  const doc = await generateDocument({
    documentType: 'accident_report',
    entityType: 'trip_incident',
    entityId: incidentId,
    tenantId,
    generatedByUserId: actorUserId,
  });

  if (!doc) {
    return { ok: false as const, error: 'generation_failed' };
  }

  return { ok: true as const, document: doc };
}
