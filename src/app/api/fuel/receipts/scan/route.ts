import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { auditEvents } from '@/db/schema/audit';
import { vehicles } from '@/db/schema/fleet';
import { requireAnyPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { parseFuelReceiptText, receiptValidationFlags, type ReceiptFields } from '@/lib/receipt-ocr';
import { enrichFuelReceiptFields } from '@/lib/receipt-ocr-enrichment';
import { AI_OCR_CONFIDENCE, extractReceiptWithAi, isAiFeatureEnabled } from '@/lib/ai';
import { ALLOWED_IMAGE_TYPES, UPLOAD_MAX_SIZE_BYTES } from '@/lib/constants';
import { recognizeWithTesseract } from '@/lib/tesseract-ocr';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/fuel/receipts/scan
 *
 * Standalone server-side receipt scan: upload an image, get back extracted
 * fields, confidence and validation flags — without needing a fuel
 * transaction yet. Engines: OpenAI vision (preferred) → Tesseract (fallback).
 * When both fail the response returns status 'ocr_failed' with
 * manualEntryRequired: true so the user can still create the entry manually.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permission = await requireAnyPermission(session, [
      Permissions.DRIVER_FUEL_CREATE,
      Permissions.FUEL_MANAGE,
    ]);
    if (permission instanceof NextResponse) return permission;

    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Receipt image is required' }, { status: 400 });
    if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
      return NextResponse.json({ error: 'Receipt must be a supported image' }, { status: 415 });
    }
    if (file.size > UPLOAD_MAX_SIZE_BYTES) {
      return NextResponse.json({ error: 'Receipt image exceeds the upload limit' }, { status: 413 });
    }

    const original = Buffer.from(await file.arrayBuffer());
    const db = getDb();

    let ocrStatus = 'ocr_confirmed';
    let engine = 'none';
    let extractionData: Record<string, unknown> = {};
    let fieldConfidence: Record<string, number> = {};
    let extractionConfidence = 0;
    const flags: string[] = [];

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
      engine = 'openai';
      const aiFields = aiExtraction.json as Partial<ReceiptFields>;
      extractionData = { ...aiFields };
      fieldConfidence = Object.fromEntries(
        Object.keys(aiFields).map((key) => [key, AI_OCR_CONFIDENCE]),
      );
      extractionConfidence = AI_OCR_CONFIDENCE;
      if (aiFields.amount === undefined && aiFields.litres === undefined) {
        ocrStatus = 'awaiting_verification';
      }
    } else {
      engine = 'tesseract';
      try {
        const processed = await sharp(original)
          .rotate()
          .resize({ width: 2200, withoutEnlargement: true })
          .greyscale()
          .normalise()
          .png()
          .toBuffer();
        const recognition = await recognizeWithTesseract(processed);
        const parsed = parseFuelReceiptText(recognition.data.text, recognition.data.confidence);
        const enriched = enrichFuelReceiptFields(recognition.data.text, parsed.fields);
        extractionData = { ...enriched };
        fieldConfidence = parsed.confidence;
        extractionConfidence = Math.max(0, Math.min(1, recognition.data.confidence / 100));
        if (
          extractionConfidence < 0.65 ||
          Object.values(parsed.confidence).some((confidence) => confidence < 0.6)
        ) {
          ocrStatus = 'awaiting_verification';
        }
      } catch (ocrError) {
        ocrStatus = 'ocr_failed';
        console.warn('[fuel/receipts/scan] OCR failed:', ocrError);
      }
    }

    const fields = extractionData as Partial<ReceiptFields>;
    // Match the extracted registration against THIS TENANT's fleet only (never
    // another tenant's vehicle), then run cross-field validation against it.
    let matchedVehicle: {
      id: string;
      licenceNumber: string;
      fuelType: string | null;
      currentOdometer: number | null;
    } | null = null;
    if (fields.registrationNumber) {
      const norm = fields.registrationNumber.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      // Match against both the raw licence and a space-stripped form so a
      // receipt printed without spaces still matches a DB value like "N 12345".
      const [vehicle] = await db
        .select({
          id: vehicles.id,
          licenceNumber: vehicles.licenceNumber,
          fuelType: vehicles.fuelType,
          currentOdometer: vehicles.currentOdometer,
        })
        .from(vehicles)
        .where(
          and(
            eq(vehicles.tenantId, session.tenantId),
            or(
              ilike(vehicles.licenceNumber, `%${norm}%`),
              ilike(sql`replace(${vehicles.licenceNumber}, ' ', '')`, `%${norm}%`),
            ),
          ),
        )
        .limit(1);
      if (vehicle) {
        matchedVehicle = vehicle;
        flags.push(
          ...receiptValidationFlags({
            fields,
            vehicleRegistration: vehicle.licenceNumber,
            vehicleFuelType: vehicle.fuelType ?? '',
            currentOdometer: vehicle.currentOdometer ?? 0,
          }),
        );
      } else {
        flags.push('unmatched_vehicle');
      }
    }

    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: Date.now(),
      eventType: 'fuel_receipt_scan_completed',
      actorUserId: session.user.id,
      action: 'scan_and_extract_normalized',
      entityType: 'fuel_receipt',
      entityId: null,
      summary: `Receipt scanned with normalized OCR; status ${ocrStatus}`,
      after: {
        fileName: file.name,
        engine,
        flags,
        matchedVehicleId: matchedVehicle?.id ?? null,
      },
      sourceChannel: 'web',
    });

    return NextResponse.json({
      success: true,
      status: ocrStatus,
      engine,
      manualEntryRequired: ocrStatus === 'ocr_failed',
      fields: extractionData,
      confidence: fieldConfidence,
      extractionConfidence: Number(extractionConfidence.toFixed(3)),
      flags,
      matchedVehicle: matchedVehicle
        ? { id: matchedVehicle.id, licenceNumber: matchedVehicle.licenceNumber }
        : null,
    });
  } catch (error) {
    console.error('[fuel/receipts/scan] POST failed:', error);
    return NextResponse.json({ error: 'Receipt scan failed' }, { status: 500 });
  }
}
