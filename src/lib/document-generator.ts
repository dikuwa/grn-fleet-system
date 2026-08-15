import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalParties } from '@/db/schema/external-parties';
import { vehicles } from '@/db/schema/fleet';
import { departments, employees } from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import { tripIncidents, trips, vehicleAllocations, vehicleInspections } from '@/db/schema/trips';
import { validateDocumentSnapshot } from '@/lib/document-validation';
import { buildInspectionReportRenderSnapshot } from '@/lib/pdf/verified-inspection-report';
import { buildTripAuthorityRenderSnapshot } from '@/lib/pdf/verified-trip-authority';
import * as core from '@/lib/document-generator-core';

export type { DocumentType } from '@/lib/document-generator-core';

type GenerateDocumentPayload = Parameters<typeof core.generateDocument>[0];

interface AuthorityDriverSnapshot {
  kind: 'internal' | 'external' | 'unassigned';
  name: string;
  employeeNumber: string | null;
  organisation: string | null;
  licenceNumber: string | null;
  licenceClass: string | null;
  licenceExpiry: string | null;
  acceptanceStatus: string | null;
}

function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

/**
 * Fail closed before the core snapshot builder runs. Some child tables inherit
 * tenancy from their parent rather than carrying tenant_id themselves, so the
 * ownership check follows the same authoritative parent relationship used by
 * the operational workflow.
 */
async function sourceEntityBelongsToTenant(
  entityType: string,
  entityId: string,
  tenantId: string,
): Promise<boolean> {
  const db = getDb();

  switch (entityType) {
    case 'transport_request': {
      const [row] = await db
        .select({ id: transportRequests.id })
        .from(transportRequests)
        .where(and(eq(transportRequests.id, entityId), eq(transportRequests.tenantId, tenantId)))
        .limit(1);
      return Boolean(row);
    }
    case 'trip': {
      const [row] = await db
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.id, entityId), eq(trips.tenantId, tenantId)))
        .limit(1);
      return Boolean(row);
    }
    case 'vehicle_allocation': {
      const [row] = await db
        .select({ id: vehicleAllocations.id })
        .from(vehicleAllocations)
        .innerJoin(
          transportRequests,
          and(
            eq(transportRequests.id, vehicleAllocations.requestId),
            eq(transportRequests.tenantId, tenantId),
          ),
        )
        .where(eq(vehicleAllocations.id, entityId))
        .limit(1);
      return Boolean(row);
    }
    case 'inspection': {
      const [row] = await db
        .select({ id: vehicleInspections.id })
        .from(vehicleInspections)
        .where(and(eq(vehicleInspections.id, entityId), eq(vehicleInspections.tenantId, tenantId)))
        .limit(1);
      return Boolean(row);
    }
    case 'trip_incident': {
      const [row] = await db
        .select({ id: tripIncidents.id })
        .from(tripIncidents)
        .where(and(eq(tripIncidents.id, entityId), eq(tripIncidents.tenantId, tenantId)))
        .limit(1);
      return Boolean(row);
    }
    // Maintenance and vehicle-history builders both use a vehicle ID as their
    // source entity, so tenant ownership is established on the vehicle record.
    case 'maintenance':
    case 'vehicle': {
      const [row] = await db
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(and(eq(vehicles.id, entityId), eq(vehicles.tenantId, tenantId)))
        .limit(1);
      return Boolean(row);
    }
    case 'tenant':
      return entityId === tenantId;
    default:
      console.warn(`[DocGen] No tenant ownership rule for source entity type: ${entityType}`);
      return false;
  }
}

async function assertDocumentSourceTenant(
  entityType: string,
  entityId: string,
  tenantId: string,
) {
  const allowed = await sourceEntityBelongsToTenant(entityType, entityId, tenantId);
  if (!allowed) {
    console.warn(
      `[DocGen] Refused cross-tenant or unknown source ${entityType}:${entityId} for tenant ${tenantId}`,
    );
  }
  return allowed;
}

