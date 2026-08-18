export type PublicEmployeeRequestConfig = {
  enabled?: boolean;
};

type TenantMetadata = Record<string, unknown> & {
  publicEmployeeRequests?: PublicEmployeeRequestConfig;
};

export function readPublicEmployeeRequestConfig(metadata: unknown): Required<PublicEmployeeRequestConfig> {
  const value = (metadata ?? {}) as TenantMetadata;
  return {
    // Backward compatible: existing active tenants keep the employee link until
    // a Tenant Administrator explicitly turns it off.
    enabled: value.publicEmployeeRequests?.enabled !== false,
  };
}

export function isPublicEmployeeRequestEnabled(metadata: unknown) {
  return readPublicEmployeeRequestConfig(metadata).enabled;
}

export function writePublicEmployeeRequestConfig(metadata: unknown, enabled: boolean): TenantMetadata {
  const value = (metadata ?? {}) as TenantMetadata;
  return {
    ...value,
    publicEmployeeRequests: {
      ...(value.publicEmployeeRequests ?? {}),
      enabled,
    },
  };
}
