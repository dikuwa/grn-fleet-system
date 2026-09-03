import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/operations/route.ts'),
  'utf8',
);

describe('trip operations nested conflict recovery', () => {
  it('unwraps deeply nested lifecycle conflict markers', () => {
    const nested = new Error('outer wrapper', {
      cause: new Error('drizzle wrapper', {
        cause: new Error('trip_progress_lifecycle_conflict'),
      }),
    });

    expect(getDatabaseErrorDetails(nested).message).toContain('trip_progress_lifecycle_conflict');
    expect(routeSource).toContain("import { getDatabaseErrorDetails } from '@/lib/database-error-details';");
    expect(routeSource).toContain('const { message, code } = getDatabaseErrorDetails(error);');
    expect(routeSource).toContain("message.includes('trip_progress_lifecycle_conflict')");
    expect(routeSource).toContain("message.includes('trip_expense_lifecycle_conflict')");
  });

  it('unwraps deeply nested PostgreSQL duplicate codes for offline replay conflicts', () => {
    const nested = new Error('outer wrapper', {
      cause: new Error('drizzle wrapper', {
        cause: Object.assign(new Error('duplicate key'), { code: '23505' }),
      }),
    });

    expect(getDatabaseErrorDetails(nested).code).toBe('23505');
    expect(routeSource).toContain("if (code === '23505')");
    expect(routeSource).toContain("status: 409");
    expect(routeSource).not.toContain('const causeRecord =');
  });
});
