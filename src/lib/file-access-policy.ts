const TENANT_ADMIN_BLOCKED_OPERATIONAL_PREFIXES = [
  'inspections/',
  'receipts/',
  'vehicles/',
  'trip-incidents/',
] as const;

/**
 * Tenant Administration needs generic file access for governance records such
 * as staff documents, imports, signatures and licence oversight, but it must
 * not use FILE_VIEW as a back door into Transport Operations evidence.
 */
export function canTenantAdminUseGenericFileKey(tenantRelativeKey: string): boolean {
  return !TENANT_ADMIN_BLOCKED_OPERATIONAL_PREFIXES.some((prefix) =>
    tenantRelativeKey.startsWith(prefix),
  );
}
