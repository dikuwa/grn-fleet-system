import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/[id]/route.ts'),
  'utf8',
);

describe('generic fleet editor operational status guard', () => {
  it('claims the exact vehicle revision before any generic update can commit', () => {
    expect(routeSource).toContain('updatedAt: vehicles.updatedAt');
    expect(routeSource).toContain("date_trunc('milliseconds', ${vehicles.updatedAt})");
    expect(routeSource).toContain('${existing.updatedAt.toISOString()}::timestamptz');
    expect(routeSource).toContain('if (!updated) throw new Error(VEHICLE_UPDATE_CONFLICT);');
    expect(routeSource).toContain("const VEHICLE_UPDATE_CONFLICT = 'vehicle_update_conflict';");
    expect(routeSource).toContain('{ status: 409 }');
  });

  it('does not let ordinary profile editing resurrect protected operational states', () => {
    expect(routeSource).toContain(
      "const PROTECTED_REACTIVATION_STATUSES = new Set(['maintenance', 'out_of_service', 'written_off']);",
    );
    expect(routeSource).toContain('PROTECTED_REACTIVATION_STATUSES.has(existing.status)');
    expect(routeSource).toContain(
      'Return this vehicle to service through the maintenance/defect resolution workflow so current safety blockers are rechecked.',
    );
    expect(routeSource).toContain(
      'A written-off vehicle cannot be reactivated through the general vehicle editor.',
    );
  });

  it('routes out-of-service transitions through the audited decommission workflow', () => {
    expect(routeSource).toContain("requestedStatus === 'out_of_service'");
    expect(routeSource).toContain(
      'Use the audited decommission workflow to place a vehicle out of service.',
    );
  });

  it('keeps audit evidence in the same database transaction as the claimed update', () => {
    const transactionStart = routeSource.indexOf('await db.transaction(async (tx) => {');
    const updateStart = routeSource.indexOf('.update(vehicles)', transactionStart);
    const auditStart = routeSource.indexOf('await recordAuditEvent(', updateStart);
    const transactionEnd = routeSource.indexOf('\n    });', auditStart);

    expect(transactionStart).toBeGreaterThan(-1);
    expect(updateStart).toBeGreaterThan(transactionStart);
    expect(auditStart).toBeGreaterThan(updateStart);
    expect(transactionEnd).toBeGreaterThan(auditStart);
    expect(routeSource.slice(auditStart, transactionEnd)).toContain('tx,');
  });
});
