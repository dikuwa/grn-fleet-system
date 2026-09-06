import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/data-reset/route.ts'),
  'utf8',
);

describe('tenant reset cancellation revision claim', () => {
  it('cancels only the exact tenant reset status and revision that was reviewed', () => {
    const current = source.indexOf('const [current] = await db');
    const update = source.indexOf('.update(tenantResetRequests)', current);
    const statusFence = source.indexOf(
      'eq(tenantResetRequests.status, current.status)',
      update,
    );
    const revisionFence = source.indexOf(
      'eq(tenantResetRequests.updatedAt, current.updatedAt)',
      statusFence,
    );
    const returning = source.indexOf('.returning()', revisionFence);
    const staleConflict = source.indexOf('if (!updated)', returning);
    const notification = source.indexOf('resolvePlatformResetRequestNotification(id)', staleConflict);
    const audit = source.indexOf("action: 'reset_request.cancelled'", notification);

    expect(current).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(current);
    expect(statusFence).toBeGreaterThan(update);
    expect(revisionFence).toBeGreaterThan(statusFence);
    expect(returning).toBeGreaterThan(revisionFence);
    expect(staleConflict).toBeGreaterThan(returning);
    expect(notification).toBeGreaterThan(staleConflict);
    expect(audit).toBeGreaterThan(notification);
  });
});
