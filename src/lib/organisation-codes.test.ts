import { describe, expect, it } from 'vitest';
import { normaliseOrganisationCode, suggestOrganisationCode } from './organisation-codes';

describe('organisation code suggestions', () => {
  it.each([
    ['Head Office — Rundu', 'HOR'],
    ['Rundu Urban Constituency Office', 'RUO'],
    ['Mukwe Constituency Office', 'MKO'],
  ])('suggests a meaningful office code for %s', (name, expected) => {
    expect(suggestOrganisationCode(name, 'office')).toBe(expected);
  });

  it.each([
    ['Human Resources', 'HR'],
    ['Internal Audit', 'IA'],
    ['Transport and Fleet Management', 'TFM'],
    ['Office of the Chief Regional Officer', 'CRO'],
  ])('suggests a meaningful organisation-unit code for %s', (name, expected) => {
    expect(suggestOrganisationCode(name, 'department')).toBe(expected);
  });

  it('normalises manually entered codes', () => {
    expect(normaliseOrganisationCode(' tfm-2 ')).toBe('TFM2');
  });
});
