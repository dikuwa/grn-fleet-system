import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/close/route.ts'),
  'utf8',
);

describe('trip close nested conflict recovery', () => {
  it('unwraps deeply nested closure lifecycle markers', () => {
    const nested = new Error('outer wrapper', {
      cause: new Error('drizzle wrapper', {
        cause: new Error('trip_closure_lifecycle_conflict'),
      }),
    });

    expect(getDatabaseErrorDetails(nested).message).toContain('trip_closure_lifecycle_conflict');
    expect(routeSource).toContain("import { getDatabaseErrorDetails } from '@/lib/database-error-details';");
    expect(routeSource).toContain('const { code, message } = getDatabaseErrorDetails(error);');
    expect(routeSource).toContain("message.includes('trip_closure_lifecycle_conflict')");
    expect(routeSource).toContain("message.includes('trip_closure_transition_conflict')");
    expect(routeSource).toContain("message.includes('closure_decision_conflict')");
    expect(routeSource).not.toContain('function postgresErrorCode(');
    expect(routeSource).not.toContain('function errorText(');
  });

  it('unwraps deeply nested duplicate-key codes for already-closed races', () => {
    const nested = new Error('outer wrapper', {
      cause: new Error('drizzle wrapper', {
        cause: Object.assign(new Error('duplicate closure'), { code: '23505' }),
      }),
    });

    expect(getDatabaseErrorDetails(nested).code).toBe('23505');
    expect(routeSource).toContain("if (code === '23505')");
    expect(routeSource).toContain("{ error: 'Trip is already closed' }");
  });
});
