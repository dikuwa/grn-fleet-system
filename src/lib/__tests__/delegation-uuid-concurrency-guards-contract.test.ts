import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/app/api/delegations/route.ts'), 'utf8');
const post = source.slice(source.indexOf('export async function POST'), source.indexOf('export async function PATCH'));
const patch = source.slice(source.indexOf('export async function PATCH'));

describe('delegation UUID and concurrency guards', () => {
  it('keeps POST field/date validation before tenant-owned UUID guards and DB access', () => {
    const authIndex = post.indexOf('const auth = await requireRequestAuth(request)');
    const actionIndex = post.indexOf("requireDashboardAction(auth.session, '/dashboard/delegations', 'create')");
    const permissionIndex = post.indexOf('requirePermission(auth.session, Permissions.DELEGATION_MANAGE)');
    const requiredIndex = post.indexOf('if (!body.roleId || !body.actingEmployeeId');
    const dateIndex = post.indexOf('if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()))');
    const rangeIndex = post.indexOf('if (endAt <= startAt)');
    const roleEmployeeGuardIndex = post.indexOf('if (!UUID_PATTERN.test(body.roleId) || !UUID_PATTERN.test(body.actingEmployeeId))');
    const officeGuardIndex = post.indexOf('if (body.officeId && !UUID_PATTERN.test(body.officeId))');
    const departmentGuardIndex = post.indexOf('if (body.departmentId && !UUID_PATTERN.test(body.departmentId))');
    const regionGuardIndex = post.indexOf('if (body.regionId && !UUID_PATTERN.test(body.regionId))');
    const substantiveGuardIndex = post.indexOf('if (body.substantiveHolderEmployeeId && !UUID_PATTERN.test(body.substantiveHolderEmployeeId))');
    const dbIndex = post.indexOf('const db = getDb()');

    expect(source).toContain('const UUID_PATTERN =');
    expect(actionIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeGreaterThan(actionIndex);
    expect(requiredIndex).toBeGreaterThan(permissionIndex);
    expect(dateIndex).toBeGreaterThan(requiredIndex);
    expect(rangeIndex).toBeGreaterThan(dateIndex);
    expect(roleEmployeeGuardIndex).toBeGreaterThan(rangeIndex);
    expect(officeGuardIndex).toBeGreaterThan(roleEmployeeGuardIndex);
    expect(departmentGuardIndex).toBeGreaterThan(officeGuardIndex);
    expect(regionGuardIndex).toBeGreaterThan(departmentGuardIndex);
    expect(substantiveGuardIndex).toBeGreaterThan(regionGuardIndex);
    expect(dbIndex).toBeGreaterThan(substantiveGuardIndex);
  });

  it('preserves POST tenant ownership, login capability checks and conflict handling', () => {
    expect(post).toContain("{ error: 'Employee or role was not found in your organisation' }, { status: 404 }");
    expect(post).toContain("{ error: 'Office scope was not found in your organisation' }, { status: 404 }");
    expect(post).toContain("{ error: 'Department scope was not found in your organisation' }, { status: 404 }");
    expect(post).toContain("{ error: 'Region scope was not found in your organisation' }, { status: 404 }");
    expect(post).toContain("{ error: 'Substantive role holder was not found in your organisation' }, { status: 404 }");
    expect(post).toContain('An acting user with delegated system capabilities must have an active user account');
    expect(post).toContain('findDelegationConflicts({');
    expect(post).toContain('Delegation conflicts must be resolved or overridden');
    expect(post).toContain("action: 'delegation.created'");
  });

  it('keeps PATCH validation before the delegation UUID guard and DB access', () => {
    const authIndex = patch.indexOf('const auth = await requireRequestAuth(request)');
    const actionIndex = patch.indexOf("requireDashboardAction(auth.session, '/dashboard/delegations', 'update')");
    const permissionIndex = patch.indexOf('requirePermission(auth.session, Permissions.DELEGATION_MANAGE)');
    const requiredIndex = patch.indexOf("if (!body.id || !body.reason?.trim())");
    const actionValidationIndex = patch.indexOf("if (!['revoke', 'cancel'].includes(body.action))");
    const guardIndex = patch.indexOf('if (!UUID_PATTERN.test(body.id))');
    const dbIndex = patch.indexOf('const db = getDb()');

    expect(actionIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeGreaterThan(actionIndex);
    expect(requiredIndex).toBeGreaterThan(permissionIndex);
    expect(actionValidationIndex).toBeGreaterThan(requiredIndex);
    expect(guardIndex).toBeGreaterThan(actionValidationIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(patch).toContain("{ error: 'Delegation not found' }, { status: 404 }");
  });

  it('claims the previously observed status atomically and maps a stale write to 409 before audit', () => {
    const updateIndex = patch.indexOf('const [updated] = await db.update(roleDelegations)');
    const statusClaimIndex = patch.indexOf('eq(roleDelegations.status, existing.status)');
    const returningIndex = patch.indexOf('.returning({ id: roleDelegations.id })');
    const staleIndex = patch.indexOf('if (!updated)');
    const auditIndex = patch.indexOf('await recordAuditEvent({');

    expect(updateIndex).toBeGreaterThan(0);
    expect(statusClaimIndex).toBeGreaterThan(updateIndex);
    expect(returningIndex).toBeGreaterThan(statusClaimIndex);
    expect(staleIndex).toBeGreaterThan(returningIndex);
    expect(auditIndex).toBeGreaterThan(staleIndex);
    expect(patch).toContain('This delegation changed while the action was being recorded. Refresh and try again.');
    expect(patch).toContain('{ status: 409 }');
    expect(patch).toContain("if (body.action === 'cancel' && existing.status === 'active')");
    expect(patch).toContain("if (body.action === 'revoke' && existing.status === 'scheduled')");
  });
});
