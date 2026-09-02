import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';

describe('database error details', () => {
  it('extracts database code and lifecycle marker from a wrapped Neon/Drizzle cause', () => {
    const error = new Error('Failed query');
    (error as Error & { cause?: unknown }).cause = {
      code: '23514',
      message: 'incident_technical_clearance_blocked',
    };

    expect(getDatabaseErrorDetails(error)).toEqual({
      code: '23514',
      message: expect.stringContaining('incident_technical_clearance_blocked'),
    });
  });

  it('traverses an additional wrapper while preserving the database marker', () => {
    const error = new Error('Drizzle query failed');
    (error as Error & { cause?: unknown }).cause = {
      message: 'Neon request failed',
      cause: {
        code: '23514',
        message: 'incident_investigation_close_conflict',
      },
    };

    const details = getDatabaseErrorDetails(error);
    expect(details.code).toBe('23514');
    expect(details.message).toContain('Drizzle query failed');
    expect(details.message).toContain('Neon request failed');
    expect(details.message).toContain('incident_investigation_close_conflict');
  });

  it('preserves top-level database details', () => {
    expect(getDatabaseErrorDetails({ code: '23505', message: 'duplicate sync token' })).toEqual({
      code: '23505',
      message: expect.stringContaining('duplicate sync token'),
    });
  });

  it('stops safely on a circular cause chain', () => {
    const error: { message: string; cause?: unknown } = { message: 'outer' };
    error.cause = error;
    expect(getDatabaseErrorDetails(error).message).toContain('outer');
  });
});

const reviewRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/review/route.ts'),
  'utf8',
);
const clearanceRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/technical-clearance/route.ts'),
  'utf8',
);

describe('incident review wrapped-conflict response contract', () => {
  it('uses flattened database errors for every unified review conflict marker', () => {
    expect(reviewRouteSource).toContain('getDatabaseErrorDetails(error)');
    expect(reviewRouteSource).toContain("message.includes('incident_investigation_update_conflict')");
    expect(reviewRouteSource).toContain("message.includes('incident_investigation_close_conflict')");
    expect(reviewRouteSource).toContain("message.includes('incident_technical_clearance_blocked')");
    expect(reviewRouteSource).toContain("message.includes('atomic_vehicle_return_to_service_failed')");
  });

  it('uses flattened database errors for dedicated technical-clearance conflicts', () => {
    expect(clearanceRouteSource).toContain('getDatabaseErrorDetails(error)');
    expect(clearanceRouteSource).toContain("message.includes('incident_technical_clearance_revocation_blocked')");
    expect(clearanceRouteSource).toContain("message.includes('incident_technical_clearance_blocked')");
    expect(clearanceRouteSource).toContain('{ status: 409 }');
  });
});
