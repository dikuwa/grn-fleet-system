import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const incidentRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/route.ts'),
  'utf8',
);
const operationsRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/operations/route.ts'),
  'utf8',
);
const migrationSource = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0110_active_trip_evidence_claim_guard.sql'),
  'utf8',
);

describe('incident evidence conflict response contract', () => {
  it('maps authoritative incident evidence/lifecycle claim conflicts to HTTP 409 on both reporting APIs', () => {
    expect(migrationSource).toContain('trip_progress_lifecycle_conflict');
    expect(incidentRouteSource).toContain("errorRecord?.cause && typeof errorRecord.cause === 'object'");
    expect(incidentRouteSource).toContain('causeRecord?.code');
    expect(incidentRouteSource).toContain('causeRecord?.message');
    expect(incidentRouteSource).toContain("code === '23514'");
    expect(incidentRouteSource).toContain("message.includes('trip_progress_lifecycle_conflict')");
    expect(incidentRouteSource).toContain('{ status: 409 }');
    expect(operationsRouteSource).toContain("message.includes('trip_progress_lifecycle_conflict')");
    expect(operationsRouteSource).toContain('{ status: 409 }');
  });

  it('preserves duplicate offline sync handling for wrapped database errors', () => {
    expect(incidentRouteSource).toContain("code === '23505'");
    expect(incidentRouteSource).toContain('This offline incident sync ID is already used by another incident');
  });

  it('keeps unexpected database failures behind the generic 500 response', () => {
    expect(incidentRouteSource).toContain("console.error('[incidents] POST failed:', error)");
    expect(incidentRouteSource).toContain("{ error: 'Failed to create incident' }, { status: 500 }");
  });
});
