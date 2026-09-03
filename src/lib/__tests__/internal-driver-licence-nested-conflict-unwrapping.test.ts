import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/drivers/[id]/licences/route.ts'),
  'utf8',
);

describe('internal driver licence nested conflict recovery', () => {
  it('unwraps deeply nested PostgreSQL duplicate-key codes for concurrent version uploads', () => {
    const nested = new Error('outer wrapper', {
      cause: new Error('drizzle wrapper', {
        cause: Object.assign(new Error('duplicate key'), { code: '23505' }),
      }),
    });

    expect(getDatabaseErrorDetails(nested).code).toBe('23505');
    expect(routeSource).toContain("import { getDatabaseErrorDetails } from '@/lib/database-error-details';");
    expect(routeSource).toContain('const { code } = getDatabaseErrorDetails(error);');
    expect(routeSource).toContain("if (code === '23505')");
    expect(routeSource).not.toContain("if ((error as { code?: string })?.code === '23505')");
  });
});
