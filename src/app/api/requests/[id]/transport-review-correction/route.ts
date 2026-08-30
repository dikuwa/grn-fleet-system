import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  driverLicenceCodes,
  driverLicences,
  driverProfiles,
  driverProfessionalAuthorisations,
  employees,
} from '@/db/schema/people';
import {
  requestActivities,
  requestRevisions,
  transportRequests,
} from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalDriverLicences } from '@/db/schema/external-parties';
import { tripAuthorities, trips, vehicleAllocations } from '@/db/schema/trips';
import {
  getSessionPermissions,
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { getApprovalDetail } from '@/lib/approval-detail';
import { recordAuditEvent } from '@/lib/audit-event';
import { onTripIssued } from '@/lib/document-generator';
import { calculateDriverCompliance } from '@/lib/employee-lifecycle';
import { namibiaLicenceClassCovers } from '@/lib/namibia-licence';
import { Permissions } from '@/lib/permissions';

const LIVE_ALLOCATION_STATES = ['provisional', 'confirmed'] as const;
const MAX_TEXT_LENGTH = 2_000;
const MAX_REASON_LENGTH = 500;

type ActivityInput = {
  id: string;
  title: string;
  description: string | null;
  venue: string | null;
  startDate: Date;
  endDate: Date;
  estimatedKilometres: number | null;
};

function cleanOptionalText(value: unknown, maxLength = MAX_TEXT_LENGTH) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  if (!clean) return null;
  if (clean.length > maxLength) return undefined;
  return clean;
}

function parseActivity(value: unknown): ActivityInput | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  const description = cleanOptionalText(row.description);
  const venue = cleanOptionalText(row.venue, 500);
  const startDate = typeof row.startDate === 'string' ? new Date(row.startDate) : null;
  const endDate = typeof row.endDate === 'string' ? new Date(row.endDate) : null;
  const estimatedKilometres =
    row.estimatedKilometres == null || row.estimatedKilometres === ''
      ? null
      : Number(row.estimatedKilometres);

  if (
    !id ||
    !title ||
    title.length > 500 ||
    description === undefined ||
    venue === undefined ||
    !startDate ||
    !endDate ||
    !Number.isFinite(startDate.getTime()) ||
    !Number.isFinite(endDate.getTime()) ||
    endDate <= startDate ||
    (estimatedKilometres != null &&
      (!Number.isInteger(estimatedKilometres) || estimatedKilometres < 0 || estimatedKilometres > 1_000_000))
  ) {
    return null;
  }

  return {
    id,
    title,
    description,
    venue,
    startDate,
    endDate,
    estimatedKilometres,
  };
}

function sameDate(a: Date, b: Date) {
  return a.getTime() === b.getTime();
}

