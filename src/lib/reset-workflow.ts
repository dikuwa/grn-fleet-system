export const TENANT_RESET_REQUEST_PHRASE = 'REQUEST RESET';
export const PLATFORM_EXECUTION_RESET_PHRASE = 'RESET PLATFORM';

export type ResetExecutionOwner = 'tenant' | 'platform';

/**
 * Tenant-originated operational/selective plans return to Tenant Administration
 * after governance checks. Platform-created plans and protected clean slate
 * always remain Platform-executed.
 */
export function resetExecutionOwner(input: {
  createdFrom: unknown;
  preset: unknown;
}): ResetExecutionOwner {
  return input.createdFrom === 'tenant_admin' && input.preset !== 'clean_slate'
    ? 'tenant'
    : 'platform';
}

export function tenantExecutionResetPhrase(tenantCode: string) {
  return `RESET ${tenantCode.trim()}`;
}

export function matchesTenantResetRequestPhrase(value: unknown) {
  return typeof value === 'string' && value.trim() === TENANT_RESET_REQUEST_PHRASE;
}

export function matchesTenantExecutionResetPhrase(value: unknown, tenantCode: string) {
  return typeof value === 'string' && value.trim() === tenantExecutionResetPhrase(tenantCode);
}

export function matchesPlatformExecutionResetPhrase(value: unknown) {
  return typeof value === 'string' && value.trim() === PLATFORM_EXECUTION_RESET_PHRASE;
}
