import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/users/[id]/delegate/route.ts'),
  'utf8',
);

describe('acting Tenant Administrator delegation invariant', () => {
  it('loads the assignment role and target membership user before ending it', () => {
    const deleteRoute = source.indexOf('export async function DELETE');
    const roleName = source.indexOf('roleName: roles.name', deleteRoute);
    const membershipUser = source.indexOf('userId: tenantMemberships.userId', roleName);

    expect(roleName).toBeGreaterThan(deleteRoute);
    expect(membershipUser).toBeGreaterThan(roleName);
  });

  it('checks the locked final-admin invariant before ending an active acting admin assignment', () => {
    const transaction = source.indexOf('await db.transaction', source.indexOf('export async function DELETE'));
    const finalAdmin = source.indexOf('wouldDisableFinalActiveTenantAdministrator(', transaction);
    const update = source.indexOf('.update(roleAssignments)', finalAdmin);

    expect(finalAdmin).toBeGreaterThan(transaction);
    expect(update).toBeGreaterThan(finalAdmin);
  });

  it('keeps scheduled future cancellation outside the final-admin restriction', () => {
    const wasScheduled = source.indexOf('const wasScheduled =');
    const guard = source.indexOf("assignment.roleName === 'Tenant Administrator' && !wasScheduled", wasScheduled);

    expect(guard).toBeGreaterThan(wasScheduled);
  });

  it('maps final-admin protection to a controlled 409', () => {
    const resultBranch = source.indexOf("result === 'final-admin'");
    const message = source.indexOf('final active Tenant Administrator', resultBranch);
    const status = source.indexOf('{ status: 409 }', message);

    expect(resultBranch).toBeGreaterThan(-1);
    expect(message).toBeGreaterThan(resultBranch);
    expect(status).toBeGreaterThan(message);
  });
});
