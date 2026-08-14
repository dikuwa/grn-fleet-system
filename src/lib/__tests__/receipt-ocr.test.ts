import { describe, expect, it } from 'vitest';
import { parseFuelReceiptText, receiptValidationFlags } from '../receipt-ocr';

describe('parseFuelReceiptText', () => {
  it('extracts common Namibian fuel receipt fields without manufacturing zeroes', () => {
    const parsed = parseFuelReceiptText(
      `PUMA ENERGY RUNDU\nVAT NO: 12345678\nReceipt No: 004921\nDate 14/08/2026 18:42\nPump No: 06\nDiesel 50\nLitres: 42.73 L\nPrice/L: N$ 21.889\nTOTAL: N$ 935.32\nRegistration No: N 12345 W\nOdometer: 128450\nAttendant: KAMATI`,
      91,
    );

    expect(parsed.fields.supplier).toBe('PUMA ENERGY RUNDU');
    expect(parsed.fields.currency).toBe('NAD');
    expect(parsed.fields.amount).toBe(935.32);
    expect(parsed.fields.litres).toBe(42.73);
    expect(parsed.fields.pricePerLitre).toBe(21.889);
    expect(parsed.fields.odometer).toBe(128450);
    expect(parsed.fields.registrationNumber).toBe('N12345W');
    expect(parsed.fields.receiptNumber).toBe('004921');
    expect(parsed.fields.fuelType).toBe('diesel_50');
  });

  it('supports comma-decimal and dot-grouped NAD values', () => {
    const parsed = parseFuelReceiptText(
      `ENGEN OSHAKATI\nLITRES 56,40\nPRICE PER LITRE NAD 21,875\nTOTAL NAD 1.233,75\nSLIP # 88991`,
      88,
    );

    expect(parsed.fields.litres).toBe(56.4);
    expect(parsed.fields.pricePerLitre).toBe(21.875);
    expect(parsed.fields.amount).toBe(1233.75);
    expect(parsed.fields.receiptNumber).toBe('88991');
  });

  it('supports comma-grouped and dot-decimal totals', () => {
    const parsed = parseFuelReceiptText(
      `NAMCOR KATUTURA\nVOLUME 57.125 L\nRATE N$ 21.75\nGRAND TOTAL N$ 1,242.47`,
      95,
    );

    expect(parsed.fields.litres).toBe(57.125);
    expect(parsed.fields.pricePerLitre).toBe(21.75);
    expect(parsed.fields.amount).toBe(1242.47);
  });

  it('derives price per litre only when amount and litres are both valid', () => {
    const parsed = parseFuelReceiptText(`SHELL\nLITRES: 40.00\nTOTAL: N$ 880.00`, 90);

    expect(parsed.fields.amount).toBe(880);
    expect(parsed.fields.litres).toBe(40);
    expect(parsed.fields.computedPricePerLitre).toBe(22);
    expect(parsed.fields.pricePerLitre).toBe(22);
  });

  it('leaves missing or zero-like OCR values undefined instead of reporting successful zero extraction', () => {
    const parsed = parseFuelReceiptText(
      `SERVICE STATION\nLITRES: 0.00\nTOTAL: N$ 0.00\nODO: 0\nTHANK YOU`,
      75,
    );

    expect(parsed.fields.litres).toBeUndefined();
    expect(parsed.fields.amount).toBeUndefined();
    expect(parsed.fields.odometer).toBeUndefined();
    expect(parsed.fields.pricePerLitre).toBeUndefined();
  });
});

describe('receiptValidationFlags', () => {
  it('flags inconsistent receipt arithmetic without dividing by zero', () => {
    const flags = receiptValidationFlags({
      fields: { amount: 1000, litres: 40, pricePerLitre: 20 },
      vehicleRegistration: 'N12345W',
      vehicleFuelType: 'diesel',
      currentOdometer: 100000,
    });

    expect(flags).toContain('amount_litres_inconsistent');
  });

  it('does not create fuel mismatch flags when vehicle fuel type is unavailable', () => {
    const flags = receiptValidationFlags({
      fields: { fuelType: 'diesel' },
      vehicleRegistration: 'N12345W',
      vehicleFuelType: '',
      currentOdometer: 100000,
    });

    expect(flags).not.toContain('fuel_type_mismatch');
  });
});