/** Public generation boundary with source-record tenant validation. */
export async function generateDocument(payload: GenerateDocumentPayload) {
  if (!(await assertDocumentSourceTenant(payload.entityType, payload.entityId, payload.tenantId))) {
    return null;
  }
  return core.generateDocument(payload);
}

async function resolveAuthorityDriver(
  allocationId: string,
  tenantId: string,
): Promise<AuthorityDriverSnapshot> {
  const db = getDb();
  const [allocation] = await db
    .select({ driverEmployeeId: vehicleAllocations.driverEmployeeId })
    .from(vehicleAllocations)
    .innerJoin(
      transportRequests,
      and(
        eq(transportRequests.id, vehicleAllocations.requestId),
        eq(transportRequests.tenantId, tenantId),
      ),
    )
    .where(eq(vehicleAllocations.id, allocationId))
    .limit(1);

  if (!allocation) {
    return {
      kind: 'unassigned',
      name: 'Not recorded',
      employeeNumber: null,
      organisation: null,
      licenceNumber: null,
      licenceClass: null,
      licenceExpiry: null,
      acceptanceStatus: null,
    };
  }

  if (allocation.driverEmployeeId) {
    const [driver] = await db
      .select({
        firstName: employees.firstName,
        middleName: employees.middleName,
        lastName: employees.lastName,
        employeeNumber: employees.employeeNumber,
        department: departments.name,
      })
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(
        and(
          eq(employees.id, allocation.driverEmployeeId),
          eq(employees.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (driver) {
      return {
        kind: 'internal',
        name: [driver.firstName, driver.middleName, driver.lastName].filter(Boolean).join(' '),
        employeeNumber: driver.employeeNumber,
        organisation: driver.department,
        licenceNumber: null,
        licenceClass: null,
        licenceExpiry: null,
        acceptanceStatus: 'employee_assignment',
      };
    }
  }

  const [external] = await db
    .select({
      state: externalDriverAssignments.state,
      licenceSnapshot: externalDriverAssignments.licenceSnapshot,
      firstName: externalParties.firstName,
      lastName: externalParties.lastName,
      organisation: externalParties.organisationName,
    })
    .from(externalDriverAssignments)
    .innerJoin(
      externalParties,
      and(
        eq(externalParties.id, externalDriverAssignments.externalPartyId),
        eq(externalParties.tenantId, tenantId),
      ),
    )
    .where(
      and(
        eq(externalDriverAssignments.tenantId, tenantId),
        eq(externalDriverAssignments.allocationId, allocationId),
        inArray(externalDriverAssignments.state, ['pending_acceptance', 'accepted']),
      ),
    )
    .orderBy(desc(externalDriverAssignments.assignedAt))
    .limit(1);

  if (external) {
    const licence = (external.licenceSnapshot || {}) as Record<string, unknown>;
    return {
      kind: 'external',
      name: [external.firstName, external.lastName].filter(Boolean).join(' '),
      employeeNumber: null,
      organisation: external.organisation,
      licenceNumber: textOrNull(licence.licenceNumber),
      licenceClass: textOrNull(licence.licenceClass),
      licenceExpiry: textOrNull(licence.expiryDate),
      acceptanceStatus: external.state,
    };
  }

  return {
    kind: 'unassigned',
    name: 'Not recorded',
    employeeNumber: null,
    organisation: null,
    licenceNumber: null,
    licenceClass: null,
    licenceExpiry: null,
    acceptanceStatus: null,
  };
}

function documentSnapshotHash(
  document: Pick<typeof generatedDocuments.$inferSelect, 'documentType' | 'documentVersion'>,
  snapshotData: Record<string, unknown>,
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        documentType: document.documentType,
        version: document.documentVersion,
        snapshot: snapshotData,
      }),
    )
    .digest('hex');
}

