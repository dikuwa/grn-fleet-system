import { describe, expect, it } from 'vitest';
import { licenceOcrConfidence, parseNamibianLicenceOcr } from '../driver-licence-ocr';

describe('parseNamibianLicenceOcr', () => {
  it('extracts labelled Namibian licence number, validity and codes', () => {
    const parsed = parseNamibianLicenceOcr(`
      REPUBLIC OF NAMIBIA
      Surname: MUKOYA
      Identity No: 88010100123
      Date of Birth: 01/01/1988
      Licence No: 123456789
      Codes: B C1
      Validity: 14/08/2026 - 13/08/2031
      Issue No: 02
    `);

    expect(parsed.licenceNumber).toBe('123456789');
    expect(parsed.licenceCodes).toEqual(['B', 'C1']);
    expect(parsed.validFrom).toBe('2026-08-14');
    expect(parsed.validUntil).toBe('2031-08-13');
    expect(parsed.dateOfBirth).toBe('1988-01-01');
    expect(parsed.nationalIdNumber).toBe('88010100123');
    expect(parsed.issueNumber).toBe('02');
  });

  it('accepts license spelling and ISO dates', () => {
    const parsed = parseNamibianLicenceOcr(`
      Name: TEST DRIVER
      License Number: NA-998877
      License Code: EB CE
      Valid From: 2026-08-01
      Expiry: 2031-07-31
    `);

    expect(parsed.licenceNumber).toBe('NA-998877');
    expect(parsed.licenceCodes).toEqual(['EB', 'CE']);
    expect(parsed.validFrom).toBe('2026-08-01');
    expect(parsed.validUntil).toBe('2031-07-31');
  });

  it('does not manufacture required values when OCR text does not contain them', () => {
    const parsed = parseNamibianLicenceOcr('REPUBLIC OF NAMIBIA\nDRIVING LICENCE\nIMAGE TOO BLURRED');

    expect(parsed.licenceNumber).toBeUndefined();
    expect(parsed.licenceCodes).toEqual([]);
    expect(parsed.validFrom).toBeUndefined();
    expect(parsed.validUntil).toBeUndefined();
  });
});

describe('licenceOcrConfidence', () => {
  it('gives absent fields zero confidence and extracted fields the OCR confidence', () => {
    const confidence = licenceOcrConfidence(
      {
        licenceNumber: '123456789',
        licenceCodes: ['B'],
      },
      84,
    );

    expect(confidence.licenceNumber).toBe(0.84);
    expect(confidence.licenceCodes).toBe(0.84);
  });
});
