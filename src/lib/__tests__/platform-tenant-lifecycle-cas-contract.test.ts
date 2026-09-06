import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/platform/tenants/[id]/route.ts'),
  'utf8',
);

describe('platform tenant lifecycle compare-and-set', () => {
  it('claims the lifecycle state that was validated before applying a transition', () => {
    const transition = source.indexOf('const lifecycleChanges =');
    const update = source.indexOf('const [updatedLifecycle] = await db', transition);
    const idClaim = source.indexOf('eq(tenants.id, id)', update);
    const stateClaim = source.indexOf('eq(tenants.lifecycleStatus, existing.lifecycleStatus)', idClaim);
    const returning = source.indexOf('.returning({ id: tenants.id })', stateClaim);

    expect(transition).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(transition);
    expect(idClaim).toBeGreaterThan(update);
    expect(stateClaim).toBeGreaterThan(idClaim);
    expect(returning).toBeGreaterThan(stateClaim);
  });

  it('returns 409 when a concurrent lifecycle transition wins first', () => {
    expect(source).toContain('if (!updatedLifecycle)');
    expect(source).toContain('This tenant lifecycle changed while the update was being prepared.');
    expect(source).toContain('{ status: 409 }');
  });

  it('keeps ordinary non-lifecycle tenant edits on the simple update path', () => {
    expect(source).toContain("if (lifecycleChanges) {");
    expect(source).toContain('await db.update(tenants).set(tenantUpdate).where(eq(tenants.id, id));');
  });
});
