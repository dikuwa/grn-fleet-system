import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/drivers/[id]/licences/route.ts'),
  'utf8',
);
const terminalGuardMigration = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0052_driver_licence_terminal_review_guard.sql'),
  'utf8',
);

describe('driver licence review concurrency recovery', () => {
  it('serializes every review action against the exact revision that was read', () => {
    expect(routeSource).toContain('function licenceReviewRevisionGuard');
    expect(routeSource).toContain('FROM driver_licences');
    expect(routeSource).toContain('verification_status = ${current.verificationStatus}');
    expect(routeSource).toContain('updated_at = ${current.updatedAt.toISOString()}::timestamptz');
    expect(routeSource).toContain('FOR UPDATE');
    expect(routeSource).toContain("'driver_licence_review_conflict'");
    expect(routeSource.match(/licenceReviewRevisionGuard\(executor, current\)/g)?.length).toBe(3);
  });

  it('keeps the existing terminal-decision database claim as defense in depth', () => {
    expect(terminalGuardMigration).toContain('driver_licence_terminal_review_claims');
    expect(terminalGuardMigration).toContain("'driver_licence.verify'");
    expect(terminalGuardMigration).toContain("'driver_licence.approve'");
    expect(terminalGuardMigration).toContain("'driver_licence.reject'");
  });

  it('returns a controlled 409 for stale revisions and terminal claim losers', () => {
    expect(routeSource).toContain("message.includes('driver_licence_review_conflict')");
    expect(routeSource).toContain("code === '23505'");
    expect(routeSource).toContain("message.includes('driver_licence_terminal_review_claims')");
    expect(routeSource).toContain('This licence was changed by another review action. Refresh and review the latest version.');
    expect(routeSource).toContain('{ status: 409 }');
  });

  it('records the source revision in immutable review evidence', () => {
    expect(routeSource).toContain('updatedAt: current.updatedAt.toISOString()');
  });
});
