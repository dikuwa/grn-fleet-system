export const ROLE_ASSIGNMENT_WINDOW_CONFLICT_CODE = '23P01';

export function databaseErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const value = error as { code?: unknown; cause?: { code?: unknown } };
  return typeof value.code === 'string'
    ? value.code
    : typeof value.cause?.code === 'string'
      ? value.cause.code
      : null;
}

export function isRoleAssignmentWindowConflict(error: unknown) {
  return databaseErrorCode(error) === ROLE_ASSIGNMENT_WINDOW_CONFLICT_CODE;
}