async function persistSnapshotEnrichment(
  document: typeof generatedDocuments.$inferSelect,
  tenantId: string,
  enrichment: Record<string, unknown>,
) {
  const db = getDb();
  const snapshotData = {
    ...((document.snapshotData || {}) as Record<string, unknown>),
    ...enrichment,
  };
  const hash = documentSnapshotHash(document, snapshotData);
  const [updated] = await db
    .update(generatedDocuments)
    .set({ snapshotData, hash, updatedAt: new Date() })
    .where(
      and(
        eq(generatedDocuments.id, document.id),
        eq(generatedDocuments.tenantId, tenantId),
        eq(generatedDocuments.status, 'draft'),
      ),
    )
    .returning();
  if (updated) return updated;

  // Issuance may win the race between generation and preliminary enrichment.
  // Never mutate that issued row; return the authoritative current record so
  // callers do not continue with a stale draft object.
  const [current] = await db
    .select()
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.id, document.id),
        eq(generatedDocuments.tenantId, tenantId),
      ),
    )
    .limit(1);
  return current || document;
}

/**
 * Generate or refresh the pending Transport Request document snapshot.
 * Final visual render data and branding are rebuilt and frozen only by the
 * formal Issue action, so submission retries cannot mutate an official copy.
 */
export async function onRequestSubmitted(requestId: string, tenantId: string, userId: string) {
  if (!(await assertDocumentSourceTenant('transport_request', requestId, tenantId))) return null;
  return core.onRequestSubmitted(requestId, tenantId, userId);
}

/** Generate trip-closure documents only from a trip owned by the supplied tenant. */
export async function onTripClosed(tripId: string, tenantId: string, userId: string) {
  if (!(await assertDocumentSourceTenant('trip', tripId, tenantId))) return [];
  return core.onTripClosed(tripId, tenantId, userId);
}

/**
 * Generate/refresh a Trip Authority draft when an allocation is created. The
 * allocation lifecycle can precede provisioning of the canonical authority row,
 * so renderData here is only a preliminary preview. Formal issuance always
 * rebuilds the final render snapshot and branding before it becomes official.
 */
export async function onTripIssued(allocationId: string, tenantId: string, userId: string) {
  if (!(await assertDocumentSourceTenant('vehicle_allocation', allocationId, tenantId))) return null;
  const document = await core.onTripIssued(allocationId, tenantId, userId);
  if (!document) return document;

  const driver = await resolveAuthorityDriver(allocationId, tenantId);
  const renderData = await buildTripAuthorityRenderSnapshot(document.id, { requireAuthority: true });
  const snapshotData = {
    ...((document.snapshotData || {}) as Record<string, unknown>),
    driver,
    ...(renderData ? { renderData } : {}),
  };

  const validation = validateDocumentSnapshot('trip_authority', snapshotData);
  if (!validation.valid) {
    console.warn(
      `[DocGen] Driver-aware Trip Authority validation failed for allocation ${allocationId}`,
      validation.errors,
    );
  }

  return persistSnapshotEnrichment(document, tenantId, {
    driver,
    ...(renderData ? { renderData } : {}),
  });
}

/**
 * Refresh the pending inspection document preview after completion. This helper
 * only enriches rows that are still draft; formal issuance rebuilds and freezes
 * the complete official render payload.
 */
export async function onInspectionCompleted(
  inspectionId: string,
  tenantId: string,
  userId: string,
) {
  if (!(await assertDocumentSourceTenant('inspection', inspectionId, tenantId))) return null;
  const document = await core.onInspectionCompleted(inspectionId, tenantId, userId);
  if (!document) return document;

  const renderData = await buildInspectionReportRenderSnapshot(document.id);
  if (!renderData) {
    console.warn(`[DocGen] Could not build inspection render preview ${inspectionId}`);
    return document;
  }

  return persistSnapshotEnrichment(document, tenantId, { renderData });
}
