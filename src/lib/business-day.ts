/**
 * Business-Day Calendar Helpers
 *
 * Checks whether a given date is a business day for a tenant,
 * accounting for weekends (Sat/Sun) and stored tenant holidays.
 */

import { getDb } from '@/db';
import { tenantHolidays } from '@/db/schema/tenants';
import { and, eq, gte, lt } from 'drizzle-orm';

/**
 * Return true if `date` is a business day for the given tenant:
 * - Not Saturday or Sunday
 * - Not a tenant holiday or a yearly-recurring holiday on that day-of-year
 */
export async function isBusinessDay(
  tenantId: string,
  date: Date = new Date(),
): Promise<boolean> {
  // Weekend check
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false;

  // Holiday check
  const db = getDb();
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  // Exact-date holidays
  const exactHolidays = await db
    .select({ id: tenantHolidays.id })
    .from(tenantHolidays)
    .where(
      and(
        eq(tenantHolidays.tenantId, tenantId),
        gte(tenantHolidays.holidayDate, dayStart),
        lt(tenantHolidays.holidayDate, dayEnd),
      ),
    )
    .limit(1);

  if (exactHolidays.length > 0) return false;

  // Yearly-recurring holidays (match month + day) — single query
  const month = date.getMonth() + 1;
  const day = date.getDate();

  const recurringHolidays = await db
    .select({ holidayDate: tenantHolidays.holidayDate })
    .from(tenantHolidays)
    .where(
      and(
        eq(tenantHolidays.tenantId, tenantId),
        eq(tenantHolidays.isRecurringYearly, true),
      ),
    );

  for (const h of recurringHolidays) {
    const hMonth = h.holidayDate.getMonth() + 1;
    const hDay = h.holidayDate.getDate();
    if (hMonth === month && hDay === day) return false;
  }

  return true;
}

/**
 * Return the next business day from `date` (or today).
 * Keeps advancing one day at a time until a business day is found.
 */
export async function nextBusinessDay(
  tenantId: string,
  date: Date = new Date(),
): Promise<Date> {
  const next = new Date(date);
  while (!(await isBusinessDay(tenantId, next))) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

/**
 * Return the previous business day from `date` (or today).
 */
export async function previousBusinessDay(
  tenantId: string,
  date: Date = new Date(),
): Promise<Date> {
  const prev = new Date(date);
  while (!(await isBusinessDay(tenantId, prev))) {
    prev.setDate(prev.getDate() - 1);
  }
  return prev;
}
