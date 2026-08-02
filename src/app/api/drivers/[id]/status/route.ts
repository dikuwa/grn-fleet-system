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
import { employees, driverProfiles, driverLicences, employeeDocuments } from '@/db/schema/people';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, gte } from 'drizzle-orm';
import { requireRequestAuth, requireAnyPermission } from '@/lib/auth-helpers';
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

    const permCheck = await requireAnyPermission(session, [
      Permissions.DRIVER_MANAGE,
      Permissions.STAFF_MANAGE,
    ]);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { action, reason, effectiveDate, documentKey } = body;
    const validActions = ['suspend', 'reactivate'];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: `Action must be one of: ${validActions.join(', ')}` },
        { status: 400 },
      );
    }

    if (!reason?.trim()) {
      return NextResponse.json({ error: 'A reason is required for this action.' }, { status: 400 });
    }

    const db = getDb();

    // Verify the employee exists in this tenant and has a driver profile
    const [employee] = await db
      .select({
        id: employees.id,
        isDriver: employees.isDriver,
        employmentStatus: employees.employmentStatus,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(employees)
      .where(and(eq(employees.id, id), eq(employees.tenantId, session.tenantId)))
      .limit(1);

    if (!employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }

    if (!employee.isDriver) {
      return NextResponse.json({ error: 'Employee is not registered as a driver' }, { status: 400 });
    }

    const [profile] = await db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.employeeId, employee.id))
      .limit(1);

    if (!profile) {
      return NextResponse.json({ error: 'Driver profile not found' }, { status: 404 });
    }

    const effectiveAt = effectiveDate ? new Date(effectiveDate) : new Date();
    const previousStatus = profile.driverStatus;

    if (action === 'suspend') {
      if (profile.driverStatus === 'suspended') {
        return NextResponse.json({ error: 'Driver is already suspended' }, { status: 409 });
      }

      await db
        .update(driverProfiles)
        .set({
          driverStatus: 'suspended',
          suspensionReason: reason,
          suspensionEndsAt: null,
          availabilityStatus: 'unavailable',
          updatedAt: new Date(),
        })
        .where(eq(driverProfiles.id, profile.id));

      // If a document was provided, attach it as supporting evidence
      if (documentKey) {
        await db.insert(employeeDocuments).values({
          employeeId: employee.id,
          documentType: 'suspension_order',
          documentName: `Driver Suspension — ${reason.substring(0, 60)}`,
          fileKey: documentKey,
          mimeType: 'application/pdf',
          notes: `Suspension effective ${effectiveAt.toISOString().split('T')[0]}. Reason: ${reason}`,
        });
      }

      // Invalidate active licences
      await db
        .update(driverLicences)
        .set({ isActive: false, notes: `Suspended: ${reason}` })
        .where(
          and(
            eq(driverLicences.driverProfileId, profile.id),
            eq(driverLicences.isActive, true),
          ),
        );

      await db.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: 'driver.suspended',
        actorUserId: session.user.id,
        action: 'suspend',
        entityType: 'driver_profile',
        entityId: profile.id,
        summary: `Driver ${employee.firstName} ${employee.lastName} suspended. Reason: ${reason}`,
        before: { driverStatus: previousStatus },
        after: { driverStatus: 'suspended', suspensionReason: reason },
      });

      return NextResponse.json({
        success: true,
        message: `Driver ${employee.firstName} ${employee.lastName} has been suspended.`,
        data: { driverStatus: 'suspended', previousStatus, reason },
      });
    }

    if (action === 'reactivate') {
      if (profile.driverStatus === 'authorised') {
        return NextResponse.json({ error: 'Driver is already active' }, { status: 409 });
      }

      const [verifiedLicence] = await db.select({ id: driverLicences.id }).from(driverLicences).where(and(
        eq(driverLicences.driverProfileId, profile.id),
        eq(driverLicences.verificationStatus, 'verified'),
        eq(driverLicences.isVerified, true),
        gte(driverLicences.expiryDate, new Date().toISOString().slice(0, 10)),
      )).limit(1);
      if (!verifiedLicence) {
        return NextResponse.json({ error: 'This driver cannot be authorised until a current licence is complete and verified.' }, { status: 409 });
      }

      // Reactivate — restore licences, clear suspension fields
      await db
        .update(driverProfiles)
        .set({
          driverStatus: 'authorised',
          suspensionReason: null,
          suspensionEndsAt: null,
          availabilityStatus: 'available',
          updatedAt: new Date(),
        })
        .where(eq(driverProfiles.id, profile.id));

      // Reactivate licences that were active before suspension
      await db
        .update(driverLicences)
        .set({ isActive: true })
        .where(
          and(
            eq(driverLicences.driverProfileId, profile.id),
            eq(driverLicences.verificationStatus, 'verified'),
          ),
        );

      await db.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: 'driver.reactivated',
        actorUserId: session.user.id,
        action: 'reactivate',
        entityType: 'driver_profile',
        entityId: profile.id,
        summary: `Driver ${employee.firstName} ${employee.lastName} reactivated. Reason: ${reason}`,
        before: { driverStatus: previousStatus },
        after: { driverStatus: 'authorised', reactivationReason: reason },
      });

      return NextResponse.json({
        success: true,
        message: `Driver ${employee.firstName} ${employee.lastName} has been reactivated.`,
        data: { driverStatus: 'authorised', previousStatus, reason },
      });
    }
  } catch (error) {
    console.error('[Driver Status] PATCH failed:', error);
    return NextResponse.json(
      { error: 'Failed to update driver status: ' + String(error) },
      { status: 500 },
    );
  }
}
