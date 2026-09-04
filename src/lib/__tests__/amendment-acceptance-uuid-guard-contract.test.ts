import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/amendment-acceptance/route.ts'),
  'utf8',
);

describe('amendment acceptance UUID guards', () => {
  it('keeps GET access checks before the privacy-preserving malformed-id guard and database access after it', () => {
    const getIndex = route.indexOf('export async function GET');
    const routeCheckIndex = route.indexOf("requireDashboardAction(session, '/dashboard/trips', 'view')", getIndex);
    const accessIndex = route.indexOf("if (!tripAccess.allowed || !tripAccess.actions.includes('view'))", getIndex);
    const guardIndex = route.indexOf('if (!UUID_PATTERN.test(tripId))', getIndex);
    const dbIndex = route.indexOf('const db = getDb()', getIndex);

    expect(route).toContain('const UUID_PATTERN =');
    expect(routeCheckIndex).toBeGreaterThan(getIndex);
    expect(accessIndex).toBeGreaterThan(routeCheckIndex);
    expect(guardIndex).toBeGreaterThan(accessIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(route.slice(guardIndex, dbIndex)).toContain("{ error: 'Trip Authority not found' }");
    expect(route.slice(guardIndex, dbIndex)).toContain('{ status: 404 }');
  });

  it('keeps POST body parsing before the privacy-preserving malformed-id guard and database context loading after it', () => {
    const postIndex = route.indexOf('export async function POST');
    const bodyIndex = route.indexOf('const body = (await request.json()', postIndex);
    const guardIndex = route.indexOf('if (!UUID_PATTERN.test(tripId))', postIndex);
    const dbIndex = route.indexOf('const db = getDb()', postIndex);
    const contextIndex = route.indexOf('const record = await loadAcceptanceContext', postIndex);

    expect(bodyIndex).toBeGreaterThan(postIndex);
    expect(guardIndex).toBeGreaterThan(bodyIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(contextIndex).toBeGreaterThan(dbIndex);
    expect(route.slice(guardIndex, dbIndex)).toContain("{ error: 'Trip Authority not found' }");
    expect(route.slice(guardIndex, dbIndex)).toContain('{ status: 404 }');
  });

  it('keeps UUID-backed acknowledgement claims and concurrency recovery behind the POST guard', () => {
    const postIndex = route.indexOf('export async function POST');
    const guardIndex = route.indexOf('if (!UUID_PATTERN.test(tripId))', postIndex);
    const firstTripCastIndex = route.indexOf('${tripId}::uuid', postIndex);
    const transactionIndex = route.indexOf('await db.transaction', postIndex);
    const conflictIndex = route.indexOf("message.includes('atomic_amendment_acknowledgement_failed')", postIndex);

    expect(firstTripCastIndex).toBeGreaterThan(guardIndex);
    expect(transactionIndex).toBeGreaterThan(guardIndex);
    expect(conflictIndex).toBeGreaterThan(transactionIndex);
    expect(route.slice(conflictIndex)).toContain('{ status: 409 }');
  });
});
