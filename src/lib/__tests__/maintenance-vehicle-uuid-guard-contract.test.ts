import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/maintenance/route.ts'),
  'utf8',
);

describe('maintenance vehicle UUID guard', () => {
  it('preserves business validation before rejecting malformed vehicle ids', () => {
    const authIndex = source.indexOf('const auth = await requireRequestAuth(req)');
    const roleIndex = source.indexOf("requireDashboardAction(session, '/dashboard/maintenance/new', 'create')");
    const serviceValidationIndex = source.indexOf('if (!SERVICE_TYPES.has(serviceType))');
    const numericValidationIndex = source.indexOf("serviceOdometer = optionalNonNegativeInteger(body.serviceOdometer, 'Service odometer')");
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(vehicleId))');
    const dbIndex = source.indexOf('const db = getDb();', guardIndex);

    expect(source).toContain('const UUID_PATTERN =');
    expect(roleIndex).toBeGreaterThan(authIndex);
    expect(serviceValidationIndex).toBeGreaterThan(roleIndex);
    expect(numericValidationIndex).toBeGreaterThan(serviceValidationIndex);
    expect(guardIndex).toBeGreaterThan(numericValidationIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
  });

  it('uses the existing privacy-safe maintenance-scope 404 response', () => {
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(vehicleId))');
    const dbIndex = source.indexOf('const db = getDb();', guardIndex);
    const guardBlock = source.slice(guardIndex, dbIndex);

    expect(guardBlock).toContain('Vehicle is not available in your current maintenance scope');
    expect(guardBlock).toContain('{ status: 404 }');
  });
});
