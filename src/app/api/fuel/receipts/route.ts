import { createHash } from 'node:crypto';
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

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const driverPermission = await requirePermission(session, Permissions.DRIVER_FUEL_CREATE);
    if (driverPermission instanceof NextResponse) {
      const managerPermission = await requirePermission(session, Permissions.FUEL_MANAGE);
      if (managerPermission instanceof NextResponse) return managerPermission;
    }
    if (!isStorageConfigured()) {
      return NextResponse.json({ error: 'Secure receipt storage is not configured' }, { status: 503 });
    }

    const form = await request.formData();
    const file = form.get('file') as File | null;
    const transactionId = String(form.get('transactionId') || '');
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
      .where(and(eq(fuelTransactions.id, transactionId), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);
    if (!context) return NextResponse.json({ error: 'Fuel transaction not found' }, { status: 404 });

    const original = Buffer.from(await file.arrayBuffer());
    const checksum = createHash('sha256').update(original).digest('hex');
    const [duplicate] = await db.select({ id: fuelReceipts.id }).from(fuelReceipts)
      .where(and(eq(fuelReceipts.tenantId, session.tenantId), eq(fuelReceipts.checksum, checksum)))
      .limit(1);
    if (duplicate) {
      return NextResponse.json({ error: 'This receipt image was already uploaded', duplicateReceiptId: duplicate.id }, { status: 409 });
    }

    const key = buildKey(file.name, 'receipts', `tenant/${session.tenantId}`);
    await uploadFile(original, key, { contentType: file.type, tenantPrefix: `tenant/${session.tenantId}` });

    let ocrStatus = 'ocr_confirmed';
    let rawOcrResponse: Record<string, unknown> = {};
    let extractionData: Record<string, unknown> = {};
    let fieldConfidence: Record<string, number> = {};
    let extractionConfidence = 0;
    let flags: string[] = [];

    // Engine order: OpenAI vision (preferred, server-side) → Tesseract (fallback).
    // If both fail the receipt is still saved and marked for manual review — we
    // never return zero values when processing fails.
    let aiExtraction: { json: Record<string, unknown>; usage: { inputTokens: number; outputTokens: number } } | null = null;
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
      fieldConfidence = Object.fromEntries(Object.keys(aiFields).map((key) => [key, AI_OCR_CONFIDENCE]));
      extractionConfidence = AI_OCR_CONFIDENCE;
      rawOcrResponse = {
        engine: 'openai',
        usage: aiExtraction.usage,
      };
      flags = receiptValidationFlags({
        fields: aiFields,
        vehicleRegistration: context.registration,
        vehicleFuelType: context.fuelType,
        currentOdometer: context.currentOdometer,
        tripStart: context.tripStart,
        tripEnd: context.tripEnd,
      });
      if (
        extractionConfidence < 0.65 ||
        flags.length > 0 ||
        (aiFields.amount === undefined && aiFields.litres === undefined)
      ) ocrStatus = 'awaiting_verification';
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
          if (
            extractionConfidence < 0.65 ||
            Object.values(parsed.confidence).some((confidence) => confidence < 0.6) ||
            flags.length > 0
          ) ocrStatus = 'awaiting_verification';
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

    const [receipt] = await db.insert(fuelReceipts).values({
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
    }).returning();
    if (flags.length) {
      await db.update(fuelTransactions).set({
        anomalyState: 'flagged',
        anomalyNotes: flags.join(', '),
        updatedAt: new Date(),
      }).where(eq(fuelTransactions.id, transactionId));
    }
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: Date.now(),
      eventType: 'fuel_receipt_ocr_completed',
      actorUserId: session.user.id,
      action: 'upload_and_extract',
      entityType: 'fuel_receipt',
      entityId: receipt.id,
      summary: `Fuel receipt uploaded; OCR status ${ocrStatus}`,
      after: { transactionId, checksum, flags, extractionConfidence },
      sourceChannel: 'web',
    });

    return NextResponse.json({
      success: true,
      data: receipt,
      fields: extractionData,
      confidence: fieldConfidence,
      flags,
      manualEntryRequired: ocrStatus === 'ocr_failed',
    }, { status: 201 });
  } catch (error) {
    console.error('[fuel/receipts] POST failed:', error);
    return NextResponse.json({ error: 'Receipt upload or OCR processing failed' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const body = await request.json() as {
      receiptId?: string;
      action?: 'correct' | 'confirm' | 'verify' | 'reject';
      corrections?: Record<string, string | number>;
      reason?: string;
    };
    if (!body.receiptId || !body.action) {
      return NextResponse.json({ error: 'Receipt and action are required' }, { status: 400 });
    }
    const db = getDb();
    const [receipt] = await db
      .select({ receipt: fuelReceipts, transactionId: fuelTransactions.id })
      .from(fuelReceipts)
      .innerJoin(fuelTransactions, eq(fuelTransactions.id, fuelReceipts.transactionId))
      .where(and(eq(fuelReceipts.id, body.receiptId), eq(fuelReceipts.tenantId, session.tenantId)))
      .limit(1);
    if (!receipt) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });

    const extraction = (receipt.receipt.extractionData ?? {}) as Record<string, unknown>;
    if (body.action === 'correct') {
      if (!body.corrections || Object.keys(body.corrections).length === 0) {
        return NextResponse.json({ error: 'At least one correction is required' }, { status: 422 });
      }
      await db.insert(receiptFieldCorrections).values(
        Object.entries(body.corrections).map(([fieldName, correctedValue]) => ({
          receiptId: body.receiptId!,
          fieldName,
          extractedValue: extraction[fieldName] === undefined ? null : String(extraction[fieldName]),
          correctedValue: String(correctedValue),
          correctedByUserId: session.user.id,
        })),
      );
      await db.update(fuelReceipts).set({
        extractionData: { ...extraction, ...body.corrections },
        ocrStatus: 'manually_corrected',
      }).where(eq(fuelReceipts.id, body.receiptId));
    } else if (body.action === 'confirm') {
      await db.update(fuelReceipts).set({ ocrStatus: 'ocr_confirmed' })
        .where(eq(fuelReceipts.id, body.receiptId));
    } else {
      const permission = await requirePermission(session, Permissions.FUEL_VERIFY);
      if (permission instanceof NextResponse) return permission;
      const verified = body.action === 'verify';
      await db.update(fuelReceipts).set({
        isVerified: verified,
        verifiedByUserId: session.user.id,
        verifiedAt: new Date(),
        ocrStatus: verified ? 'verified' : 'rejected',
      }).where(eq(fuelReceipts.id, body.receiptId));
      await db.update(fuelTransactions).set({
        isVerified: verified,
        verifiedByUserId: session.user.id,
        anomalyState: verified ? 'verified' : 'rejected',
        anomalyNotes: body.reason || null,
        updatedAt: new Date(),
      }).where(eq(fuelTransactions.id, receipt.transactionId));
    }

    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: Date.now(),
      eventType: `fuel_receipt_${body.action}`,
      actorUserId: session.user.id,
      action: body.action,
      entityType: 'fuel_receipt',
      entityId: body.receiptId,
      before: extraction,
      after: body.corrections ?? { status: body.action },
      reason: body.reason,
      sourceChannel: 'web',
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[fuel/receipts] PATCH failed:', error);
    return NextResponse.json({ error: 'Could not update receipt' }, { status: 500 });
  }
}
