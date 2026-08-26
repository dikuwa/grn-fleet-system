import { describe, expect, it } from 'vitest';
import { isProgrammeEndDateCurrent } from './programme-availability';

describe('isProgrammeEndDateCurrent', () => {
  it('keeps a programme current for its full stated end date in Namibia', () => {
    const now = new Date('2026-08-27T20:00:00.000Z'); // 22:00 in Windhoek
    expect(isProgrammeEndDateCurrent(new Date('2026-08-27T00:00:00.000Z'), now)).toBe(true);
  });

  it('expires a programme on the following Namibia calendar day', () => {
    const now = new Date('2026-08-27T22:30:00.000Z'); // 00:30 on 28 August in Windhoek
    expect(isProgrammeEndDateCurrent(new Date('2026-08-27T00:00:00.000Z'), now)).toBe(false);
  });

  it('keeps programmes without an end date current', () => {
    expect(isProgrammeEndDateCurrent(null, new Date('2026-08-27T22:30:00.000Z'))).toBe(true);
  });

  it('rejects invalid persisted end-date values', () => {
    expect(isProgrammeEndDateCurrent('not-a-date', new Date('2026-08-27T12:00:00.000Z'))).toBe(false);
  });
});
