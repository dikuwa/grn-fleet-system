import { describe, expect, it } from 'vitest';
import { validateProgressOdometer } from './trip-progress-odometer';

describe('progress odometer chronology', () => {
  it('accepts a late offline event between its chronological neighbours', () => {
    expect(validateProgressOdometer({
      value: 100,
      previous: 90,
      next: 110,
      authorityStart: 80,
      authorityEnd: null,
    })).toEqual({ ok: true, floor: 90, ceiling: 110 });
  });

  it('rejects rollback below the previous chronological event', () => {
    const result = validateProgressOdometer({
      value: 89,
      previous: 90,
      next: 110,
      authorityStart: 80,
      authorityEnd: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('previous recorded reading (90)');
  });

  it('rejects a historical event above the next chronological event', () => {
    const result = validateProgressOdometer({
      value: 111,
      previous: 90,
      next: 110,
      authorityStart: 80,
      authorityEnd: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('next recorded reading (110)');
  });

  it('uses the Trip Authority reading when no earlier progress exists', () => {
    const result = validateProgressOdometer({
      value: 79,
      previous: null,
      next: 100,
      authorityStart: 80,
      authorityEnd: null,
    });
    expect(result.ok).toBe(false);
  });

  it('uses the final authority reading as a ceiling when no later progress exists', () => {
    const result = validateProgressOdometer({
      value: 121,
      previous: 110,
      next: null,
      authorityStart: 80,
      authorityEnd: 120,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('next recorded reading (120)');
  });
});
