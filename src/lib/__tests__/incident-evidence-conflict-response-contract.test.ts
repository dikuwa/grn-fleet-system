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
const createIncidentSource = readFileSync(
  resolve(process.cwd(), 'src/lib/incidents/create-incident.ts'),
  'utf8',
);
const migrationSource = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0110_active_trip_evidence_claim_guard.sql'),
  'utf8',
);
const errorDetailsSource = readFileSync(
  resolve(process.cwd(), 'src/lib/database-error-details.ts'),
  'utf8',
);

describe('incident evidence conflict response contract', () => {
  it('maps authoritative incident evidence/lifecycle claim conflicts to HTTP 409 on both reporting APIs', () => {
    expect(migrationSource).toContain('trip_progress_lifecycle_conflict');
    expect(incidentRouteSource).toContain("import { getDatabaseErrorDetails } from '@/lib/database-error-details'");
    expect(incidentRouteSource).toContain('const { code, message } = getDatabaseErrorDetails(error);');
    expect(errorDetailsSource).toContain('depth < 4');
    expect(errorDetailsSource).toContain('visited.has(current)');
    expect(incidentRouteSource).toContain("code === '23514'");
    expect(incidentRouteSource).toContain("message.includes('trip_progress_lifecycle_conflict')");
    expect(incidentRouteSource).toContain('{ status: 409 }');
    expect(operationsRouteSource).toContain("message.includes('trip_progress_lifecycle_conflict')");
    expect(operationsRouteSource).toContain('{ status: 409 }');
  });

  it('recovers same-sync incident races when Neon wraps the unique violation', () => {
    expect(createIncidentSource).toContain('function getDatabaseErrorCode(error: unknown)');
    expect(createIncidentSource).toContain("typeof causeRecord.code === 'string'");
    expect(createIncidentSource).toContain("syncId && getDatabaseErrorCode(error) === '23505'");
    expect(createIncidentSource).toContain('eq(tripIncidents.tenantId, input.tenantId)');
    expect(createIncidentSource).toContain('eq(tripIncidents.tripId, input.tripId)');
    expect(createIncidentSource).toContain('eq(tripIncidents.clientSyncId, syncId)');
    expect(createIncidentSource).toContain('eq(tripIncidents.reportedByUserId, input.reportedByUserId)');
    expect(createIncidentSource).toContain('idempotent: true');
  });

  it('preserves genuine duplicate offline sync collision handling after scoped recovery fails', () => {
    expect(incidentRouteSource).toContain("code === '23505'");
    expect(incidentRouteSource).toContain('This offline incident sync ID is already used by another incident');
  });

  it('keeps unexpected database failures behind the generic 500 response', () => {
    expect(incidentRouteSource).toContain("console.error('[incidents] POST failed:', error)");
    expect(incidentRouteSource).toContain("{ error: 'Failed to create incident' }, { status: 500 }");
  });
});
