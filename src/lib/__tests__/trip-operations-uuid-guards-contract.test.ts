import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/operations/route.ts'),
  'utf8',
);

describe('trip operations UUID guards', () => {
  it('keeps action and timestamp validation before guarding trip DB access', () => {
    const postIndex = route.indexOf('export async function POST');
    const routeCheckIndex = route.indexOf("requireDashboardAction(session, '/dashboard/trips', 'update')", postIndex);
    const actionIndex = route.indexOf("if (!['progress', 'expense', 'incident'].includes(action))", postIndex);
    const occurredAtIndex = route.indexOf("if (Number.isNaN(occurredAt.getTime())", postIndex);
    const offlineIndex = route.indexOf('if (body.offlineCreatedAt && !offlineCreatedAt)', postIndex);
    const guardIndex = route.indexOf('if (!UUID_PATTERN.test(id))', postIndex);
    const dbIndex = route.indexOf('const db = getDb()', postIndex);

    expect(route).toContain('const UUID_PATTERN =');
    expect(routeCheckIndex).toBeGreaterThan(postIndex);
    expect(actionIndex).toBeGreaterThan(routeCheckIndex);
    expect(occurredAtIndex).toBeGreaterThan(actionIndex);
    expect(offlineIndex).toBeGreaterThan(occurredAtIndex);
    expect(guardIndex).toBeGreaterThan(offlineIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(route).toContain("{ error: 'Trip not found' }, { status: 404 }");
  });

  it('guards optional incident dailyLogEntryId before central incident creation', () => {
    const incidentIndex = route.indexOf("const incidentType = String(body.incidentType || '').trim()");
    const odometerIndex = route.indexOf("if (odometer !== null && (!Number.isInteger(odometer)", incidentIndex);
    const normalizeIndex = route.indexOf('const dailyLogEntryId = body.dailyLogEntryId', incidentIndex);
    const guardIndex = route.indexOf('if (dailyLogEntryId && !UUID_PATTERN.test(dailyLogEntryId))', incidentIndex);
    const categoryIndex = route.indexOf('const category = await getIncidentCategory', incidentIndex);
    const createIndex = route.indexOf('const result = await createIncident({', incidentIndex);

    expect(odometerIndex).toBeGreaterThan(incidentIndex);
    expect(normalizeIndex).toBeGreaterThan(odometerIndex);
    expect(guardIndex).toBeGreaterThan(normalizeIndex);
    expect(categoryIndex).toBeGreaterThan(guardIndex);
    expect(createIndex).toBeGreaterThan(categoryIndex);
    expect(route).toContain("{ error: 'Daily log entry ID is invalid' }, { status: 422 }");
    expect(route).toContain('dailyLogEntryId,');
  });

  it('preserves offline idempotency and lifecycle conflict mappings', () => {
    expect(route).toContain('idempotentReplay: true');
    expect(route).toContain('trip_progress_lifecycle_conflict');
    expect(route).toContain('trip_progress_odometer_conflict');
    expect(route).toContain('trip_expense_lifecycle_conflict');
    expect(route).toContain("code === '23505'");
    expect(route).toContain('{ status: 409 }');
  });
});
