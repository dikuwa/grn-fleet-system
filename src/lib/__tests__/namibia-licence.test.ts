import { describe, expect, it } from 'vitest';
import {
  anyNamibiaLicenceClassCovers,
  namibiaLicenceClassCovers,
  normalizeNamibiaLicenceClass,
} from '@/lib/namibia-licence';

describe('Namibia driving licence class coverage', () => {
  it('normalizes historical aliases used on licence records', () => {
    expect(normalizeNamibiaLicenceClass(' eb ')).toBe('BE');
    expect(normalizeNamibiaLicenceClass('EC')).toBe('CE');
    expect(normalizeNamibiaLicenceClass('CE1')).toBe('C1E');
  });

  it('allows higher heavy-vehicle classes to cover their lower authorised classes', () => {
    expect(namibiaLicenceClassCovers('C', 'C1')).toBe(true);
    expect(namibiaLicenceClassCovers('C', 'B')).toBe(true);
    expect(namibiaLicenceClassCovers('CE', 'C')).toBe(true);
    expect(namibiaLicenceClassCovers('CE', 'C1E')).toBe(true);
    expect(namibiaLicenceClassCovers('CE', 'BE')).toBe(true);
    expect(namibiaLicenceClassCovers('CE', 'B')).toBe(true);
  });

  it('does not allow a lower class to operate a higher required class', () => {
    expect(namibiaLicenceClassCovers('B', 'C1')).toBe(false);
    expect(namibiaLicenceClassCovers('C1', 'C')).toBe(false);
    expect(namibiaLicenceClassCovers('BE', 'C1E')).toBe(false);
  });

  it('keeps motorcycle classes separate from motor-vehicle classes', () => {
    expect(namibiaLicenceClassCovers('A', 'A1')).toBe(true);
    expect(namibiaLicenceClassCovers('A', 'B')).toBe(false);
    expect(namibiaLicenceClassCovers('CE', 'A1')).toBe(false);
  });

  it('supports checking multiple recorded driver classes', () => {
    expect(anyNamibiaLicenceClassCovers(['A', 'C1'], 'B')).toBe(true);
    expect(anyNamibiaLicenceClassCovers(['A', 'B'], 'C1')).toBe(false);
    expect(anyNamibiaLicenceClassCovers([], null)).toBe(true);
  });
});
