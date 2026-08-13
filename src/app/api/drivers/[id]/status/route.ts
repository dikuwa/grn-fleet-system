/**
 * Driver Status API
 *
 * PATCH /api/drivers/[id]/status — Suspend or reactivate a driver
 *
 * Request body:
 *   { action: 'suspend', reason: string, effectiveDate?: string, documentKey?: string }
 *   { action: 'reactivate', reason: string, effectiveDate?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { employees, driverProfiles, driverLicences } from '@/db/schema/people';
import { eq, and, desc, gte, sql } from 'drizzle-orm';
import {
  requireDashboardAction,
  requireRequestAuth,
  requireAnyPermission,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const routeCheck = await requireDashboardAction(session, '/dashboard/drivers', 'update');
    if (routeCheck instanceof NextResponse) return routeCheck;

    const permCheck = await requireAnyPermission(session, [
      Permissions.DRIVER_MANAGE,
      Permissions.STAFF_MANAGE,
    ]);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const action = String(body.action || '');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const documentKey = typeof body.documentKey === 'string' ? body.documentKey.trim() : '';
    const validActions = ['suspend', 'reactivate'];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: `Action must be one of: ${validActions.join(', ')}` },
        { status: 400 },
      );
    }
    if (!reason) {
      return NextResponse.json({ error: 'A reason is required for this action.' }, { status: 400 });
    }
    if (reason.length > 1000) {
      return NextResponse.json({ error: 'Reason must be 1000 characters or fewer.' }, { status: 422 });
    }

    const effectiveAt = body.effectiveDate ? new Date(String(body.effectiveDate)) : new Date();
    if (!Number.isFinite(effectiveAt.getTime())) {
      return NextResponse.json({ error: 'Effective date is invalid.' }, { status: 422 });
    }

    const db = getDb();
    const [employee] = await db
      .select({
        id: employees.id,
        isDriver: employees.isDriver,
        employmentStatus: employees.employmentStatus,
        availabilityStatus: employees.availabilityStatus,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(employees)
      .where(and(eq(employees.id, id), eq(employees.tenantId, session.tenantId)))
      .limit(1);

    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    if (!employee.isDriver) {
      return NextResponse.json({ error: 'Employee is not registered as a driver' }, { status: 400 });
    }
    if (action === 'reactivate' && employee.employmentStatus !== 'active') {
      return NextResponse.json(
        { error: 'Only an active staff member can be reactivated as an operational driver.' },
        { status: 409 },
      );
    }

    const [profile] = await db
      .select({ id: driverProfiles.id, driverStatus: driverProfiles.driverStatus })
      .from(driverProfiles)
      .where(eq(driverProfiles.employeeId, employee.id))
      .limit(1);
    if (!profile) return NextResponse.json({ error: 'Driver profile not found' }, { status: 404 });

    const now = new Date();
    const auditSequence = Date.now();

    if (action === 'suspend') {
      if (profile.driverStatus === 'suspended') {
        return NextResponse.json({ error: 'Driver is already suspended' }, { status: 409 });
      }

      // Claim the current driver state first and make every dependent mutation
      // conditional on that claim. This prevents concurrent suspend/reactivate
      // requests from producing split profile/licence/staff/audit state.
      await db.execute(sql`
        WITH profile_claim AS (
          UPDATE driver_profiles
          SET driver_status = 'suspended',
              suspension_reason = ${reason},
              suspension_ends_at = NULL,
              availability_status = 'unavailable',
              updated_at = ${now}
          WHERE id = ${profile.id}::uuid
            AND employee_id = ${employee.id}::uuid
            AND driver_status = ${profile.driverStatus}
            AND driver_status <> 'suspended'
          RETURNING id
        ),
        employee_update AS (
          UPDATE employees
          SET availability_status = 'temporarily_unavailable', updated_at = ${now}
          WHERE id = ${employee.id}::uuid
            AND tenant_id = ${session.tenantId}::uuid
            AND availability_status = 'available'
            AND EXISTS (SELECT 1 FROM profile_claim)
          RETURNING id
        ),
        licences_update AS (
          UPDATE driver_licences
          SET is_active = false,
              notes = ${`Suspended: ${reason}`},
              updated_at = ${now}
          WHERE driver_profile_id = ${profile.id}::uuid
            AND is_active = true
            AND EXISTS (SELECT 1 FROM profile_claim)
          RETURNING id
        ),
        document_insert AS (
          INSERT INTO employee_documents (
            employee_id, document_type, document_name, file_key, mime_type, notes
          )
          SELECT
            ${employee.id}::uuid,
            'suspension_order',
            ${`Driver Suspension — ${reason.substring(0, 60)}`},
            ${documentKey || null},
            'application/pdf',
            ${`Suspension effective ${effectiveAt.toISOString().split('T')[0]}. Reason: ${reason}`}
          FROM profile_claim
          WHERE ${Boolean(documentKey)} = true
          RETURNING id
        ),
        audit_insert AS (
          INSERT INTO audit_events (
            tenant_id, tenant_sequence, event_type, actor_user_id, action,
            entity_type, entity_id, summary, before, after, reason, source_channel
          )
          SELECT
            ${session.tenantId}::uuid,
            ${auditSequence},
            'driver.suspended',
            ${session.user.id},
            'suspend',
            'driver_profile',
            ${profile.id}::uuid,
            ${`Driver ${employee.firstName} ${employee.lastName} suspended. Reason: ${reason}`},
            jsonb_build_object('driverStatus', ${profile.driverStatus}),
            jsonb_build_object('driverStatus', 'suspended', 'suspensionReason', ${reason}),
            ${reason},
            'web'
          FROM profile_claim
          RETURNING id
        )
        SELECT CAST(CASE
          WHEN (SELECT count(*) FROM profile_claim) = 1
           AND (SELECT count(*) FROM audit_insert) = 1
          THEN '1'
          ELSE 'atomic_driver_status_failed_' || (SELECT count(*) FROM profile_claim)::text
        END AS integer) AS committed
      `);

      return NextResponse.json({
        success: true,
        message: `Driver ${employee.firstName} ${employee.lastName} has been suspended.`,
        data: { driverStatus: 'suspended', previousStatus: profile.driverStatus, reason },
      });
    }

    if (profile.driverStatus === 'authorised') {
      return NextResponse.json({ error: 'Driver is already active' }, { status: 409 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const [verifiedLicence] = await db
      .select({ id: driverLicences.id })
      .from(driverLicences)
      .where(and(
        eq(driverLicences.driverProfileId, profile.id),
        eq(driverLicences.verificationStatus, 'verified'),
        eq(driverLicences.isVerified, true),
        gte(driverLicences.expiryDate, today),
      ))
      .orderBy(desc(driverLicences.version))
      .limit(1);
    if (!verifiedLicence) {
      return NextResponse.json(
        { error: 'This driver cannot be authorised until a current licence is complete and verified.' },
        { status: 409 },
      );
    }

    // Reactivation chooses exactly the latest current verified licence as the
    // operational licence. Older verified versions stay inactive even if legacy
    // data left more than one verified row behind.
    await db.execute(sql`
      WITH profile_claim AS (
        UPDATE driver_profiles
        SET driver_status = 'authorised',
            suspension_reason = NULL,
            suspension_ends_at = NULL,
            availability_status = 'available',
            updated_at = ${now}
        WHERE id = ${profile.id}::uuid
          AND employee_id = ${employee.id}::uuid
          AND driver_status = ${profile.driverStatus}
          AND driver_status <> 'authorised'
          AND EXISTS (
            SELECT 1
            FROM driver_licences dl
            WHERE dl.id = ${verifiedLicence.id}::uuid
              AND dl.driver_profile_id = ${profile.id}::uuid
              AND dl.verification_status = 'verified'
              AND dl.is_verified = true
              AND dl.expiry_date >= ${today}
          )
          AND EXISTS (
            SELECT 1
            FROM employees e
            WHERE e.id = ${employee.id}::uuid
              AND e.tenant_id = ${session.tenantId}::uuid
              AND e.employment_status = 'active'
          )
        RETURNING id
      ),
      employee_update AS (
        UPDATE employees
        SET availability_status = 'available', updated_at = ${now}
        WHERE id = ${employee.id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND employment_status = 'active'
          AND availability_status = 'temporarily_unavailable'
          AND EXISTS (SELECT 1 FROM profile_claim)
        RETURNING id
      ),
      licences_update AS (
        UPDATE driver_licences
        SET is_active = (id = ${verifiedLicence.id}::uuid), updated_at = ${now}
        WHERE driver_profile_id = ${profile.id}::uuid
          AND verification_status = 'verified'
          AND is_verified = true
          AND EXISTS (SELECT 1 FROM profile_claim)
        RETURNING id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id, action,
          entity_type, entity_id, summary, before, after, reason, source_channel
        )
        SELECT
          ${session.tenantId}::uuid,
          ${auditSequence},
          'driver.reactivated',
          ${session.user.id},
          'reactivate',
          'driver_profile',
          ${profile.id}::uuid,
          ${`Driver ${employee.firstName} ${employee.lastName} reactivated. Reason: ${reason}`},
          jsonb_build_object('driverStatus', ${profile.driverStatus}),
          jsonb_build_object('driverStatus', 'authorised', 'reactivationReason', ${reason}),
          ${reason},
          'web'
        FROM profile_claim
        RETURNING id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM profile_claim) = 1
         AND (SELECT count(*) FROM audit_insert) = 1
        THEN '1'
        ELSE 'atomic_driver_status_failed_' || (SELECT count(*) FROM profile_claim)::text
      END AS integer) AS committed
    `);

    return NextResponse.json({
      success: true,
      message: `Driver ${employee.firstName} ${employee.lastName} has been reactivated.`,
      data: { driverStatus: 'authorised', previousStatus: profile.driverStatus, reason },
    });
  } catch (error) {
    console.error('[Driver Status] PATCH failed:', error);
    if (String(error).includes('atomic_driver_status_failed')) {
      return NextResponse.json(
        { error: 'Driver status changed while the action was being saved. Refresh and review the latest driver state.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to update driver status' }, { status: 500 });
  }
}
