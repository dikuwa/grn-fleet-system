import { describe, expect, it } from 'vitest';
import { parseNamibianLicenceOcr } from './driver-licence-ocr';

describe('Namibian driver licence OCR parser', () => {
  it('extracts dates, identifiers, and multiple licence codes', () => {
    const fields = parseNamibianLicenceOcr(`
      Name: Test Employee
      ID Number: 90010100123
      Licence No: NA123456
      Valid From: 01/02/2024
      Valid Until: 31/01/2029
      Codes: B C1
    `);
    expect(fields.licenceNumber).toBe('NA123456');
    expect(fields.validUntil).toBe('2029-01-31');
    expect(fields.licenceCodes).toEqual(expect.arrayContaining(['B', 'C1']));
  });
});