function dateCoversPeriod(expiryDate: string | null | undefined, endAt: Date) {
  if (!expiryDate) return false;
  const expiry = new Date(`${expiryDate}T23:59:59.999Z`);
  return Number.isFinite(expiry.getTime()) && expiry >= endAt;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;

  const routeCheck = await requireDashboardAction(session, '/dashboard/approvals', 'update');
  if (routeCheck instanceof NextResponse) return routeCheck;
  const permissionCheck = await requirePermission(session, Permissions.REQUEST_REVIEW_TRANSPORT);
  if (permissionCheck instanceof NextResponse) return permissionCheck;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > MAX_REASON_LENGTH) {
    return NextResponse.json(
      { error: `A correction note between 1 and ${MAX_REASON_LENGTH} characters is required.` },
      { status: 422 },
    );
  }

  const purpose = cleanOptionalText(body.purpose);
  const specialRequirements = cleanOptionalText(body.specialRequirements);
  if (purpose === undefined || specialRequirements === undefined) {
    return NextResponse.json({ error: 'Request detail text is invalid or too long.' }, { status: 422 });
  }

  const rawVehicleRequirements = body.vehicleRequirements;
  if (
    rawVehicleRequirements != null &&
    (typeof rawVehicleRequirements !== 'object' || Array.isArray(rawVehicleRequirements))
  ) {
    return NextResponse.json({ error: 'vehicleRequirements must be an object.' }, { status: 422 });
  }
  const vehicleRequirements =
    rawVehicleRequirements == null ? {} : (rawVehicleRequirements as Record<string, unknown>);

  if (!Array.isArray(body.activities)) {
    return NextResponse.json({ error: 'Activities are required.' }, { status: 422 });
  }
  const parsedActivities = body.activities.map(parseActivity);
  if (parsedActivities.some((activity) => !activity)) {
    return NextResponse.json({ error: 'One or more activity entries are invalid.' }, { status: 422 });
  }
  const activities = parsedActivities as ActivityInput[];

  const db = getDb();
  const [requestContext] = await db
    .select({
      id: transportRequests.id,
      reference: transportRequests.reference,
      workflowInstanceId: transportRequests.workflowInstanceId,
      status: transportRequests.status,
      purpose: transportRequests.purpose,
      specialRequirements: transportRequests.specialRequirements,
      vehicleRequirements: transportRequests.vehicleRequirements,
      requestOrigin: transportRequests.requestOrigin,
      revision: transportRequests.revision,
      version: transportRequests.version,
    })
    .from(transportRequests)
    .where(and(eq(transportRequests.id, id), eq(transportRequests.tenantId, session.tenantId)))
    .limit(1);

  if (!requestContext?.workflowInstanceId) {
    return NextResponse.json({ error: 'Active workflow not found for this request.' }, { status: 404 });
  }

  const permissionCodes = await getSessionPermissions(session);
  const detail = await getApprovalDetail({
    instanceId: requestContext.workflowInstanceId,
    tenantId: session.tenantId,
    userId: session.user.id,
    permissionCodes,
  });
  if (
    !detail ||
    !detail.canAct ||
    detail.instance.status !== 'active' ||
    detail.currentStep?.actionType !== 'transport_review'
  ) {
    return NextResponse.json(
      { error: 'Request corrections are only available to the current Transport Review actor.' },
      { status: 403 },
    );
  }

  const existingActivities = await db
    .select()
    .from(requestActivities)
    .where(eq(requestActivities.requestId, id));

  if (activities.length !== existingActivities.length) {
    return NextResponse.json(
      { error: 'Transport Review may correct existing activities but cannot add or remove them.' },
      { status: 422 },
    );
  }
  const existingActivityMap = new Map(existingActivities.map((activity) => [activity.id, activity]));
  if (activities.some((activity) => !existingActivityMap.has(activity.id))) {
    return NextResponse.json(
      { error: 'Activity identifiers do not match the submitted request.' },
      { status: 422 },
    );
  }

  const activityChanged = activities.some((activity) => {
    const existing = existingActivityMap.get(activity.id)!;
    return (
      activity.title !== existing.title ||
      activity.description !== existing.description ||
      activity.venue !== existing.venue ||
      !sameDate(activity.startDate, existing.startDate) ||
      !sameDate(activity.endDate, existing.endDate) ||
      activity.estimatedKilometres !== existing.estimatedKilometres
    );
  });
  const scheduleChanged = activities.some((activity) => {
    const existing = existingActivityMap.get(activity.id)!;
    return !sameDate(activity.startDate, existing.startDate) || !sameDate(activity.endDate, existing.endDate);
  });
  const detailsChanged =
    purpose !== requestContext.purpose ||
    specialRequirements !== requestContext.specialRequirements ||
    JSON.stringify(vehicleRequirements) !== JSON.stringify(requestContext.vehicleRequirements ?? {});

  if (!activityChanged && !detailsChanged) {
    return NextResponse.json({ success: true, changed: false, revision: requestContext.revision });
  }

  const nextStart = activities.length
    ? activities.reduce(
        (min, activity) => (activity.startDate < min ? activity.startDate : min),
        activities[0].startDate,
      )
    : null;
  const nextEnd = activities.length
    ? activities.reduce(
        (max, activity) => (activity.endDate > max ? activity.endDate : max),
        activities[0].endDate,
      )
    : null;

  try {
    const result = await db.transaction(async (tx) => {
      const [currentRequest] = await tx
        .select({
          revision: transportRequests.revision,
          version: transportRequests.version,
          requestOrigin: transportRequests.requestOrigin,
        })
        .from(transportRequests)
        .where(and(eq(transportRequests.id, id), eq(transportRequests.tenantId, session.tenantId)))
        .limit(1);
      if (!currentRequest || currentRequest.version !== requestContext.version) {
        throw new TransportReviewCorrectionError(
          'This request changed while you were reviewing it. Refresh and try again.',
          409,
        );
      }
      if (currentRequest.requestOrigin !== requestContext.requestOrigin) {
        throw new TransportReviewCorrectionError('The governed request origin changed unexpectedly.', 409);
      }

      const [allocation] = await tx
        .select({
          id: vehicleAllocations.id,
          state: vehicleAllocations.state,
          version: vehicleAllocations.version,
          vehicleId: vehicleAllocations.vehicleId,
          driverEmployeeId: vehicleAllocations.driverEmployeeId,
          startAt: vehicleAllocations.startAt,
          endAt: vehicleAllocations.endAt,
          requiredLicenceClass: vehicles.requiredLicenceClass,
          professionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
        })
        .from(vehicleAllocations)
        .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
        .where(and(eq(vehicleAllocations.requestId, id), eq(vehicles.tenantId, session.tenantId)))
        .orderBy(desc(vehicleAllocations.updatedAt))
        .limit(1);

      if (
        allocation &&
        !LIVE_ALLOCATION_STATES.includes(allocation.state as (typeof LIVE_ALLOCATION_STATES)[number])
      ) {
        throw new TransportReviewCorrectionError(
          `Schedule corrections are not allowed from '${allocation.state}' allocation state.`,
          409,
        );
      }

      if (allocation) {
        const [trip, authority, acceptedExternalAssignment] = await Promise.all([
          tx
            .select({
              id: trips.id,
              status: trips.status,
              issuedAt: trips.issuedAt,
              driverAcknowledgedAt: trips.driverAcknowledgedAt,
            })
            .from(trips)
            .where(and(eq(trips.allocationId, allocation.id), eq(trips.tenantId, session.tenantId)))
            .limit(1)
            .then((rows) => rows[0] ?? null),
          tx
            .select({
              id: tripAuthorities.id,
              status: tripAuthorities.status,
              issuedAt: tripAuthorities.issuedAt,
              authorisedAt: tripAuthorities.authorisedAt,
              acceptedAt: tripAuthorities.acceptedAt,
            })
            .from(tripAuthorities)
            .where(
              and(
                eq(tripAuthorities.allocationId, allocation.id),
                eq(tripAuthorities.tenantId, session.tenantId),
              ),
            )
            .limit(1)
            .then((rows) => rows[0] ?? null),
          tx
            .select({
              id: externalDriverAssignments.id,
              state: externalDriverAssignments.state,
              acceptedAt: externalDriverAssignments.acceptedAt,
            })
            .from(externalDriverAssignments)
            .where(
              and(
                eq(externalDriverAssignments.allocationId, allocation.id),
                eq(externalDriverAssignments.tenantId, session.tenantId),
                eq(externalDriverAssignments.state, 'accepted'),
              ),
            )
            .orderBy(desc(externalDriverAssignments.updatedAt))
            .limit(1)
            .then((rows) => rows[0] ?? null),
        ]);
        const tripLocked = Boolean(
          trip &&
            (trip.status !== 'pending' || trip.issuedAt || trip.driverAcknowledgedAt),
        );
        const authorityLocked = Boolean(
          authority &&
            (authority.status !== 'draft' ||
              authority.issuedAt ||
              authority.authorisedAt ||
              authority.acceptedAt),
        );
        const externalAcceptanceLocked = Boolean(
          acceptedExternalAssignment?.state === 'accepted' && acceptedExternalAssignment.acceptedAt,
        );
        if (tripLocked || authorityLocked || externalAcceptanceLocked) {
          throw new TransportReviewCorrectionError(
            'Request details are locked after driver acknowledgement or external driver acceptance, authority authorisation, physical issue, or trip departure.',
            409,
          );
        }
      }

      if (scheduleChanged && allocation && nextStart && nextEnd) {
        const [vehicleConflict] = await tx
          .select({ id: vehicleAllocations.id })
          .from(vehicleAllocations)
          .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
          .where(
            and(
              eq(transportRequests.tenantId, session.tenantId),
              eq(vehicleAllocations.vehicleId, allocation.vehicleId),
              ne(vehicleAllocations.id, allocation.id),
              inArray(vehicleAllocations.state, [...LIVE_ALLOCATION_STATES]),
              lt(vehicleAllocations.startAt, nextEnd),
              gt(vehicleAllocations.endAt, nextStart),
            ),
          )
          .limit(1);
        if (vehicleConflict) {
          throw new TransportReviewCorrectionError(
            'The assigned vehicle is already allocated during the corrected schedule.',
            409,
          );
        }

        if (allocation.driverEmployeeId) {
          const [driverConflict] = await tx
            .select({ id: vehicleAllocations.id })
            .from(vehicleAllocations)
            .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
            .where(
              and(
                eq(transportRequests.tenantId, session.tenantId),
                eq(vehicleAllocations.driverEmployeeId, allocation.driverEmployeeId),
                ne(vehicleAllocations.id, allocation.id),
                inArray(vehicleAllocations.state, [...LIVE_ALLOCATION_STATES]),
                lt(vehicleAllocations.startAt, nextEnd),
                gt(vehicleAllocations.endAt, nextStart),
              ),
            )
            .limit(1);
          if (driverConflict) {
            throw new TransportReviewCorrectionError(
              'The assigned driver is already allocated during the corrected schedule.',
              409,
            );
          }

          const [driver] = await tx
            .select({
              employeeStatus: employees.employmentStatus,
              employeeAvailability: employees.availabilityStatus,
              profileId: driverProfiles.id,
              driverStatus: driverProfiles.driverStatus,
              profileAvailability: driverProfiles.availabilityStatus,
              licenceId: driverLicences.id,
              licenceStatus: driverLicences.verificationStatus,
              licenceExpiry: driverLicences.expiryDate,
              licenceClass: driverLicences.licenceClass,
            })
            .from(employees)
            .innerJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
            .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
            .where(
              and(
                eq(employees.id, allocation.driverEmployeeId),
                eq(employees.tenantId, session.tenantId),
                eq(driverLicences.isActive, true),
              ),
            )
            .orderBy(desc(driverLicences.version))
            .limit(1);
          if (!driver) {
            throw new TransportReviewCorrectionError(
              'The assigned driver no longer has an active licence profile.',
              409,
            );
          }
          const [codes, professional] = await Promise.all([
            tx
              .select({ code: driverLicenceCodes.code })
              .from(driverLicenceCodes)
              .where(
                and(
                  eq(driverLicenceCodes.licenceId, driver.licenceId),
                  eq(driverLicenceCodes.isActive, true),
                ),
              ),
            tx
              .select()
              .from(driverProfessionalAuthorisations)
              .where(eq(driverProfessionalAuthorisations.driverProfileId, driver.profileId))
              .orderBy(desc(driverProfessionalAuthorisations.expiryDate))
              .limit(1),
          ]);
          const compliance = calculateDriverCompliance({
            employeeStatus: driver.employeeStatus,
            availabilityStatus:
              driver.employeeAvailability !== 'available'
                ? driver.employeeAvailability
                : driver.profileAvailability,
            driverStatus: driver.driverStatus,
            licenceStatus: driver.licenceStatus,
            licenceExpiry: driver.licenceExpiry,
            licenceCodes: Array.from(
              new Set([
                ...codes.map((row) => row.code),
                ...String(driver.licenceClass || '')
                  .split(',')
                  .map((code) => code.trim())
                  .filter(Boolean),
              ]),
            ),
            requiredLicenceClass: allocation.requiredLicenceClass || undefined,
            professionalRequired: allocation.professionalAuthorisationRequired,
            professionalVerified: professional[0]?.isVerified,
            professionalExpiry: professional[0]?.expiryDate ?? null,
            tripEndAt: nextEnd,
            hasScheduleConflict: false,
          });
          if (!['eligible', 'eligible_expiring_soon'].includes(compliance.status)) {
            throw new TransportReviewCorrectionError(
              `The assigned driver is not eligible for the corrected schedule: ${compliance.reasons.join(' · ')}`,
              409,
            );
          }
        } else {
          const [externalAssignment] = await tx
            .select({
              id: externalDriverAssignments.id,
              externalPartyId: externalDriverAssignments.externalPartyId,
              licenceClass: externalDriverLicences.licenceClass,
              licenceExpiry: externalDriverLicences.expiryDate,
              licenceVerificationStatus: externalDriverLicences.verificationStatus,
            })
            .from(externalDriverAssignments)
            .innerJoin(
              externalDriverLicences,
              eq(externalDriverLicences.id, externalDriverAssignments.licenceId),
            )
            .where(
              and(
                eq(externalDriverAssignments.allocationId, allocation.id),
                eq(externalDriverAssignments.tenantId, session.tenantId),
                eq(externalDriverLicences.tenantId, session.tenantId),
                inArray(externalDriverAssignments.state, ['pending_acceptance', 'accepted']),
              ),
            )
            .orderBy(desc(externalDriverAssignments.updatedAt))
            .limit(1);

          if (externalAssignment) {
            if (
              externalAssignment.licenceVerificationStatus !== 'verified' ||
              !dateCoversPeriod(externalAssignment.licenceExpiry, nextEnd) ||
              (allocation.requiredLicenceClass &&
                !namibiaLicenceClassCovers(
                  externalAssignment.licenceClass,
                  allocation.requiredLicenceClass,
                )) ||
              allocation.professionalAuthorisationRequired
            ) {
              throw new TransportReviewCorrectionError(
                'The assigned external driver is not eligible for the corrected schedule.',
                409,
              );
            }

            const [externalConflict] = await tx
              .select({ id: externalDriverAssignments.id })
              .from(externalDriverAssignments)
              .innerJoin(
                vehicleAllocations,
                eq(externalDriverAssignments.allocationId, vehicleAllocations.id),
              )
              .where(
                and(
                  eq(externalDriverAssignments.tenantId, session.tenantId),
                  eq(externalDriverAssignments.externalPartyId, externalAssignment.externalPartyId),
                  ne(externalDriverAssignments.allocationId, allocation.id),
                  inArray(externalDriverAssignments.state, ['pending_acceptance', 'accepted']),
                  inArray(vehicleAllocations.state, [...LIVE_ALLOCATION_STATES]),
                  lt(vehicleAllocations.startAt, nextEnd),
                  gt(vehicleAllocations.endAt, nextStart),
                ),
              )
              .limit(1);
            if (externalConflict) {
              throw new TransportReviewCorrectionError(
                'The assigned external driver is already committed during the corrected schedule.',
                409,
              );
            }
          }
        }
      }

      const now = new Date();
      const nextRevision = currentRequest.revision + 1;
      const [updatedRequest] = await tx
        .update(transportRequests)
        .set({
          purpose,
          specialRequirements,
          vehicleRequirements,
          revision: nextRevision,
          version: currentRequest.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(transportRequests.id, id),
            eq(transportRequests.tenantId, session.tenantId),
            eq(transportRequests.version, currentRequest.version),
          ),
        )
        .returning({ revision: transportRequests.revision, version: transportRequests.version });
      if (!updatedRequest) {
        throw new TransportReviewCorrectionError(
          'This request changed while you were reviewing it. Refresh and try again.',
          409,
        );
      }

      for (const activity of activities) {
        await tx
          .update(requestActivities)
          .set({
            title: activity.title,
            description: activity.description,
            venue: activity.venue,
            startDate: activity.startDate,
            endDate: activity.endDate,
            estimatedKilometres: activity.estimatedKilometres,
          })
          .where(and(eq(requestActivities.id, activity.id), eq(requestActivities.requestId, id)));
      }

      if (scheduleChanged && allocation && nextStart && nextEnd) {
        const [updatedAllocation] = await tx
          .update(vehicleAllocations)
          .set({
            startAt: nextStart,
            endAt: nextEnd,
            version: allocation.version + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(vehicleAllocations.id, allocation.id),
              eq(vehicleAllocations.version, allocation.version),
              inArray(vehicleAllocations.state, [...LIVE_ALLOCATION_STATES]),
            ),
          )
          .returning({ id: vehicleAllocations.id });
        if (!updatedAllocation) {
          throw new TransportReviewCorrectionError(
            'The allocation changed while you were correcting the schedule. Refresh and try again.',
            409,
          );
        }
      }

      const beforeActivities = existingActivities.map((activity) => ({
        id: activity.id,
        title: activity.title,
        description: activity.description,
        venue: activity.venue,
        startDate: activity.startDate.toISOString(),
        endDate: activity.endDate.toISOString(),
        estimatedKilometres: activity.estimatedKilometres,
      }));
      const afterActivities = activities.map((activity) => ({
        ...activity,
        startDate: activity.startDate.toISOString(),
        endDate: activity.endDate.toISOString(),
      }));

      await tx.insert(requestRevisions).values({
        requestId: id,
        revision: nextRevision,
        changedFields: {
          purpose: { before: requestContext.purpose, after: purpose },
          specialRequirements: {
            before: requestContext.specialRequirements,
            after: specialRequirements,
          },
          vehicleRequirements: {
            before: requestContext.vehicleRequirements ?? {},
            after: vehicleRequirements,
          },
          activities: { before: beforeActivities, after: afterActivities },
          scheduleChanged,
        },
        reason,
        createdByUserId: session.user.id,
        data: {
          source: 'transport_review',
          requestOrigin: requestContext.requestOrigin,
          scheduleChanged,
          purpose,
          specialRequirements,
          vehicleRequirements,
          activities: afterActivities,
        },
      });

      return {
        revision: updatedRequest.revision,
        version: updatedRequest.version,
        scheduleChanged,
        allocationId: allocation?.id ?? null,
      };
    });

    if (result.allocationId) {
      try {
        await onTripIssued(result.allocationId, session.tenantId, session.user.id);
      } catch (documentError) {
        console.warn(
          '[transport-review-correction] Could not refresh draft Trip Authority after correction:',
          documentError,
        );
      }
    }

    try {
      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.user.id,
        action: 'request.transport_review_corrected',
        entityType: 'transport_request',
        entityId: id,
        sourceChannel: 'dashboard',
        before: {
          purpose: requestContext.purpose,
          specialRequirements: requestContext.specialRequirements,
          vehicleRequirements: requestContext.vehicleRequirements ?? {},
          activities: existingActivities.map((activity) => ({
            id: activity.id,
            title: activity.title,
            description: activity.description,
            venue: activity.venue,
            startDate: activity.startDate.toISOString(),
            endDate: activity.endDate.toISOString(),
            estimatedKilometres: activity.estimatedKilometres,
          })),
        },
        after: {
          purpose,
          specialRequirements,
          vehicleRequirements,
          activities: activities.map((activity) => ({
            ...activity,
            startDate: activity.startDate.toISOString(),
            endDate: activity.endDate.toISOString(),
          })),
          note: reason,
        },
        summary: `${requestContext.reference} corrected during Transport Review`,
      });
    } catch (auditError) {
      console.warn('[transport-review-correction] Post-commit audit write failed:', auditError);
    }

    return NextResponse.json({
      success: true,
      changed: true,
      revision: result.revision,
      version: result.version,
      scheduleChanged: result.scheduleChanged,
    });
  } catch (error) {
    if (error instanceof TransportReviewCorrectionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[transport-review-correction] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to save Transport Review corrections.' }, { status: 500 });
  }
}

class TransportReviewCorrectionError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
    this.name = 'TransportReviewCorrectionError';
  }
}
