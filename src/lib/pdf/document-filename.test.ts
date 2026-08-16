import { describe, expect, it } from 'vitest';
import {
  buildFleetPdfFilename,
  fleetDocumentDate,
  referenceFromDocumentSnapshot,
} from './document-filename';

describe('fleet PDF filenames', () => {
  it('builds a readable, portable filename', () => {
    expect(buildFleetPdfFilename({
      documentType: 'trip_authority',
      date: '2026-07-18T08:00:00.000Z',
      reference: 'TA/0048:*',
    })).toBe('TRIP AUTHORITY - 18-07-2026 - TA 0048.pdf');
  });

  it('uses meaningful snapshot references before opaque IDs', () => {
    expect(referenceFromDocumentSnapshot({
      vehicle: { licenceNumber: 'GRN 4287' },
    }, 'c862d850')).toBe('GRN 4287');
  });

  it('formats dates deterministically in DD-MM-YYYY order', () => {
    expect(fleetDocumentDate('2026-01-02')).toBe('02-01-2026');
  });
});
