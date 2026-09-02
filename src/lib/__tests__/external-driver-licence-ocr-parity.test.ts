import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const externalRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/external-parties/[id]/licences/route.ts'),
  'utf8',
);
const internalRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/drivers/[id]/licences/route.ts'),
  'utf8',
);
const externalReviewPageSource = readFileSync(
  resolve(process.cwd(), 'src/app/(dashboard)/dashboard/drivers/external/page.tsx'),
  'utf8',
);

describe('external driver licence OCR parity', () => {
  it('reuses the established Namibian OCR pipeline for image evidence', () => {
    expect(externalRouteSource).toContain("import sharp from 'sharp';");
    expect(externalRouteSource).toContain("import { createWorker } from 'tesseract.js';");
    expect(externalRouteSource).toContain('parseNamibianLicenceOcr(rawText)');
    expect(externalRouteSource).toContain('licenceOcrConfidence(extracted, meanConfidence)');
    expect(internalRouteSource).toContain('parseNamibianLicenceOcr(rawText)');
  });

  it('keeps OCR advisory and human verification authoritative', () => {
    expect(externalRouteSource).toContain("verificationStatus: 'awaiting_review'");
    expect(externalRouteSource).toContain('extractedData,');
    expect(externalRouteSource).toContain('submitted: {');
    expect(externalRouteSource).toContain("ocrWarnings.push('licence_number_mismatch')");
    expect(externalRouteSource).toContain("ocrWarnings.push('expiry_date_mismatch')");
    expect(externalRouteSource).toContain("ocrWarnings.push('licence_class_mismatch')");
  });

  it('does not replace submitted licence fields with OCR output', () => {
    expect(externalRouteSource).toContain('licenceNumber: licenceNumber.slice(0, 120)');
    expect(externalRouteSource).toContain('licenceClass: licenceClass.slice(0, 120)');
    expect(externalRouteSource).toContain('expiryDate,');
    expect(externalRouteSource).not.toContain('licenceNumber: ocr.extracted.licenceNumber');
    expect(externalRouteSource).not.toContain('licenceClass: ocr.extracted.licenceCodes');
  });

  it('shows OCR evidence and warnings to the human reviewer', () => {
    expect(externalReviewPageSource).toContain('extractedData?: LicenceOcrData | null');
    expect(externalReviewPageSource).toContain('OCR review evidence');
    expect(externalReviewPageSource).toContain('Detected number');
    expect(externalReviewPageSource).toContain('Detected expiry');
    expect(externalReviewPageSource).toContain('aria-label="OCR review warnings"');
    expect(externalReviewPageSource).toContain(
      'OCR is review assistance only. Verify the uploaded evidence before approving the licence.',
    );
  });
});
