import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/platform/tenants/[id]/return-for-changes/route.ts'),
  'utf8',
);

describe('platform return-for-changes lifecycle compare-and-set', () => {
  it('claims the exact reviewed lifecycle before returning the tenant to setup', () => {
    const transaction = source.indexOf('const transitionClaimed = await db.transaction');
    const update = source.indexOf('const [returnedTenant] = await tx', transaction);
    const tenantIdClaim = source.indexOf('eq(tenants.id, id)', update);
    const lifecycleClaim = source.indexOf('eq(tenants.lifecycleStatus, tenant.lifecycleStatus)', tenantIdClaim);
    const returning = source.indexOf('.returning({ id: tenants.id })', lifecycleClaim);
    const audit = source.indexOf('await recordAuditEvent', returning);

    expect(transaction).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(transaction);
    expect(tenantIdClaim).toBeGreaterThan(update);
    expect(lifecycleClaim).toBeGreaterThan(tenantIdClaim);
    expect(returning).toBeGreaterThan(lifecycleClaim);
    expect(audit).toBeGreaterThan(returning);
  });

  it('returns a controlled conflict when the lifecycle claim is lost', () => {
    expect(source).toContain('if (!transitionClaimed)');
    expect(source).toContain('This tenant lifecycle changed while the return-for-changes action was being prepared.');
    expect(source).toContain('{ status: 409 }');
  });
});
