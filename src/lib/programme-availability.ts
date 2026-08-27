import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

export const PROGRAMME_TIME_ZONE = 'Africa/Windhoek';

/**
 * Programme start/end fields are entered as calendar dates and persisted as
 * timestamps. Availability must therefore compare calendar dates, not the
 * exact midnight timestamp, otherwise a programme can expire at the start of
 * its stated final day.
 */
export function programmeEndDateCurrentSql(endDate: SQLWrapper): SQL {
  return sql`(${endDate} IS NULL OR (${endDate} AT TIME ZONE 'UTC')::date >= (now() AT TIME ZONE ${PROGRAMME_TIME_ZONE})::date)`;
}

function dateKeyInTimeZone(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Mirrors programmeEndDateCurrentSql for server-side capability calculations.
 * Stored programme calendar dates are interpreted by their UTC date component;
 * "today" is evaluated in Namibia's organisation timezone.
 */
export function isProgrammeEndDateCurrent(
  endDate: Date | string | null | undefined,
  now = new Date(),
): boolean {
  if (!endDate) return true;
  const parsed = endDate instanceof Date ? endDate : new Date(endDate);
  if (Number.isNaN(parsed.getTime())) return false;
  return dateKeyInTimeZone(parsed, 'UTC') >= dateKeyInTimeZone(now, PROGRAMME_TIME_ZONE);
}
