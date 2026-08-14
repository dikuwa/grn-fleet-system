import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { getDb } from '@/db';
import {
  fuelReceipts,
  fuelTransactions,
  receiptFieldCorrections,
  trips,
} from '@/db/schema/trips';
import { auditEvents } from '@/db/schema/audit';
import { vehicles } from '@/db/schema/fleet';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { buildKey, isStorageConfigured, uploadFile } from '@/lib/storage';
import { parseFuelReceiptText, receiptValidationFlags, type ReceiptFields } from '@/lib/receipt-ocr';
import { AI_OCR_CONFIDENCE, extractReceiptWithAi, isAiFeatureEnabled } from '@/lib/ai';
import { ALLOWED_IMAGE_TYPES, UPLOAD_MAX_SIZE_BYTES } from '@/lib/constants';
import { fuelScopeCondition } from '@/lib/record-scope';
import { runAtomicMutations } from '@/lib/db-atomic';

export const runtime = 'nodejs';
export const maxDuration = 60;

const CORRECTABLE_FIELDS = new Set<keyof ReceiptFields>([
  'supplier',
  'stationLocation',
  'transactionDate',
  'transactionTime',
  'transactionReference',
  'pumpNumber',
  'fuelType',
  'amount',
  'currency',
  'litres',
  'pricePerLitre',
  'odometer',
  'registrationNumber',
  'receiptNumber',
  'vatNumber',
  'attendant',
  'cardNumber',
  'vehicleMake',
  'vehicleModel',
  'vehicleColour',
]);

const TERMINAL_RECEIPT_REVIEW_STATUSES = new Set(['verified', 'rejected']);

type ReceiptCorrectionValue = string | number | null;

