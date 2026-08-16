import { describe, expect, it } from 'vitest';
import {
  buildPublicDocumentSummary,
  normalizePublicDocumentRedactionProfile,
} from '@/lib/public-document-redaction';

const snapshot = {
  reference: 'GRN/TR/2026/000123',
  requestReference: 'GRN/TR/2026/000123',
  purpose: 'Regional field inspection',
  scope: 'regional',
  startAt: '2026-08-15T08:00:00.000Z',
  endAt: '2026-08-15T16:00:00.000Z',
  vehicle: {
    licenceNumber: 'N 12345 W',
    vehicleRegisterNumber: 'GRN-0099',
    make: 'Toyota',
    model: 'Hilux',
  },
  driver: {
    name: 'Sensitive Driver',
    idNumber: '90010100123',
    licenceNumber: 'DL-SECRET-123',
    contactNumber: '+264 81 000 0000',
  },
  passengers: [
    {
      name: 'Sensitive Passenger',
      employeeNumber: 'EMP-SECRET',
      contactNumber: '+264 81 111 1111',
    },
  ],
  approvalWorkflow: [
    { officer: 'Sensitive Officer', comment: 'Internal approval comment' },
  ],
  fuelInformation: { fuelCardNumber: 'FUEL-CARD-SECRET' },
  documentIdentity: { snapshottedAt: '2026-08-15T07:00:00.000Z' },
};

describe('public document redaction', () => {
  it('defaults unknown profiles to external_standard', () => {
    expect(normalizePublicDocumentRedactionProfile('unknown')).toBe('external_standard');
  });

  it('external_minimal exposes identity fields only', () => {
    const summary = buildPublicDocumentSummary({
      documentType: 'transport_request',
      documentVersion: 2,
      documentStatus: 'issued',
      snapshotData: snapshot,
      profile: 'external_minimal',
    });

    expect(summary.rows.map((row) => row.label)).toEqual(['Reference', 'Status', 'Version']);
    expect(JSON.stringify(summary)).not.toContain('Sensitive Driver');
    expect(JSON.stringify(summary)).not.toContain('DL-SECRET-123');
  });

  it('external_standard exposes safe operational data without personal details', () => {
    const summary = buildPublicDocumentSummary({
      documentType: 'trip_authority',
      documentVersion: 1,
      documentStatus: 'issued',
      snapshotData: snapshot,
      profile: 'external_standard',
    });
    const serialized = JSON.stringify(summary);

    expect(serialized).toContain('Regional field inspection');
    expect(serialized).toContain('N 12345 W');
    expect(serialized).not.toContain('Sensitive Driver');
    expect(serialized).not.toContain('Sensitive Passenger');
    expect(serialized).not.toContain('90010100123');
    expect(serialized).not.toContain('DL-SECRET-123');
    expect(serialized).not.toContain('FUEL-CARD-SECRET');
    expect(serialized).not.toContain('Internal approval comment');
  });

  it('internal summary still avoids arbitrary sensitive object serialization', () => {
    const summary = buildPublicDocumentSummary({
      documentType: 'trip_authority',
      documentVersion: 1,
      documentStatus: 'issued',
      snapshotData: { ...snapshot, department: 'Transport' },
      profile: 'internal',
    });
    const serialized = JSON.stringify(summary);

    expect(serialized).toContain('Transport');
    expect(serialized).not.toContain('90010100123');
    expect(serialized).not.toContain('DL-SECRET-123');
  });
});
