import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { trips } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { operationalExpenseReceiptStaging } from '@/db/schema/operational-expenses';
import { hasPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { tripScopeCondition } from '@/lib/record-scope';
import { buildKey, deleteFile, isStorageConfigured, uploadFile } from '@/lib/storage';
import { UPLOAD_MAX_SIZE_BYTES } from '@/lib/constants';
import { runAtomicMutations } from '@/lib/db-atomic';

const EXPENSE_RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function expenseReceiptClosureConflict(error: unknown) {
  const record = error as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  const code = record?.code ?? record?.cause?.code;
  const message = [record?.message, record?.cause?.message, String(error)]
    .filter((value): value is string => Boolean(value))
    .join(' ');
  return code === '23514' && message.includes('closed_trip_expense_receipt_immutable');
}

export async function POST(request: NextRequest) {
  let uploadedKey: string | null = null;
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
    if (tripId && !UUID_PATTERN.test(tripId)) {
      return NextResponse.json({ error: 'Trip not found or not assigned to you' }, { status: 404 });
    }
    if (!tripId && vehicleId && !UUID_PATTERN.test(vehicleId)) {
      return NextResponse.json({ error: 'Vehicle not found in this tenant' }, { status: 404 });
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
      if (trip.status === 'closed') {
        return NextResponse.json({ error: 'This trip is already closed. Expense receipt evidence is immutable.' }, { status: 409 });
      }
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
    uploadedKey = key;

    try {
      await runAtomicMutations((executor) => [
        executor.insert(operationalExpenseReceiptStaging).values({
          tenantId: session.tenantId,
          tripId,
          vehicleId,
          fileKey: key,
          originalFileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          uploadedByUserId: session.user.id,
        }),
        executor.insert(auditEvents).values({
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
        }),
      ]);
    } catch (error) {
      await deleteFile(key).catch((cleanupError) => {
        console.error('[expenses/receipts] failed to remove uncommitted receipt object:', cleanupError);
      });
      uploadedKey = null;
      throw error;
    }

    return NextResponse.json({ success: true, data: { key, fileName: file.name, mimeType: file.type } }, { status: 201 });
  } catch (error) {
    if (uploadedKey) {
      await deleteFile(uploadedKey).catch((cleanupError) => {
        console.error('[expenses/receipts] failed to remove failed receipt object:', cleanupError);
      });
    }
    if (expenseReceiptClosureConflict(error)) {
      return NextResponse.json(
        { error: 'This trip is already closed. Expense receipt evidence is immutable.' },
        { status: 409 },
      );
    }
    const record = error as { code?: string; cause?: { code?: string } };
    const code = record?.code ?? record?.cause?.code;
    if (code === '23505') {
      return NextResponse.json({ error: 'This expense receipt evidence was already staged' }, { status: 409 });
    }
    console.error('[expenses/receipts] POST failed:', error);
    return NextResponse.json({ error: 'Failed to upload expense receipt' }, { status: 500 });
  }
}