async function fuelAccess(session: Parameters<typeof requirePermission>[0]) {
  const [driverResult, managerResult] = await Promise.all([
    requirePermission(session, Permissions.DRIVER_FUEL_CREATE),
    requirePermission(session, Permissions.FUEL_MANAGE),
  ]);
  const isDriver = !(driverResult instanceof NextResponse);
  const isManager = !(managerResult instanceof NextResponse);
  return { isDriver, isManager, denied: !isDriver && !isManager ? driverResult : null };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const access = await fuelAccess(session);
    if (access.denied) return access.denied;

    if (!isStorageConfigured()) {
      return NextResponse.json({ error: 'Secure receipt storage is not configured' }, { status: 503 });
    }

    const form = await request.formData();
    const file = form.get('file') as File | null;
    const transactionId = String(form.get('transactionId') || '').trim();
    if (!file || !transactionId) {
      return NextResponse.json({ error: 'Receipt image and fuel transaction are required' }, { status: 400 });
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
      return NextResponse.json({ error: 'Receipt must be a supported image' }, { status: 415 });
    }
    if (file.size > UPLOAD_MAX_SIZE_BYTES) {
      return NextResponse.json({ error: 'Receipt image exceeds the upload limit' }, { status: 413 });
    }

    const db = getDb();
    const scope = access.isManager
      ? eq(vehicles.tenantId, session.tenantId)
      : and(
          eq(vehicles.tenantId, session.tenantId),
          fuelScopeCondition({
            tenantId: session.tenantId,
            userId: session.user.id,
            recordScope: 'assigned',
          }),
        );
    const [context] = await db
      .select({
        transaction: fuelTransactions,
        tripStart: trips.startedAt,
        tripEnd: trips.returnedAt,
        registration: vehicles.licenceNumber,
        fuelType: vehicles.fuelType,
        currentOdometer: vehicles.currentOdometer,
      })
      .from(fuelTransactions)
      .innerJoin(vehicles, eq(vehicles.id, fuelTransactions.vehicleId))
      .leftJoin(trips, eq(trips.id, fuelTransactions.tripId))
      .where(and(eq(fuelTransactions.id, transactionId), scope))
      .limit(1);
    if (!context) return NextResponse.json({ error: 'Fuel transaction not found' }, { status: 404 });

    const original = Buffer.from(await file.arrayBuffer());
    const checksum = createHash('sha256').update(original).digest('hex');
    const [duplicate] = await db
      .select({ id: fuelReceipts.id })
      .from(fuelReceipts)
      .where(and(eq(fuelReceipts.tenantId, session.tenantId), eq(fuelReceipts.checksum, checksum)))
      .limit(1);
    if (duplicate) {
      return NextResponse.json(
        { error: 'This receipt image was already uploaded', duplicateReceiptId: duplicate.id },
        { status: 409 },
      );
    }

    const key = buildKey(file.name, 'receipts', `tenant/${session.tenantId}`);
    await uploadFile(original, key, {
      contentType: file.type,
      tenantPrefix: `tenant/${session.tenantId}`,
    });

    // OCR extraction is evidence, not user confirmation. A receipt remains in
    // verification until the user explicitly confirms the extracted/manual values.
    let ocrStatus = 'awaiting_verification';
    let rawOcrResponse: Record<string, unknown> = {};
    let extractionData: Record<string, unknown> = {};
    let fieldConfidence: Record<string, number> = {};
    let extractionConfidence = 0;
    let flags: string[] = [];

    let aiExtraction: {
      json: Record<string, unknown>;
      usage: { inputTokens: number; outputTokens: number };
    } | null = null;
    if (isAiFeatureEnabled('receipt_ocr')) {
      aiExtraction = await extractReceiptWithAi({
        imageBuffer: original,
        mimeType: file.type,
        tenantId: session.tenantId,
      });
    }

    if (aiExtraction) {
      const aiFields = aiExtraction.json as Partial<ReceiptFields>;
      extractionData = { ...aiFields };
      fieldConfidence = Object.fromEntries(
        Object.keys(aiFields).map((field) => [field, AI_OCR_CONFIDENCE]),
      );
      extractionConfidence = AI_OCR_CONFIDENCE;
      rawOcrResponse = { engine: 'openai', usage: aiExtraction.usage };
      flags = receiptValidationFlags({
        fields: aiFields,
        vehicleRegistration: context.registration,
        vehicleFuelType: context.fuelType,
        currentOdometer: context.currentOdometer,
        tripStart: context.tripStart,
        tripEnd: context.tripEnd,
      });
    } else {
      try {
        const processed = await sharp(original)
          .rotate()
          .resize({ width: 2200, withoutEnlargement: true })
          .greyscale()
          .normalise()
          .png()
          .toBuffer();
        const { createWorker } = await import('tesseract.js');
        const worker = await createWorker('eng');
        try {
          const recognition = await worker.recognize(processed);
          const parsed = parseFuelReceiptText(recognition.data.text, recognition.data.confidence);
          extractionData = { ...parsed.fields };
          fieldConfidence = parsed.confidence;
          extractionConfidence = Math.max(0, Math.min(1, recognition.data.confidence / 100));
          rawOcrResponse = {
            engine: 'tesseract',
            text: recognition.data.text,
            confidence: recognition.data.confidence,
            engineVersion: recognition.data.version,
          };
          flags = receiptValidationFlags({
            fields: parsed.fields,
            vehicleRegistration: context.registration,
            vehicleFuelType: context.fuelType,
            currentOdometer: context.currentOdometer,
            tripStart: context.tripStart,
            tripEnd: context.tripEnd,
          });
        } finally {
          await worker.terminate();
        }
      } catch (ocrError) {
        ocrStatus = 'ocr_failed';
        rawOcrResponse = {
          engine: 'tesseract',
          error: ocrError instanceof Error ? ocrError.message : 'OCR unavailable',
        };
      }
    }

    const receiptId = randomUUID();
    await runAtomicMutations((executor) => {
      const mutations = [
        executor.insert(fuelReceipts).values({
          id: receiptId,
          tenantId: session.tenantId,
          transactionId,
          fileKey: key,
          originalFileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          checksum,
          ocrStatus,
          rawOcrResponse,
          extractionData: { ...extractionData, validationFlags: flags },
          fieldConfidence,
          extractionConfidence: extractionConfidence.toFixed(3),
        }),
        executor.insert(auditEvents).values({
          tenantId: session.tenantId,
          tenantSequence: Date.now(),
          eventType: 'fuel_receipt_ocr_completed',
          actorUserId: session.user.id,
          action: 'upload_and_extract',
          entityType: 'fuel_receipt',
          entityId: receiptId,
          summary: `Fuel receipt uploaded; OCR status ${ocrStatus}`,
          after: { transactionId, checksum, flags, extractionConfidence },
          sourceChannel: 'web',
        }),
      ];
      if (flags.length > 0) {
        mutations.push(
          executor
            .update(fuelTransactions)
            .set({
              anomalyState: 'flagged',
              anomalyNotes: flags.join(', '),
              updatedAt: new Date(),
            })
            .where(eq(fuelTransactions.id, transactionId)),
        );
      }
      return mutations;
    });

    const [receipt] = await db
      .select()
      .from(fuelReceipts)
      .where(and(eq(fuelReceipts.id, receiptId), eq(fuelReceipts.tenantId, session.tenantId)))
      .limit(1);
    if (!receipt) throw new Error('Receipt committed but could not be reloaded');

    return NextResponse.json(
      {
        success: true,
        data: receipt,
        fields: extractionData,
        confidence: fieldConfidence,
        flags,
        manualEntryRequired: ocrStatus === 'ocr_failed',
      },
      { status: 201 },
    );
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') {
      return NextResponse.json({ error: 'This receipt image was already uploaded' }, { status: 409 });
    }
    console.error('[fuel/receipts] POST failed:', error);
    return NextResponse.json({ error: 'Receipt upload or OCR processing failed' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const body = (await request.json()) as {
      receiptId?: string;
      action?: 'correct' | 'confirm' | 'verify' | 'reject';
      corrections?: Record<string, ReceiptCorrectionValue>;
      reason?: string;
    };
    if (!body.receiptId || !body.action) {
      return NextResponse.json({ error: 'Receipt and action are required' }, { status: 400 });
    }
    if (!['correct', 'confirm', 'verify', 'reject'].includes(body.action)) {
      return NextResponse.json({ error: 'Unsupported receipt action' }, { status: 422 });
    }
    if (body.action === 'reject' && !body.reason?.trim()) {
      return NextResponse.json({ error: 'A rejection reason is required' }, { status: 422 });
    }

    const receiptId = body.receiptId;
    const action = body.action;
    const reason = body.reason?.trim() || null;

    const access = await fuelAccess(session);
    const isReviewAction = action === 'verify' || action === 'reject';
    if (isReviewAction) {
      const reviewPermission = await requirePermission(session, Permissions.FUEL_VERIFY);
      if (reviewPermission instanceof NextResponse) return reviewPermission;
    } else if (access.denied) {
      return access.denied;
    }

    const db = getDb();
    const scope = isReviewAction || access.isManager
      ? eq(vehicles.tenantId, session.tenantId)
      : and(
          eq(vehicles.tenantId, session.tenantId),
          fuelScopeCondition({
            tenantId: session.tenantId,
            userId: session.user.id,
            recordScope: 'assigned',
          }),
        );
    const [record] = await db
      .select({ receipt: fuelReceipts, transactionId: fuelTransactions.id })
      .from(fuelReceipts)
      .innerJoin(fuelTransactions, eq(fuelTransactions.id, fuelReceipts.transactionId))
      .innerJoin(vehicles, eq(vehicles.id, fuelTransactions.vehicleId))
      .where(and(eq(fuelReceipts.id, receiptId), eq(fuelReceipts.tenantId, session.tenantId), scope))
      .limit(1);
    if (!record) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });

    if (TERMINAL_RECEIPT_REVIEW_STATUSES.has(record.receipt.ocrStatus)) {
      return NextResponse.json(
        { error: `This receipt has already been ${record.receipt.ocrStatus} and cannot be changed without a formal review workflow` },
        { status: 409 },
      );
    }

    const extraction = (record.receipt.extractionData ?? {}) as Record<string, unknown>;
    if (action === 'correct') {
      if (!body.corrections || Object.keys(body.corrections).length === 0) {
        return NextResponse.json({ error: 'At least one correction is required' }, { status: 422 });
      }
      const rawEntries = Object.entries(body.corrections);
      const entries = rawEntries.filter(([field, value]) =>
        CORRECTABLE_FIELDS.has(field as keyof ReceiptFields) &&
        (value === null || typeof value === 'string' || typeof value === 'number'),
      );
      if (entries.length !== rawEntries.length) {
        return NextResponse.json({ error: 'One or more receipt fields cannot be corrected' }, { status: 422 });
      }

      // Blank strings and explicit null both mean the reviewer intentionally
      // cleared a bad OCR value. Preserve that decision instead of silently
      // leaving the old extracted text in the official receipt record.
      const normalisedEntries = entries.map(([fieldName, value]) => [
        fieldName,
        typeof value === 'string' && value.trim() === '' ? null : value,
      ] as const);
      const corrections = Object.fromEntries(normalisedEntries);
      const nextExtraction = { ...extraction, ...corrections };

      await runAtomicMutations((executor) => [
        executor.insert(receiptFieldCorrections).values(
          normalisedEntries.map(([fieldName, correctedValue]) => ({
            receiptId,
            fieldName,
            extractedValue: extraction[fieldName] === undefined ? null : String(extraction[fieldName]),
            correctedValue: correctedValue === null ? '' : String(correctedValue),
            correctedByUserId: session.user.id,
          })),
        ),
        executor
          .update(fuelReceipts)
          .set({ extractionData: nextExtraction, ocrStatus: 'manually_corrected' })
          .where(eq(fuelReceipts.id, receiptId)),
        executor.insert(auditEvents).values({
          tenantId: session.tenantId,
          tenantSequence: Date.now(),
          eventType: 'fuel_receipt_correct',
          actorUserId: session.user.id,
          action: 'correct',
          entityType: 'fuel_receipt',
          entityId: receiptId,
          before: extraction,
          after: corrections,
          sourceChannel: 'web',
        }),
      ]);
    } else if (action === 'confirm') {
      if (record.receipt.ocrStatus === 'ocr_confirmed') {
        return NextResponse.json({ success: true, idempotent: true });
      }
      await runAtomicMutations((executor) => [
        executor
          .update(fuelReceipts)
          .set({ ocrStatus: 'ocr_confirmed' })
          .where(eq(fuelReceipts.id, receiptId)),
        executor.insert(auditEvents).values({
          tenantId: session.tenantId,
          tenantSequence: Date.now(),
          eventType: 'fuel_receipt_confirm',
          actorUserId: session.user.id,
          action: 'confirm',
          entityType: 'fuel_receipt',
          entityId: receiptId,
          before: { ocrStatus: record.receipt.ocrStatus },
          after: { ocrStatus: 'ocr_confirmed' },
          sourceChannel: 'web',
        }),
      ]);
    } else {
      const verified = action === 'verify';
      const now = new Date();
      await runAtomicMutations((executor) => [
        executor
          .update(fuelReceipts)
          .set({
            isVerified: verified,
            verifiedByUserId: session.user.id,
            verifiedAt: now,
            ocrStatus: verified ? 'verified' : 'rejected',
          })
          .where(eq(fuelReceipts.id, receiptId)),
        executor
          .update(fuelTransactions)
          .set({
            isVerified: verified,
            verifiedByUserId: session.user.id,
            anomalyState: verified ? 'verified' : 'rejected',
            anomalyNotes: reason,
            updatedAt: now,
          })
          .where(eq(fuelTransactions.id, record.transactionId)),
        executor.insert(auditEvents).values({
          tenantId: session.tenantId,
          tenantSequence: Date.now(),
          eventType: `fuel_receipt_${action}`,
          actorUserId: session.user.id,
          action,
          entityType: 'fuel_receipt',
          entityId: receiptId,
          before: {
            receiptVerified: record.receipt.isVerified,
            receiptStatus: record.receipt.ocrStatus,
          },
          after: { verified, status: verified ? 'verified' : 'rejected' },
          reason,
          sourceChannel: 'web',
        }),
      ]);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[fuel/receipts] PATCH failed:', error);
    return NextResponse.json({ error: 'Could not update receipt' }, { status: 500 });
  }
}
