import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { fuelTransactions, reimbursements, trips, vehicleAllocations } from '@/db/schema/trips';
import { vehicles, vehicleOdometerEvents } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, desc, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  getSessionRoleNames,
  getSessionWorkspace,
  requireDashboardAction,
  requireRequestAuth,
  requirePermission,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { fuelScopeCondition, tripScopeCondition } from '@/lib/record-scope';
import { createScopedNotifications } from '@/lib/notification-service';
import { runAtomicMutations } from '@/lib/db-atomic';

/** GET /api/fuel — list fuel transactions within the active record scope. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const viewCheck = await requireDashboardAction(session, '/dashboard/fuel', 'view');
    if (viewCheck instanceof NextResponse) return viewCheck;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));

    const db = getDb();
    const roleNames = await getSessionRoleNames(session);
    const access = resolveDashboardAccess('/dashboard/fuel', roleNames);
    const conditions = [
      fuelScopeCondition({
        tenantId: session.tenantId,
        userId: session.user.id,
        recordScope: access.recordScope ?? 'self',
      }),
    ];

    const driverEmp = alias(employees, 'fuel_driver');
    const recorderEmp = alias(employees, 'fuel_recorder');

    const [rows, totalRows] = await Promise.all([
      db
        .select({
          id: fuelTransactions.id,
          transactionAt: fuelTransactions.transactionAt,
          stationName: fuelTransactions.stationName,
          fuelType: fuelTransactions.fuelType,
          litres: fuelTransactions.litres,
          amount: fuelTransactions.amount,
          paymentMethod: fuelTransactions.paymentMethod,
          anomalyState: fuelTransactions.anomalyState,
          isVerified: fuelTransactions.isVerified,
          vehicleId: fuelTransactions.vehicleId,
          driverEmployeeId: fuelTransactions.driverEmployeeId,
          driverName: sql<string>`concat_ws(' ', ${driverEmp.firstName}, ${driverEmp.lastName})`,
          recordedByName: sql<string>`concat_ws(' ', ${recorderEmp.firstName}, ${recorderEmp.lastName})`,
          make: vehicles.make,
          model: vehicles.model,
          licenceNumber: vehicles.licenceNumber,
        })
        .from(fuelTransactions)
        .leftJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
        .leftJoin(driverEmp, eq(fuelTransactions.driverEmployeeId, driverEmp.id))
        .leftJoin(recorderEmp, eq(fuelTransactions.recordedByUserId, recorderEmp.userId))
        .where(and(...conditions))
        .orderBy(desc(fuelTransactions.transactionAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(fuelTransactions)
        .leftJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
        .where(and(...conditions)),
    ]);

    return NextResponse.json({
      success: true,
      data: { transactions: rows, total: Number(totalRows[0]?.count ?? 0) },
    });
  } catch (error) {
    console.error('[fuel] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch fuel transactions' }, { status: 500 });
  }
}

/** POST /api/fuel — create a durable, scoped fuel transaction. */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const roleCheck = await requireDashboardAction(session, '/dashboard/fuel/new', 'create');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const managerCheck = await requirePermission(session, Permissions.FUEL_MANAGE);
    const isManager = !(managerCheck instanceof NextResponse);
    if (!isManager) {
      const driverPerm = await requirePermission(session, Permissions.DRIVER_FUEL_CREATE);
      if (driverPerm instanceof NextResponse) return driverPerm;
    }

    const body = await req.json();
    const {
      tripId,
      tripRef,
      vehicleId,
      vehicleGrn,
      transactionAt,
      stationName,
      fuelType,
      litres,
      amount,
      paymentMethod,
      odometerReading,
      referenceNumber,
      fillType,
      clientSyncId,
      driverEmployeeId,
      claimantEmployeeId,
      notes,
    } = body;

    if ((!vehicleId && !vehicleGrn) || !fuelType || !litres || !amount || !paymentMethod) {
      return NextResponse.json(
        { error: 'Missing required fields: vehicleId, fuelType, litres, amount, paymentMethod' },
        { status: 400 },
      );
    }

    const db = getDb();
    let resolvedVehicleId = vehicleId as string | undefined;
    let resolvedTripId = tripId as string | undefined;

    if (!resolvedVehicleId && vehicleGrn) {
      const [byGrn] = await db
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(
          and(
            eq(vehicles.tenantId, session.tenantId),
            eq(vehicles.licenceNumber, String(vehicleGrn)),
          ),
        )
        .limit(1);
      resolvedVehicleId = byGrn?.id;
    }

    if (!resolvedTripId && tripRef) {
      const [byReference] = await db
        .select({ id: trips.id })
        .from(trips)
        .innerJoin(transportRequests, eq(trips.requestId, transportRequests.id))
        .where(
          and(
            eq(trips.tenantId, session.tenantId),
            eq(transportRequests.reference, String(tripRef)),
          ),
        )
        .limit(1);
      resolvedTripId = byReference?.id;
    }

    const [vehicle] = await db
      .select({ id: vehicles.id, currentOdometer: vehicles.currentOdometer })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.id, resolvedVehicleId || '00000000-0000-0000-0000-000000000000'),
          eq(vehicles.tenantId, session.tenantId),
        ),
      )
      .limit(1);
    if (!vehicle) return NextResponse.json({ error: 'Vehicle not found in your tenant' }, { status: 404 });

    const litresNumber = Number(litres);
    const amountNumber = Number(amount);
    const odometerNumber =
      odometerReading === null || odometerReading === undefined || odometerReading === ''
        ? null
        : Number(odometerReading);
    const eventAt = transactionAt ? new Date(transactionAt) : new Date();

    if (!Number.isFinite(litresNumber) || litresNumber <= 0 || !Number.isFinite(amountNumber) || amountNumber <= 0) {
      return NextResponse.json({ error: 'Litres and amount must be positive numbers' }, { status: 422 });
    }
    if (Number.isNaN(eventAt.getTime()) || eventAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return NextResponse.json({ error: 'A valid fuel transaction time is required' }, { status: 422 });
    }
    if (odometerNumber !== null && (!Number.isInteger(odometerNumber) || odometerNumber < vehicle.currentOdometer)) {
      return NextResponse.json(
        { error: `Odometer cannot be lower than the current reading (${vehicle.currentOdometer})` },
        { status: 422 },
      );
    }

    const syncId = typeof clientSyncId === 'string' && clientSyncId.trim() ? clientSyncId.trim() : null;
    if (syncId) {
      const [existing] = await db
        .select()
        .from(fuelTransactions)
        .where(eq(fuelTransactions.clientSyncId, syncId))
        .limit(1);
      if (existing) {
        const [existingVehicle] = await db
          .select({ tenantId: vehicles.tenantId })
          .from(vehicles)
          .where(eq(vehicles.id, existing.vehicleId))
          .limit(1);
        if (existingVehicle?.tenantId === session.tenantId) {
          const [existingReimbursement] = await db
            .select()
            .from(reimbursements)
            .where(eq(reimbursements.transactionId, existing.id))
            .limit(1);
          return NextResponse.json({
            success: true,
            data: existing,
            reimbursement: existingReimbursement ?? null,
            idempotent: true,
          });
        }
        return NextResponse.json({ error: 'Fuel sync key is already in use' }, { status: 409 });
      }
    }

    let currentEmployeeId: string | null = null;
    if (!isManager) {
      if (!resolvedTripId) {
        return NextResponse.json(
          { error: 'Drivers must record fuel against an assigned active trip' },
          { status: 422 },
        );
      }
      const [employee] = await db
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.tenantId, session.tenantId),
            eq(employees.userId, session.user.id),
            eq(employees.employmentStatus, 'active'),
          ),
        )
        .limit(1);
      if (!employee) {
        return NextResponse.json(
          { error: 'Your login is not linked to an active employee record' },
          { status: 403 },
        );
      }
      currentEmployeeId = employee.id;

      const [assignedTrip] = await db
        .select({ id: trips.id })
        .from(trips)
        .where(
          and(
            eq(trips.id, resolvedTripId),
            eq(trips.vehicleId, resolvedVehicleId!),
            sql`${trips.status} in ('in_progress', 'return_due')`,
            tripScopeCondition({
              tenantId: session.tenantId,
              userId: session.user.id,
              recordScope: 'assigned',
            }),
          ),
        )
        .limit(1);
      if (!assignedTrip) {
        return NextResponse.json(
          { error: 'Trip is not active and assigned to this driver and vehicle' },
          { status: 404 },
        );
      }
    } else if (resolvedTripId) {
      const [tenantTrip] = await db
        .select({ id: trips.id })
        .from(trips)
        .where(
          and(
            eq(trips.id, resolvedTripId),
            eq(trips.tenantId, session.tenantId),
            eq(trips.vehicleId, resolvedVehicleId!),
          ),
        )
        .limit(1);
      if (!tenantTrip) {
        return NextResponse.json({ error: 'Trip does not match this tenant and vehicle' }, { status: 422 });
      }
    }

    let resolvedDriverId: string | null = currentEmployeeId;
    if (isManager && driverEmployeeId) {
      const [driverEmp] = await db
        .select({ id: employees.id, isDriver: employees.isDriver, employmentStatus: employees.employmentStatus })
        .from(employees)
        .where(
          and(eq(employees.id, String(driverEmployeeId)), eq(employees.tenantId, session.tenantId)),
        )
        .limit(1);
      if (!driverEmp) return NextResponse.json({ error: 'Driver not found in your tenant' }, { status: 404 });
      if (driverEmp.isDriver !== true || driverEmp.employmentStatus !== 'active') {
        return NextResponse.json({ error: 'Selected driver is not an active driver' }, { status: 422 });
      }
      resolvedDriverId = driverEmp.id;
    } else if (isManager && resolvedTripId) {
      const [tripDriver] = await db
        .select({ driverEmployeeId: vehicleAllocations.driverEmployeeId })
        .from(trips)
        .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
        .where(and(eq(trips.id, resolvedTripId), eq(trips.tenantId, session.tenantId)))
        .limit(1);
      resolvedDriverId = tripDriver?.driverEmployeeId ?? null;
    }

    let reimbursementClaimantId: string | null = null;
    if (paymentMethod === 'personal_reimbursement') {
      if (!isManager) {
        reimbursementClaimantId = currentEmployeeId;
      } else {
        const requestedClaimantId = typeof claimantEmployeeId === 'string' ? claimantEmployeeId.trim() : '';
        if (!requestedClaimantId) {
          return NextResponse.json(
            { error: 'Select the employee who personally paid for this fuel transaction' },
            { status: 422 },
          );
        }
        const [claimant] = await db
          .select({ id: employees.id, employmentStatus: employees.employmentStatus })
          .from(employees)
          .where(
            and(
              eq(employees.id, requestedClaimantId),
              eq(employees.tenantId, session.tenantId),
            ),
          )
          .limit(1);
        if (!claimant) {
          return NextResponse.json({ error: 'Reimbursement claimant was not found in your organisation' }, { status: 404 });
        }
        if (claimant.employmentStatus === 'archived' || claimant.employmentStatus === 'deceased') {
          return NextResponse.json({ error: 'This employee cannot be used as a reimbursement claimant' }, { status: 422 });
        }
        reimbursementClaimantId = claimant.id;
      }
    }

    const transactionId = randomUUID();
    const reimbursementId = paymentMethod === 'personal_reimbursement' ? randomUUID() : null;
    const now = new Date();
    const auditSequence = Date.now();
    const cleanNotes = typeof notes === 'string' ? notes.trim().slice(0, 2000) : '';

    await runAtomicMutations((executor) => {
      const queries = [
        executor.insert(fuelTransactions).values({
          id: transactionId,
          tripId: resolvedTripId || null,
          clientSyncId: syncId,
          vehicleId: resolvedVehicleId!,
          transactionAt: eventAt,
          stationName: stationName || null,
          fuelType,
          litres: String(litresNumber),
          amount: String(amountNumber),
          odometerReading: odometerNumber,
          referenceNumber: referenceNumber || null,
          paymentMethod,
          fillType: fillType || 'full',
          driverEmployeeId: resolvedDriverId,
          recordedByUserId: session.user.id,
        }),
        executor.insert(auditEvents).values({
          tenantId: session.tenantId,
          tenantSequence: auditSequence,
          eventType: 'fuel_created',
          actorUserId: session.user.id,
          action: 'create',
          entityType: 'fuel_transaction',
          entityId: transactionId,
          summary: `Fuel: ${litresNumber}L of ${fuelType} at ${stationName || 'unknown station'} — ${amountNumber}`,
          after: {
            paymentMethod,
            reimbursementClaimantId,
          },
          sourceChannel: syncId ? 'offline_sync' : 'web',
        }),
      ];

      if (reimbursementId && reimbursementClaimantId) {
        queries.push(
          executor.insert(reimbursements).values({
            id: reimbursementId,
            transactionId,
            claimantEmployeeId: reimbursementClaimantId,
            amount: amountNumber.toFixed(2),
            state: 'pending',
            notes: cleanNotes || null,
            createdAt: now,
            updatedAt: now,
          }),
          executor.insert(auditEvents).values({
            tenantId: session.tenantId,
            tenantSequence: auditSequence + 1,
            eventType: 'reimbursement_created',
            actorUserId: session.user.id,
            action: 'create',
            entityType: 'reimbursement',
            entityId: reimbursementId,
            summary: `Personal fuel reimbursement claim created for N$${amountNumber.toFixed(2)}`,
            after: {
              transactionId,
              claimantEmployeeId: reimbursementClaimantId,
              amount: amountNumber.toFixed(2),
              state: 'pending',
            },
            sourceChannel: syncId ? 'offline_sync' : 'web',
          }),
        );
      }

      if (odometerNumber !== null) {
        queries.push(
          executor.insert(vehicleOdometerEvents).values({
            vehicleId: resolvedVehicleId!,
            odometerValue: odometerNumber,
            source: 'fuel',
            sourceEntityType: 'fuel_transaction',
            sourceEntityId: transactionId,
            recordedByUserId: session.user.id,
          }),
          executor
            .update(vehicles)
            .set({
              currentOdometer: sql`GREATEST(${vehicles.currentOdometer}, ${odometerNumber})`,
              updatedAt: now,
            })
            .where(and(eq(vehicles.id, resolvedVehicleId!), eq(vehicles.tenantId, session.tenantId))),
        );
      }
      return queries;
    });

    const [[transaction], [reimbursement]] = await Promise.all([
      db
        .select()
        .from(fuelTransactions)
        .where(eq(fuelTransactions.id, transactionId))
        .limit(1),
      reimbursementId
        ? db
            .select()
            .from(reimbursements)
            .where(eq(reimbursements.id, reimbursementId))
            .limit(1)
        : Promise.resolve([]),
    ]);
    if (!transaction) throw new Error('Fuel transaction committed but could not be reloaded');

    const { activeWorkspace } = await getSessionWorkspace(session);
    await Promise.allSettled([
      createScopedNotifications({
        tenantId: session.tenantId,
        recipientUserIds: [session.user.id],
        category: 'outcome',
        eventType: 'fuel_entry_recorded',
        title: `Fuel Entry Recorded — ${litresNumber}L`,
        body: reimbursement
          ? `${litresNumber}L of ${fuelType} recorded. Personal reimbursement claim N$${amountNumber.toFixed(2)} is pending review.`
          : `${litresNumber}L of ${fuelType} at ${stationName || 'unknown station'} — N$${amountNumber}.`,
        entityType: 'fuel_transaction',
        entityId: transaction.id,
        actionUrl: reimbursement ? `/dashboard/reimbursements/${reimbursement.id}` : '/dashboard/fuel',
        workspace: activeWorkspace,
        priority: reimbursement ? 'high' : 'normal',
      }),
    ]);

    return NextResponse.json(
      { success: true, data: transaction, reimbursement: reimbursement ?? null },
      { status: 201 },
    );
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === '23505') {
      return NextResponse.json({ error: 'This fuel entry was already submitted' }, { status: 409 });
    }
    console.error('[fuel] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create fuel transaction' }, { status: 500 });
  }
}

