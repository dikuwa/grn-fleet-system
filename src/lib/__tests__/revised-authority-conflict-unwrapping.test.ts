import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/amendment-acceptance/route.ts'),
  'utf8',
);

describe('revised Trip Authority conflict recovery', () => {
  it('unwraps nested database causes so atomic acknowledgement conflicts stay recoverable', () => {
    const nested = new Error('outer database wrapper', {
      cause: new Error('drizzle query failed', {
        cause: new Error('invalid input syntax for type integer: atomic_amendment_acknowledgement_failed_0111'),
      }),
    });

    const details = getDatabaseErrorDetails(nested);
    expect(details.message).toContain('atomic_amendment_acknowledgement_failed');
  });

  it('uses the shared nested database error parser instead of String(error)', () => {
    expect(routeSource).toContain("import { getDatabaseErrorDetails } from '@/lib/database-error-details';");
    expect(routeSource).toContain('const { message } = getDatabaseErrorDetails(error);');
    expect(routeSource).toContain("message.includes('atomic_amendment_acknowledgement_failed')");
    expect(routeSource).not.toContain("String(error).includes('atomic_amendment_acknowledgement_failed')");
  });
});
