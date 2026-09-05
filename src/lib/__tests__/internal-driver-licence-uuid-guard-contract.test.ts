import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/drivers/[id]/licences/route.ts'),
  'utf8',
);

describe('internal driver licence UUID guard', () => {
  it('keeps authentication ahead of the employee id guard and database lookup', () => {
    const accessIndex = source.indexOf('async function access(request: NextRequest, employeeId: string)');
    const authIndex = source.indexOf('const auth = await requireRequestAuth(request)', accessIndex);
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(employeeId))', accessIndex);
    const dbIndex = source.indexOf('const db = getDb();', accessIndex);

    expect(source).toContain('const UUID_PATTERN =');
    expect(authIndex).toBeGreaterThan(accessIndex);
    expect(guardIndex).toBeGreaterThan(authIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
  });

  it('reuses the existing driver-not-found privacy surface', () => {
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(employeeId))');
    const dbIndex = source.indexOf('const db = getDb();', guardIndex);
    const guardBlock = source.slice(guardIndex, dbIndex);

    expect(guardBlock).toContain("{ error: 'Driver not found' }");
    expect(guardBlock).toContain('{ status: 404 }');
  });

  it('routes GET, POST and PATCH through the guarded access helper', () => {
    const getIndex = source.indexOf('export async function GET');
    const postIndex = source.indexOf('export async function POST');
    const patchIndex = source.indexOf('export async function PATCH');

    expect(source.indexOf('const auth = await access(request, id)', getIndex)).toBeGreaterThan(getIndex);
    expect(source.indexOf('const auth = await access(request, id)', postIndex)).toBeGreaterThan(postIndex);
    expect(source.indexOf('const auth = await access(request, id)', patchIndex)).toBeGreaterThan(patchIndex);
  });
});
