import { describe, expect, it } from 'vitest';
import {
  documentTypeLabel,
  formatAuditEvent,
  formatHumanValue,
  humanizeKey,
} from './human-readable';

describe('human-readable formatters', () => {
  it('formats implementation names and document types', () => {
    expect(humanizeKey('specialAuthorityRequired')).toBe('Special Authority Required');
    expect(documentTypeLabel('fuel_summary')).toBe('Fuel Summary');
  });

  it('never exposes raw empty or structured values', () => {
    expect(formatHumanValue([])).toBe('No records');
    expect(formatHumanValue({})).toBe('No details');
    expect(formatHumanValue(null)).toBe('Not recorded');
    expect(formatHumanValue(true)).toBe('Yes');
  });

  it('formats unknown audit events safely', () => {
    expect(
      formatAuditEvent({
        actorName: 'Maria Shikongo',
        action: 'request.submitted',
        eventType: 'request_submitted',
        entityType: 'transport_request',
        reference: 'GRN/TR/2026/1',
      }).title,
    ).toContain('Maria Shikongo submitted Transport Request GRN/TR/2026/1');
  });
});
