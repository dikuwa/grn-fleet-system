import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/authority/driver-replacement/route.ts'),
  'utf8',
);

describe('post-authorisation driver replacement UUID guards', () => {
  it('keeps GET authorisation before the trip-id guard and DB access after it', () => {
    const authIndex = route.indexOf('const auth = await requireDriverReplacementAuthoriser(request)');
    const paramsIndex = route.indexOf('const { id: tripId } = await params');
    const guardIndex = route.indexOf('if (!UUID_PATTERN.test(tripId))');
    const dbIndex = route.indexOf('const db = getDb()');

    expect(route).toContain('const UUID_PATTERN =');
    expect(authIndex).toBeGreaterThan(-1);
    expect(paramsIndex).toBeGreaterThan(authIndex);
    expect(guardIndex).toBeGreaterThan(paramsIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(route).toContain('return NextResponse.json({ pending: false, amendment: null });');
  });

  it('validates PATCH decision fields before guarding both trip and amendment IDs', () => {
    const patchIndex = route.indexOf('export async function PATCH');
    const authIndex = route.indexOf('const auth = await requireDriverReplacementAuthoriser(request)', patchIndex);
    const decisionValidationIndex = route.indexOf("if (!body.amendmentId || !['approve', 'reject'].includes(body.action || ''))", patchIndex);
    const commentValidationIndex = route.indexOf('if (comment.length > 1000)', patchIndex);
    const guardIndex = route.indexOf('if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(body.amendmentId))', patchIndex);
    const delegateIndex = route.indexOf('return decidePostAuthorisationDriverReplacement', patchIndex);

    expect(authIndex).toBeGreaterThan(patchIndex);
    expect(decisionValidationIndex).toBeGreaterThan(authIndex);
    expect(commentValidationIndex).toBeGreaterThan(decisionValidationIndex);
    expect(guardIndex).toBeGreaterThan(commentValidationIndex);
    expect(delegateIndex).toBeGreaterThan(guardIndex);
    expect(route).toContain("{ error: 'Driver replacement amendment not found.' }");
    expect(route).toContain('{ status: 404 }');
  });
});
