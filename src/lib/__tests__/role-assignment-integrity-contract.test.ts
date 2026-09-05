import { describe, expect, it } from 'vitest';
import {
  databaseErrorCode,
  isRoleAssignmentWindowConflict,
  ROLE_ASSIGNMENT_WINDOW_CONFLICT_CODE,
} from '@/lib/role-assignment-integrity';

describe('role assignment integrity error classification', () => {
  it('recognises PostgreSQL exclusion-constraint conflicts', () => {
    expect(ROLE_ASSIGNMENT_WINDOW_CONFLICT_CODE).toBe('23P01');
    expect(isRoleAssignmentWindowConflict({ code: '23P01' })).toBe(true);
    expect(isRoleAssignmentWindowConflict({ cause: { code: '23P01' } })).toBe(true);
  });

  it('does not classify unrelated database failures as overlap conflicts', () => {
    expect(databaseErrorCode({ code: '23505' })).toBe('23505');
    expect(isRoleAssignmentWindowConflict({ code: '23505' })).toBe(false);
    expect(isRoleAssignmentWindowConflict(new Error('other failure'))).toBe(false);
  });
});
