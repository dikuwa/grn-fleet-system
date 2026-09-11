import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readRoute = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const decommissionSource = readRoute('src/app/api/fleet/[id]/decommission/route.ts');
const odometerSource = readRoute('src/app/api/fleet/[id]/odometer/route.ts');
const transferSource = readRoute('src/app/api/fleet/[id]/transfer/route.ts');

describe('fleet operational malformed-id guards', () => {
  it.each([
    ['decommission', decommissionSource, 'Permissions.VEHICLE_MANAGE'],
    ['odometer', odometerSource, 'Permissions.VEHICLE_VIEW'],
    ['transfer', transferSource, 'Permissions.VEHICLE_MANAGE'],
  ])('guards %s vehicle ids after authorization and before database access', (_name, source, permission) => {
    const authIndex = source.indexOf('const auth = await requireRequestAuth');
    const permissionIndex = source.indexOf(permission);
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = source.indexOf('const db = getDb();');

    expect(source).toContain('const UUID_PATTERN =');
    expect(permissionIndex).toBeGreaterThan(authIndex);
    expect(guardIndex).toBeGreaterThan(permissionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(source.slice(guardIndex, dbIndex)).toContain("{ error: 'Vehicle ID is invalid' }");
    expect(source.slice(guardIndex, dbIndex)).toContain('{ status: 400 }');
  });

  it('rejects malformed transfer office ids before the tenant-scoped office query', () => {
    const officeGuardIndex = transferSource.indexOf('if (!UUID_PATTERN.test(targetOfficeId))');
    const officeQueryIndex = transferSource.indexOf('const [targetOffice] = await db', officeGuardIndex);
    const guardBlock = transferSource.slice(officeGuardIndex, officeQueryIndex);

    expect(officeGuardIndex).toBeGreaterThan(-1);
    expect(officeQueryIndex).toBeGreaterThan(officeGuardIndex);
    expect(guardBlock).toContain("{ error: 'Target office not found in your tenant' }");
    expect(guardBlock).toContain('{ status: 404 }');
    expect(transferSource.slice(officeQueryIndex)).toContain('eq(offices.tenantId, session.tenantId)');
  });
});
