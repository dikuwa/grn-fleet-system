export const REPORT_PERIOD_OPTIONS = [
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: '90d', label: 'Last Quarter' },
  { value: '1y', label: 'Last 12 Months' },
] as const;

export type ReportPeriod = (typeof REPORT_PERIOD_OPTIONS)[number]['value'];

export function reportPeriodLabel(period: string): string {
  return REPORT_PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? 'Last 30 Days';
}
