import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/external-parties/licences/[id]/review/route.ts'),
  'utf8',
);

describe('external driver licence review UUID guard', () => {
  it('keeps review validation before the UUID guard and database access behind it', () => {
    const authIndex = source.indexOf('const auth = await requireRequestAuth(request)');
    const permissionIndex = source.indexOf('const permissionCheck = await requireAnyPermission');
    const actionValidationIndex = source.indexOf("if (!action || !['verify', 'reject', 'request_upload'].includes(action))");
    const reasonValidationIndex = source.indexOf("if (action !== 'verify' && (reason.length < 5 || reason.length > 1000))");
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = source.indexOf('const db = getDb()');

    expect(source).toContain('const UUID_PATTERN =');
    expect(permissionIndex).toBeGreaterThan(authIndex);
    expect(actionValidationIndex).toBeGreaterThan(permissionIndex);
    expect(reasonValidationIndex).toBeGreaterThan(actionValidationIndex);
    expect(guardIndex).toBeGreaterThan(reasonValidationIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(source).toContain("{ error: 'External driver licence not found' }, { status: 404 }");
  });

  it('preserves terminal-state and stale-review concurrency protection', () => {
    expect(source).toContain('REVIEWABLE.has(record.licence.verificationStatus)');
    expect(source).toContain('eq(externalDriverLicences.verificationStatus, record.licence.verificationStatus)');
    expect(source).toContain('Licence changed while it was being reviewed. Refresh and try again.');
    expect(source).toContain('{ status: 409 }');
  });
});
