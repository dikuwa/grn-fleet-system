import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { externalParties } from '@/db/schema/external-parties';
import { departments, employees } from '@/db/schema/people';
import {
  externalRequestDrivers,
  requestActivities,
  requestAttachments,
  requestDrivers,
  requestGoodsEquipment,
  requestPassengers,
  requestRoutes,
  transportRequests,
} from '@/db/schema/requests';
import { workflowActions, workflowInstances } from '@/db/schema/workflows';
import { hasSchema, validateDocumentSnapshot } from '@/lib/document-validation';
import { resolveRequestIdentity } from '@/lib/request-identity';
import { resolveTenantDocumentBranding } from '@/lib/tenant-branding';

/**
 * Canonical transport-request snapshot builder for both internal and external
 * requesters. It preserves the existing snapshot contract while adding an
 * explicit requesterType/routingContact boundary for external requests.
 */
export async function buildIdentityAwareTransportRequestSnapshot(
  requestId: string,
  tenantId?: string,
): Promise<Record<string, unknown> | null> {
  const db = getDb();
  const conditions = [eq(transportRequests.id, requestId)];
  if (tenantId) conditions.push(eq(transportRequests.tenantId, tenantId));

  const [req] = await db
    .select()
    .from(transportRequests)
    .where(and(...conditions))
    .limit(1);
  if (!req) return null;

  const identity = await resolveRequestIdentity(requestId, req.tenantId);
  if (!identity) return null;

  const [activities, internalDrivers, externalDrivers, passengers, routes, attachments, goodsAndEquipment, approvals] =
    await Promise.all([
      db.select().from(requestActivities).where(eq(requestActivities.requestId, requestId)),
      db
        .select({
          driverType: requestDrivers.driverType,
          sortOrder: requestDrivers.sortOrder,
          name: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.lastName})`,
          employeeNumber: employees.employeeNumber,
          department: departments.name,
          isConfirmed: requestDrivers.isConfirmed,
          licenceValidated: requestDrivers.licenceValidated,
        })
        .from(requestDrivers)
        .innerJoin(employees, eq(employees.id, requestDrivers.employeeId))
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .where(eq(requestDrivers.requestId, requestId)),
      db
        .select({
          driverType: externalRequestDrivers.driverType,
          sortOrder: externalRequestDrivers.sortOrder,
          name: sql<string>`concat_ws(' ', ${externalParties.firstName}, ${externalParties.lastName})`,
          organisation: externalParties.organisationName,
          isConfirmed: externalRequestDrivers.isConfirmed,
          licenceValidated: externalRequestDrivers.licenceValidated,
        })
        .from(externalRequestDrivers)
        .innerJoin(externalParties, eq(externalParties.id, externalRequestDrivers.externalPartyId))
        .where(
          and(
            eq(externalRequestDrivers.requestId, requestId),
            eq(externalParties.tenantId, req.tenantId),
          ),
        ),
      db
        .select({
          employeeId: requestPassengers.employeeId,
          externalName: requestPassengers.externalName,
          externalOrganisation: requestPassengers.externalOrganisation,
          travellerRole: requestPassengers.travellerRole,
          reasonForTravel: requestPassengers.reasonForTravel,
          employeeName: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.lastName})`,
          employeeNumber: employees.employeeNumber,
          department: departments.name,
        })
        .from(requestPassengers)
        .leftJoin(employees, eq(employees.id, requestPassengers.employeeId))
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .where(eq(requestPassengers.requestId, requestId)),
      db.select().from(requestRoutes).where(eq(requestRoutes.requestId, requestId)),
      db
        .select({ fileName: requestAttachments.fileName, mimeType: requestAttachments.mimeType })
        .from(requestAttachments)
        .where(eq(requestAttachments.requestId, requestId)),
      db
        .select({
          description: requestGoodsEquipment.description,
          quantity: requestGoodsEquipment.quantity,
          purpose: requestGoodsEquipment.purpose,
        })
        .from(requestGoodsEquipment)
        .where(eq(requestGoodsEquipment.requestId, requestId))
        .orderBy(requestGoodsEquipment.sortOrder),
      db
        .select({
          stage: workflowActions.stepOrder,
          action: workflowActions.actionType,
          decision: workflowActions.result,
          officer: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.lastName})`,
          comment: workflowActions.comment,
          dateTime: workflowActions.createdAt,
          signed: sql<boolean>`${workflowActions.signatureRef} is not null`,
        })
        .from(workflowActions)
        .innerJoin(workflowInstances, eq(workflowInstances.id, workflowActions.instanceId))
        .leftJoin(employees, eq(employees.id, workflowActions.actorEmployeeId))
        .where(eq(workflowInstances.requestId, requestId)),
    ]);

  const drivers = [
    ...internalDrivers.map((driver) => ({ ...driver, external: false })),
    ...externalDrivers.map((driver) => ({
      driverType: driver.driverType,
      sortOrder: driver.sortOrder,
      name: driver.name,
      employeeNumber: null,
      department: driver.organisation,
      organisation: driver.organisation,
      isConfirmed: driver.isConfirmed,
      licenceValidated: driver.licenceValidated,
      external: true,
    })),
  ].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));

  return {
    id: req.id,
    reference: req.reference,
    revision: req.revision,
    scope: req.scope,
    status: req.status,
    department: req.department,
    purpose: req.purpose,
    requesterType: identity.requesterType,
    requester: {
      name: identity.requester.name,
      employeeNumber: identity.requester.employeeNumber,
      designation: identity.requester.designation,
      department: identity.requester.department || req.department,
      office: identity.requester.office,
      organisation: identity.requester.organisation,
      phone: identity.requester.phone,
      email: identity.requester.email,
    },
    routingContact: identity.routingContact,
    totalAuthorisedKilometres: req.totalAuthorisedKilometres,
    specialAuthorityRequired: req.specialAuthorityRequired,
    submittedAt: req.submittedAt?.toISOString(),
    activities: activities.map((activity) => ({
      title: activity.title,
      description: activity.description,
      venue: activity.venue,
      startDate: activity.startDate.toISOString(),
      endDate: activity.endDate.toISOString(),
      estimatedKilometres: activity.estimatedKilometres,
    })),
    passengers: passengers.map((passenger) => ({
      name: passenger.employeeId ? passenger.employeeName : passenger.externalName,
      employeeNumber: passenger.employeeNumber,
      departmentOrOrganisation: passenger.employeeId
        ? passenger.department
        : passenger.externalOrganisation,
      role: passenger.travellerRole,
      travellerType: passenger.employeeId ? 'Employee' : 'External traveller',
      reasonForTravel: passenger.reasonForTravel,
    })),
    travellerCount:
      identity.requesterType === 'internal' ? passengers.length + 1 : passengers.length,
    drivers,
    routes: routes.map((route) => ({
      origin: route.originName,
      destination: route.destinationName,
      estimatedKilometres: route.totalKilometres || route.mappedDistanceKm,
      estimatedDurationMinutes: route.mappedDurationMinutes,
    })),
    attachments,
    goodsAndEquipment,
    approvalWorkflow: approvals.map((approval) => ({
      stage: approval.stage,
      action: approval.action,
      officer: approval.officer || 'Officer not recorded',
      decision: approval.decision,
      dateTime: approval.dateTime.toISOString(),
      comment: approval.comment,
      signature: approval.signed ? 'Digitally signed' : 'No signature applied',
    })),
  };
}

/**
 * Persist an identity-aware Transport Request document using the same version,
 * branding, hashing and validation conventions as the existing generator.
 */
export async function generateIdentityAwareTransportRequestDocument(input: {
  requestId: string;
  tenantId: string;
  generatedByUserId: string;
  templateVersion?: string;
}) {
  const sourceSnapshot = await buildIdentityAwareTransportRequestSnapshot(
    input.requestId,
    input.tenantId,
  );
  if (!sourceSnapshot) return null;

  const branding = await resolveTenantDocumentBranding(input.tenantId);
  const snapshotData = {
    ...sourceSnapshot,
    documentIdentity: {
      organisationName: branding?.organisationName,
      logoUrl: branding?.logoUrl,
      primaryColor: branding?.primaryColor,
      accentColor: branding?.accentColor,
      executiveSignatoryName: branding?.executiveSignatoryName,
      executiveSignatoryTitle: branding?.executiveSignatoryTitle || 'Chief Executive Officer',
      executiveSignatureUrl: branding?.executiveSignatureUrl,
      snapshottedAt: new Date().toISOString(),
    },
  };

  if (hasSchema('transport_request')) {
    const validation = validateDocumentSnapshot('transport_request', snapshotData);
    if (!validation.valid) {
      console.warn(
        `[DocGen] Identity-aware transport request validation failed:${input.requestId}`,
        validation.errors,
      );
    }
  }

  const db = getDb();
  const [existing] = await db
    .select()
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.tenantId, input.tenantId),
        eq(generatedDocuments.entityType, 'transport_request'),
        eq(generatedDocuments.entityId, input.requestId),
        eq(generatedDocuments.documentType, 'transport_request'),
      ),
    )
    .orderBy(desc(generatedDocuments.documentVersion))
    .limit(1);

  const newVersion = existing ? existing.documentVersion + 1 : 1;
  if (existing?.status === 'issued') {
    await db
      .update(generatedDocuments)
      .set({ status: 'superseded', updatedAt: new Date() })
      .where(
        and(
          eq(generatedDocuments.id, existing.id),
          eq(generatedDocuments.tenantId, input.tenantId),
        ),
      );
  }

  const hash = createHash('sha256').update(JSON.stringify(snapshotData)).digest('hex');
  const [document] = await db
    .insert(generatedDocuments)
    .values({
      tenantId: input.tenantId,
      documentType: 'transport_request',
      documentVersion: newVersion,
      templateVersion: input.templateVersion,
      entityType: 'transport_request',
      entityId: input.requestId,
      snapshotData,
      hash,
      status: newVersion > 1 ? 'issued' : 'draft',
      generatedByUserId: input.generatedByUserId,
    })
    .returning();

  return document;
}
