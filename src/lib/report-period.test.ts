import { describe, expect, it } from 'vitest';
import { REPORT_PERIOD_OPTIONS, reportPeriodLabel } from './report-period';

describe('report period truthfulness', () => {
  it('labels the rolling 365-day option as Last 12 Months', () => {
    expect(reportPeriodLabel('1y')).toBe('Last 12 Months');
  });

  it('does not advertise an unsupported custom range', () => {
    expect(REPORT_PERIOD_OPTIONS.map((option) => option.value)).not.toContain('custom');
  });

  it('uses the canonical 30-day fallback label', () => {
    expect(reportPeriodLabel('unsupported')).toBe('Last 30 Days');
  });
});
