import { describe, expect, it } from 'vitest';
import { vehicleDocumentExpiryState } from './vehicle-documents';

describe('vehicle document compliance states', () => {
  const now = new Date('2026-08-17T00:00:00.000Z');

  it('keeps non-expiring records neutral', () => {
    expect(vehicleDocumentExpiryState(null, now)).toBe('not_applicable');
  });

  it('distinguishes valid, expiring and expired records', () => {
    expect(vehicleDocumentExpiryState('2026-12-31', now)).toBe('valid');
    expect(vehicleDocumentExpiryState('2026-08-31', now)).toBe('expiring_soon');
    expect(vehicleDocumentExpiryState('2026-08-16', now)).toBe('expired');
  });
});