/** PATCH /api/fuel — verify or reject a tenant-scoped fuel transaction atomically. */
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const roleCheck = await requireDashboardAction(session, '/dashboard/fuel', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permission = await requirePermission(session, Permissions.FUEL_VERIFY);
    if (permission instanceof NextResponse) return permission;

    const body = (await req.json()) as {
      transactionId?: string;
      action?: 'verify' | 'reject';
      reason?: string;
    };
    if (!body.transactionId || !['verify', 'reject'].includes(body.action || '')) {
      return NextResponse.json(
        { error: 'Transaction and a verify or reject action are required' },
        { status: 400 },
      );
    }
    const action = body.action as 'verify' | 'reject';
    if (action === 'reject' && !body.reason?.trim()) {
      return NextResponse.json({ error: 'A rejection reason is required' }, { status: 422 });
    }

    const db = getDb();
    const [transaction] = await db
      .select({ id: fuelTransactions.id, isVerified: fuelTransactions.isVerified, anomalyState: fuelTransactions.anomalyState })
      .from(fuelTransactions)
      .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(and(eq(fuelTransactions.id, body.transactionId), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);
    if (!transaction) return NextResponse.json({ error: 'Fuel transaction not found' }, { status: 404 });

    const isVerified = action === 'verify';
    const nextState = isVerified ? 'verified' : 'rejected';
    const reason = body.reason?.trim() || null;

    await runAtomicMutations((executor) => [
      executor
        .update(fuelTransactions)
        .set({
          isVerified,
          verifiedByUserId: session.user.id,
          anomalyState: nextState,
          anomalyNotes: reason,
          updatedAt: new Date(),
        })
        .where(eq(fuelTransactions.id, transaction.id)),
      executor.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: `fuel_${action}`,
        actorUserId: session.user.id,
        action,
        entityType: 'fuel_transaction',
        entityId: transaction.id,
        before: { isVerified: transaction.isVerified, anomalyState: transaction.anomalyState },
        after: { isVerified, anomalyState: nextState },
        reason,
        sourceChannel: 'web',
      }),
    ]);

    const [updated] = await db
      .select()
      .from(fuelTransactions)
      .where(eq(fuelTransactions.id, transaction.id))
      .limit(1);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[fuel] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to review fuel transaction' }, { status: 500 });
  }
}
