import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/fuel/receipts/[id]/evidence/route.ts'),
  'utf8',
);

describe('fuel receipt evidence UUID guard', () => {
  it('keeps authentication, permission and storage checks before id validation', () => {
    const authIndex = source.indexOf('const auth = await requireRequestAuth(request)');
    const permissionIndex = source.indexOf('if (!canManage && !canVerify && !canDriverFuel)');
    const storageIndex = source.indexOf('if (!isStorageConfigured())');
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = source.indexOf('const db = getDb();', guardIndex);

    expect(source).toContain('const UUID_PATTERN =');
    expect(permissionIndex).toBeGreaterThan(authIndex);
    expect(storageIndex).toBeGreaterThan(permissionIndex);
    expect(guardIndex).toBeGreaterThan(storageIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
  });

  it('uses the existing privacy-safe not-found response for malformed ids', () => {
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(id))');
    const scopeIndex = source.indexOf('const scope =', guardIndex);
    const guardBlock = source.slice(guardIndex, scopeIndex);

    expect(guardBlock).toContain("{ error: 'Receipt evidence not found' }");
    expect(guardBlock).toContain('{ status: 404 }');
  });
});
