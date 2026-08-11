export const TENANT_RESET_REQUEST_PHRASE = 'REQUEST RESET';

export function tenantExecutionResetPhrase(tenantCode: string) {
  return `RESET ${tenantCode.trim()}`;
}

export function matchesTenantResetRequestPhrase(value: unknown) {
  return typeof value === 'string' && value.trim() === TENANT_RESET_REQUEST_PHRASE;
}

export function matchesTenantExecutionResetPhrase(value: unknown, tenantCode: string) {
  return typeof value === 'string' && value.trim() === tenantExecutionResetPhrase(tenantCode);
}
