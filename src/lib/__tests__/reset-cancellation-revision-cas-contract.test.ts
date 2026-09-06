import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/data-reset/route.ts'),
  'utf8',
);

describe('tenant reset cancellation state claim', () => {
  it('cancels only the exact tenant reset state that was reviewed', () => {
    const current = source.indexOf('const [current] = await db');
    const update = source.indexOf('.update(tenantResetRequests)', current);
    const tenantFence = source.indexOf(
      'eq(tenantResetRequests.tenantId, auth.session.tenantId)',
      update,
    );
    const statusFence = source.indexOf(
      'eq(tenantResetRequests.status, current.status)',
      tenantFence,
    );
    const returning = source.indexOf('.returning()', statusFence);
    const staleConflict = source.indexOf('if (!updated)', returning);
    const notification = source.indexOf('resolvePlatformResetRequestNotification(id)', staleConflict);
    const audit = source.indexOf("action: 'reset_request.cancelled'", notification);

    expect(current).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(current);
    expect(tenantFence).toBeGreaterThan(update);
    expect(statusFence).toBeGreaterThan(tenantFence);
    expect(returning).toBeGreaterThan(statusFence);
    expect(staleConflict).toBeGreaterThan(returning);
    expect(notification).toBeGreaterThan(staleConflict);
    expect(audit).toBeGreaterThan(notification);
    expect(source.slice(update, returning)).not.toContain('tenantResetRequests.updatedAt');
  });
});
