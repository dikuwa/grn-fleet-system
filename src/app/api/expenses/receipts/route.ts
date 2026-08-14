import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { trips } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { hasPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { tripScopeCondition } from '@/lib/record-scope';
import { buildKey, isStorageConfigured, uploadFile } from '@/lib/storage';
import { UPLOAD_MAX_SIZE_BYTES } from '@/lib/constants';

const EXPENSE_RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const [fuelManage, tripManage, driverLog] = await Promise.all([
      hasPermission(session, Permissions.FUEL_MANAGE),
      hasPermission(session, Permissions.TRIP_MANAGE),
      hasPermission(session, Permissions.DRIVER_LOG_CREATE),
    ]);
    const canManage = fuelManage || tripManage;
    if (!canManage && !driverLog) {
      return NextResponse.json({ error: 'You are not allowed to upload expense evidence' }, { status: 403 });
    }
    if (!isStorageConfigured()) {
      return NextResponse.json({ error: 'Secure expense storage is not configured' }, { status: 503 });
    }

    const form = await request.formData();
    const file = form.get('file') as File | null;
    const tripId = String(form.get('tripId') || '').trim() || null;
    let vehicleId = String(form.get('vehicleId') || '').trim() || null;
    if (!file) return NextResponse.json({ error: 'Receipt image or PDF is required' }, { status: 400 });
    if (!EXPENSE_RECEIPT_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Receipt must be JPEG, PNG, WebP or PDF' }, { status: 415 });
    }
    if (file.size > UPLOAD_MAX_SIZE_BYTES) {
      return NextResponse.json({ error: 'Receipt exceeds the upload limit' }, { status: 413 });
    }
    if (!tripId && !canManage) {
      return NextResponse.json({ error: 'Drivers may attach expenses only to their active trip' }, { status: 422 });
    }

    const db = getDb();
    if (tripId) {
      const conditions = [eq(trips.id, tripId), eq(trips.tenantId, session.tenantId)];
      if (!canManage) {
        conditions.push(
          tripScopeCondition({ tenantId: session.tenantId, userId: session.user.id, recordScope: 'assigned' }),
        );
      }
      const [trip] = await db
        .select({ vehicleId: trips.vehicleId, status: trips.status })
        .from(trips)
        .where(and(...conditions))
        .limit(1);
      if (!trip) return NextResponse.json({ error: 'Trip not found or not assigned to you' }, { status: 404 });
      if (!canManage && !['in_progress', 'return_due'].includes(trip.status)) {
        return NextResponse.json({ error: 'The assigned trip is not active' }, { status: 409 });
      }
      vehicleId = trip.vehicleId;
    }
    if (!vehicleId) return NextResponse.json({ error: 'Vehicle is required' }, { status: 422 });

    const [vehicle] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);
    if (!vehicle) return NextResponse.json({ error: 'Vehicle not found in this tenant' }, { status: 404 });

    const original = Buffer.from(await file.arrayBuffer());
    const key = buildKey(file.name, 'expense-receipts', `tenant/${session.tenantId}`);
    await uploadFile(original, key, { contentType: file.type, tenantPrefix: `tenant/${session.tenantId}` });

    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: Date.now(),
      eventType: 'expense_receipt_uploaded',
      actorUserId: session.user.id,
      action: 'upload',
      entityType: tripId ? 'trip' : 'vehicle',
      entityId: tripId || vehicleId,
      summary: 'Operational expense receipt evidence uploaded',
      after: { tripId, vehicleId, key, fileName: file.name, mimeType: file.type, size: file.size },
      sourceChannel: 'web',
    });

    return NextResponse.json({ success: true, data: { key, fileName: file.name, mimeType: file.type } }, { status: 201 });
  } catch (error) {
    console.error('[expenses/receipts] POST failed:', error);
    return NextResponse.json({ error: 'Failed to upload expense receipt' }, { status: 500 });
  }
}
