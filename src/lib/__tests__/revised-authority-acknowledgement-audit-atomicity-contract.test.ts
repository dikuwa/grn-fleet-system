import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/amendment-acceptance/route.ts'),
  'utf8',
);

describe('revised Trip Authority acknowledgement audit atomicity', () => {
  it('commits the acknowledgement claim and audit event in the same database transaction', () => {
    const transactionStart = routeSource.indexOf('await db.transaction(async (tx) => {');
    const claimStart = routeSource.indexOf('await tx.execute(sql`', transactionStart);
    const auditStart = routeSource.indexOf('await recordAuditEvent(', claimStart);
    const transactionEnd = routeSource.indexOf('\n    });', auditStart);

    expect(transactionStart).toBeGreaterThan(-1);
    expect(claimStart).toBeGreaterThan(transactionStart);
    expect(auditStart).toBeGreaterThan(claimStart);
    expect(transactionEnd).toBeGreaterThan(auditStart);

    const transactionSource = routeSource.slice(transactionStart, transactionEnd);
    expect(transactionSource).toContain("eventType: 'trip_authority_amendment_acknowledged'");
    expect(transactionSource).toContain("entityType: 'trip_amendment'");
    expect(transactionSource).toContain('tx,');
  });

  it('does not allow a committed acknowledgement to ignore audit failure', () => {
    expect(routeSource).not.toContain('Acknowledgement committed but audit event failed');
    expect(routeSource).not.toMatch(/recordAuditEvent\([\s\S]*?\)\.catch\(/);
  });

  it('retains the existing atomic conflict marker and controlled 409 recovery', () => {
    expect(routeSource).toContain('atomic_amendment_acknowledgement_failed_');
    expect(routeSource).toContain("message.includes('atomic_amendment_acknowledgement_failed')");
    expect(routeSource).toContain('{ status: 409 }');
  });
});
