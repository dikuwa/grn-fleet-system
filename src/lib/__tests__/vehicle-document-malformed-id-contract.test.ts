import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const documentsSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/[id]/documents/route.ts'),
  'utf8',
);
const verifySource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/[id]/documents/[documentId]/verify/route.ts'),
  'utf8',
);

describe('vehicle document malformed-id guards', () => {
  it('guards document list/upload vehicle ids after authorization and before database access', () => {
    expect(documentsSource).toContain('const UUID_PATTERN =');

    const getStart = documentsSource.indexOf('export async function GET');
    const postStart = documentsSource.indexOf('export async function POST');
    const getSource = documentsSource.slice(getStart, postStart);
    const postSource = documentsSource.slice(postStart);

    for (const source of [getSource, postSource]) {
      const authIndex = source.indexOf('const auth = await requireRequestAuth(request)');
      const permissionIndex = source.indexOf('Permissions.VEHICLE_UPDATE');
      const guardIndex = source.indexOf('if (!UUID_PATTERN.test(id))');
      const dbIndex = source.indexOf('const db = getDb();');

      expect(permissionIndex).toBeGreaterThan(authIndex);
      expect(guardIndex).toBeGreaterThan(permissionIndex);
      expect(dbIndex).toBeGreaterThan(guardIndex);
      expect(source.slice(guardIndex, dbIndex)).toContain("{ error: 'Vehicle ID is invalid' }");
      expect(source.slice(guardIndex, dbIndex)).toContain('{ status: 400 }');
    }
  });

  it('guards both verification path ids before body and database processing', () => {
    expect(verifySource).toContain('const UUID_PATTERN =');

    const authIndex = verifySource.indexOf('const auth = await requireRequestAuth(request)');
    const permissionIndex = verifySource.indexOf('Permissions.VEHICLE_UPDATE');
    const vehicleGuardIndex = verifySource.indexOf('if (!UUID_PATTERN.test(id))');
    const documentGuardIndex = verifySource.indexOf('if (!UUID_PATTERN.test(documentId))');
    const bodyIndex = verifySource.indexOf('const body = await request.json()');
    const dbIndex = verifySource.indexOf('const db = getDb();');

    expect(permissionIndex).toBeGreaterThan(authIndex);
    expect(vehicleGuardIndex).toBeGreaterThan(permissionIndex);
    expect(documentGuardIndex).toBeGreaterThan(vehicleGuardIndex);
    expect(bodyIndex).toBeGreaterThan(documentGuardIndex);
    expect(dbIndex).toBeGreaterThan(bodyIndex);

    const guardBlock = verifySource.slice(vehicleGuardIndex, bodyIndex);
    expect(guardBlock).toContain("{ error: 'Vehicle ID is invalid' }");
    expect(guardBlock).toContain("{ error: 'Vehicle document ID is invalid' }");
    expect(guardBlock.match(/\{ status: 400 \}/g)).toHaveLength(2);
  });
});
