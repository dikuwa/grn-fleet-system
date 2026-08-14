import { describe, expect, it } from 'vitest';
import { enrichFuelReceiptFields } from './receipt-ocr-enrichment';
import { parseFuelReceiptText } from './receipt-ocr';
import { parseNamibianLicenceOcr } from './driver-licence-ocr';

describe('OCR regression fixtures', () => {
  it('enriches BlueFuel-style labels without using real receipt data', () => {
    const text = `
TOTAL FOURWAYS
P24 TxId.: TX-ABCD-9876
Pump No.: 04
Registration No.: N 12345 W
Attendant Name.: TEST USER
Vehicle Make.: TOYOTA
Vehicle Model.: HILUX
Vehicle Colour.: WHITE
TOTAL: N$ 1234.56
Litres: 45.67 L
`;

    const base = parseFuelReceiptText(text, 90).fields;
    const fields = enrichFuelReceiptFields(text, base);

    expect(fields.transactionReference).toBe('TX-ABCD-9876');
    expect(fields.pumpNumber).toBe('04');
    expect(fields.registrationNumber).toBe('N12345W');
    expect(fields.attendant).toBe('TEST USER');
    expect(fields.vehicleMake).toBe('TOYOTA');
    expect(fields.vehicleModel).toBe('HILUX');
    expect(fields.vehicleColour).toBe('WHITE');
    expect(fields.stationLocation).toBe('TOTAL FOURWAYS');
  });

  it('preserves already parsed receipt fields while filling missing normalized labels', () => {
    const text = `
TOTAL FOURWAYS
P24 TxId.: TX-NORMALIZED-100
Registration No.: N 77777 W
`;
    const base = {
      supplier: 'USER CONFIRMED STATION',
      transactionReference: 'KEEP-EXISTING',
      registrationNumber: 'N00000W',
    } as ReturnType<typeof parseFuelReceiptText>['fields'];

    const fields = enrichFuelReceiptFields(text, base);

    expect(fields.supplier).toBe('USER CONFIRMED STATION');
    expect(fields.transactionReference).toBe('KEEP-EXISTING');
    expect(fields.registrationNumber).toBe('N00000W');
  });

  it('does not treat the generic reverse-side licence legend as driver entitlements', () => {
    const text = `
REPUBLIC OF NAMIBIA
DRIVING LICENCE
Licence No.: TEST123456
9. Code: C1
Validity: 01.01.2025 - 31.12.2030

CATEGORIES OF MOTOR VEHICLES
A A1 B BE C C1 C1E CE
`;

    const fields = parseNamibianLicenceOcr(text);

    expect(fields.licenceCodes).toEqual(['C1']);
    expect(fields.licenceNumber).toBe('TEST123456');
    expect(fields.validFrom).toBe('2025-01-01');
    expect(fields.validUntil).toBe('2030-12-31');
  });
});
