import { describe, expect, it } from 'vitest';
import { parseFuelReceiptText, receiptValidationFlags } from '@/lib/receipt-ocr';

describe('Fuel receipt OCR parsing', () => {
  it('extracts common Namibian fuel receipt fields', () => {
    const result = parseFuelReceiptText(`
      NAM FUEL RUNDU
      VAT NO 1234567
      DATE 27/07/2026 14:32
      RECEIPT NO RCP-8831
      REGISTRATION N12345W
      DIESEL
      LITRES 42.50
      PRICE/L 21.40
      TOTAL N$ 909.50
      ODOMETER 56230
    `, 88);

    expect(result.fields.supplier).toBe('NAM FUEL RUNDU');
    expect(result.fields.fuelType).toBe('diesel');
    expect(result.fields.litres).toBe(42.5);
    expect(result.fields.pricePerLitre).toBe(21.4);
    expect(result.fields.amount).toBe(909.5);
    expect(result.fields.currency).toBe('NAD');
    expect(result.fields.odometer).toBe(56230);
    expect(result.fields.registrationNumber).toBe('N12345W');
    expect(result.confidence.amount).toBeGreaterThan(0.7);
  });

  it('flags mismatches for review without rejecting uncertain OCR', () => {
    const flags = receiptValidationFlags({
      fields: {
        registrationNumber: 'N99999W',
        fuelType: 'petrol',
        litres: 120,
        amount: 2000,
        pricePerLitre: 120,
        odometer: 100,
      },
      vehicleRegistration: 'N12345W',
      vehicleFuelType: 'diesel',
      vehicleTankCapacity: 80,
      currentOdometer: 50000,
    });

    expect(flags).toEqual(expect.arrayContaining([
      'registration_mismatch',
      'fuel_type_mismatch',
      'odometer_regression',
      'quantity_exceeds_tank_capacity',
      'implausible_price_per_litre',
    ]));
  });
});
