import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/route.ts'),
  'utf8',
);

describe('incident collection trip id boundary contract', () => {
  it('preserves GET auth/workspace access before validating the trip filter', () => {
    const getRoute = source.indexOf('export async function GET');
    const access = source.indexOf('const access = await resolveIncidentAccess(session)', getRoute);
    const workspace = source.indexOf("resolveDashboardAccess('/dashboard/trips'", access);
    const tripId = source.indexOf("const tripId = searchParams.get('tripId')", workspace);
    const guard = source.indexOf('if (tripId && !UUID_PATTERN.test(tripId))', tripId);
    const db = source.indexOf('const db = getDb()', guard);

    expect(access).toBeGreaterThan(getRoute);
    expect(workspace).toBeGreaterThan(access);
    expect(tripId).toBeGreaterThan(workspace);
    expect(guard).toBeGreaterThan(tripId);
    expect(db).toBeGreaterThan(guard);
  });

  it('returns controlled 400 for a malformed GET trip filter before UUID-backed predicates', () => {
    const guard = source.indexOf('if (tripId && !UUID_PATTERN.test(tripId))');
    const error = source.indexOf('tripId must be a valid UUID', guard);
    const status = source.indexOf('{ status: 400 }', error);
    const predicate = source.indexOf('eq(tripIncidents.tripId, tripId)', status);

    expect(error).toBeGreaterThan(guard);
    expect(status).toBeGreaterThan(error);
    expect(predicate).toBeGreaterThan(status);
  });

  it('keeps POST required-trip validation before the UUID guard and database access', () => {
    const postRoute = source.indexOf('export async function POST');
    const required = source.indexOf("if (!tripId) return NextResponse.json({ error: 'Trip ID is required' }", postRoute);
    const guard = source.indexOf("typeof tripId !== 'string' || !UUID_PATTERN.test(tripId)", required);
    const notFound = source.indexOf("{ error: 'Trip not found' }", guard);
    const db = source.indexOf('const db = getDb()', guard);

    expect(required).toBeGreaterThan(postRoute);
    expect(guard).toBeGreaterThan(required);
    expect(notFound).toBeGreaterThan(guard);
    expect(db).toBeGreaterThan(notFound);
  });
});
