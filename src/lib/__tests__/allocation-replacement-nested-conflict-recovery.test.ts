import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/allocations/[id]/replace/route.ts'),
  'utf8',
);

describe('allocation replacement nested conflict recovery', () => {
  it('unwraps deeply nested PostgreSQL exclusion conflicts', () => {
    const postgres = Object.assign(new Error('allocation_vehicle_overlap'), { code: '23P01' });
    const drizzle = new Error('query failed', { cause: postgres });
    const routeWrapper = new Error('replacement mutation failed', { cause: drizzle });

    const details = getDatabaseErrorDetails(routeWrapper);
    expect(details.code).toBe('23P01');
    expect(details.message).toContain('allocation_vehicle_overlap');
  });

  it('uses the shared parser while preserving the replacement conflict response', () => {
    expect(routeSource).toContain("import { getDatabaseErrorDetails } from '@/lib/database-error-details';");
    expect(routeSource).toContain('const { code, message } = getDatabaseErrorDetails(error);');
    expect(routeSource).toContain("code === '23P01'");
    expect(routeSource).toContain("message.includes('allocation_vehicle_overlap')");
    expect(routeSource).toContain(
      'The replacement vehicle was allocated elsewhere while this replacement was being saved. Refresh and choose another available vehicle.',
    );
    expect(routeSource).toContain('{ status: 409 }');
  });

  it('removes the shallow local database-error parsing', () => {
    expect(routeSource).not.toContain('const dbError = error as');
    expect(routeSource).not.toContain('String(dbError.cause');
  });
});
