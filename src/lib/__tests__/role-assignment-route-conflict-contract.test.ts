import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const userRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/users/[id]/route.ts'),
  'utf8',
);
const delegationRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/users/[id]/delegate/route.ts'),
  'utf8',
);

describe('role assignment database overlap conflict routing', () => {
  it('maps normal role assignment exclusion conflicts to the existing overlap 409', () => {
    expect(userRoute).toContain("import { isRoleAssignmentWindowConflict } from '@/lib/role-assignment-integrity'");
    const catchBranch = userRoute.indexOf('isRoleAssignmentWindowConflict(error)');
    const message = userRoute.indexOf('This user already holds the selected role during part or all of the requested period', catchBranch);
    const status = userRoute.indexOf('{ status: 409 }', message);

    expect(catchBranch).toBeGreaterThan(-1);
    expect(message).toBeGreaterThan(catchBranch);
    expect(status).toBeGreaterThan(message);
  });

  it('maps delegation exclusion conflicts to the existing overlap 409', () => {
    expect(delegationRoute).toContain("import { isRoleAssignmentWindowConflict } from '@/lib/role-assignment-integrity'");
    const catchBranch = delegationRoute.indexOf('isRoleAssignmentWindowConflict(error)');
    const message = delegationRoute.indexOf('The target user already holds this role during part or all of the requested delegation period', catchBranch);
    const status = delegationRoute.indexOf('{ status: 409 }', message);

    expect(catchBranch).toBeGreaterThan(-1);
    expect(message).toBeGreaterThan(catchBranch);
    expect(status).toBeGreaterThan(message);
  });
});
