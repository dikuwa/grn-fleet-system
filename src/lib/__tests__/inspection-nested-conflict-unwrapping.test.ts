import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/inspections/route.ts'),
  'utf8',
);

describe('inspection nested database conflict recovery', () => {
  it('unwraps lifecycle, evidence and odometer markers from nested database causes', () => {
    for (const marker of [
      'inspection_lifecycle_conflict',
      'inspection_evidence_claim_conflict',
      'vehicle_odometer_regression',
    ]) {
      const nested = Object.assign(new Error('outer wrapper', {
        cause: Object.assign(new Error('drizzle wrapper', {
          cause: new Error(`check violation: ${marker}`),
        }), { code: '23514' }),
      }), {});
      const details = getDatabaseErrorDetails(nested);
      expect(details.code).toBe('23514');
      expect(details.message).toContain(marker);
    }
  });

  it('uses the shared nested parser for controlled 409 conflicts', () => {
    expect(routeSource).toContain("import { getDatabaseErrorDetails } from '@/lib/database-error-details';");
    expect(routeSource).toContain('const { code, message } = getDatabaseErrorDetails(error);');
    expect(routeSource).not.toContain('function postgresErrorCode(');
    expect(routeSource).not.toContain('function errorText(');
    expect(routeSource).toContain("message.includes('inspection_lifecycle_conflict')");
    expect(routeSource).toContain("message.includes('inspection_evidence_claim_conflict')");
    expect(routeSource).toContain("message.includes('vehicle_odometer_regression')");
  });
});
