import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/authority/amendments/route.ts'),
  'utf8',
);

describe('Trip Authority amendment UUID guards', () => {
  it('keeps POST permission and amendment validation before guarding DB access', () => {
    const postIndex = route.indexOf('export async function POST');
    const permissionIndex = route.indexOf('const permission = await requirePermission(session, Permissions.TRIP_MANAGE)', postIndex);
    const requiredIndex = route.indexOf('if (!body.amendmentType || !supported.includes(body.amendmentType)', postIndex);
    const reasonIndex = route.indexOf('if (cleanReason.length > 1000)', postIndex);
    const guardIndex = route.indexOf('if (!UUID_PATTERN.test(id))', postIndex);
    const dbIndex = route.indexOf('const db = getDb()', postIndex);

    expect(route).toContain('const UUID_PATTERN =');
    expect(permissionIndex).toBeGreaterThan(postIndex);
    expect(requiredIndex).toBeGreaterThan(permissionIndex);
    expect(reasonIndex).toBeGreaterThan(requiredIndex);
    expect(guardIndex).toBeGreaterThan(reasonIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(route).toContain("{ error: 'Trip Authority not found' }, { status: 404 }");
  });

  it('keeps PATCH decision validation before guarding both route and body UUIDs', () => {
    const patchIndex = route.indexOf('export async function PATCH');
    const permissionIndex = route.indexOf('const permission = await requireAnyPermission', patchIndex);
    const requiredIndex = route.indexOf("if (!body.amendmentId || !['approve', 'reject'].includes(body.action || ''))", patchIndex);
    const commentIndex = route.indexOf('if (comment.length > 1000)', patchIndex);
    const guardIndex = route.indexOf('if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(body.amendmentId))', patchIndex);
    const dbIndex = route.indexOf('const db = getDb()', patchIndex);

    expect(permissionIndex).toBeGreaterThan(patchIndex);
    expect(requiredIndex).toBeGreaterThan(permissionIndex);
    expect(commentIndex).toBeGreaterThan(requiredIndex);
    expect(guardIndex).toBeGreaterThan(commentIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(route).toContain("{ error: 'Amendment not found' }, { status: 404 }");
  });

  it('preserves amendment lifecycle and concurrency conflict mappings', () => {
    expect(route).toContain('authority_amendment_lifecycle_conflict');
    expect(route).toContain('atomic_authority_amendment_failed');
    expect(route).toContain("code === '23505'");
    expect(route).toContain('{ status: 409 }');
  });
});
