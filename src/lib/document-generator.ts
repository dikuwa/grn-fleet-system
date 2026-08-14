import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalParties } from '@/db/schema/external-parties';
import { departments, employees } from '@/db/schema/people';
import { vehicleAllocations } from '@/db/schema/trips';
import { validateDocumentSnapshot } from '@/lib/document-validation';
import * as core from '@/lib/document-generator-core';

export type { DocumentType } from '@/lib/document-generator-core';
export const generateDocument = core.generateDocument;
export const onRequestSubmitted = core.onRequestSubmitted;
export const onTripClosed = core.onTripClosed;
export const onInspectionCompleted = core.onInspectionCompleted;

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

async function resolveAuthorityDriver(
  allocationId: string,
  tenantId: string,
): Promise<AuthorityDriverSnapshot> {
  const db = getDb();
  const [allocation] = await db
    .select({ driverEmployeeId: vehicleAllocations.driverEmployeeId })
    .from(vehicleAllocations)
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
    .innerJoin(externalParties, eq(externalParties.id, externalDriverAssignments.externalPartyId))
    .where(
      and(
        eq(externalDriverAssignments.tenantId, tenantId),
        eq(externalDriverAssignments.allocationId, allocationId),
        eq(externalParties.tenantId, tenantId),
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

/**
 * Issue/regenerate a Trip Authority and enrich its immutable snapshot with the
 * operational driver identity. External drivers remain external identities;
 * no employee foreign key is fabricated for document rendering.
 */
export async function onTripIssued(allocationId: string, tenantId: string, userId: string) {
  const document = await core.onTripIssued(allocationId, tenantId, userId);
  if (!document) return document;

  const db = getDb();
  const driver = await resolveAuthorityDriver(allocationId, tenantId);
  const snapshotData = {
    ...((document.snapshotData || {}) as Record<string, unknown>),
    driver,
  };

  const validation = validateDocumentSnapshot('trip_authority', snapshotData);
  if (!validation.valid) {
    console.warn(
      `[DocGen] Driver-aware Trip Authority validation failed for allocation ${allocationId}`,
      validation.errors,
    );
  }

  const hash = createHash('sha256').update(JSON.stringify(snapshotData)).digest('hex');
  const [updated] = await db
    .update(generatedDocuments)
    .set({ snapshotData, hash, updatedAt: new Date() })
    .where(
      and(
        eq(generatedDocuments.id, document.id),
        eq(generatedDocuments.tenantId, tenantId),
      ),
    )
    .returning();

  return updated || document;
}
