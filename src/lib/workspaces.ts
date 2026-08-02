export const SystemRoles = {
  PLATFORM_ADMIN: 'Platform Super Administrator',
  TENANT_ADMIN: 'Tenant Administrator',
  TRANSPORT_ADMIN: 'Transport Administrator',
  REQUESTER: 'Requester / Programme Owner',
  SUPERVISOR: 'Immediate Supervisor',
  RELEASE_OFFICER: 'Control Administrative Officer',
  DEPUTY_DIRECTOR: 'Deputy Director',
  DIRECTOR: 'Director',
  CHIEF_REGIONAL_OFFICER: 'Chief Regional Officer',
  DRIVER: 'Assigned Driver',
  INSPECTOR: 'Inspector',
  MAINTENANCE: 'Maintenance Officer',
  AUDITOR: 'Tenant Auditor',
} as const;

export const WorkspaceIds = {
  PERSONAL: 'personal',
  APPROVER: 'approver',
  DRIVER: 'driver',
  INSPECTOR: 'inspector',
  MAINTENANCE: 'maintenance',
  TRANSPORT_ADMIN: 'transport_admin',
  TENANT_ADMIN: 'tenant_admin',
  AUDIT: 'audit',
  PLATFORM_ADMIN: 'platform_admin',
} as const;

export type WorkspaceId = (typeof WorkspaceIds)[keyof typeof WorkspaceIds];

export type WorkspaceDefinition = {
  id: WorkspaceId;
  label: string;
  roleNames: readonly string[];
  tenantWorkspace: boolean;
  order: number;
};

const R = SystemRoles;

export const workspaceRegistry: readonly WorkspaceDefinition[] = [
  {
    id: WorkspaceIds.PERSONAL,
    label: 'Personal Requester',
    roleNames: [],
    tenantWorkspace: true,
    order: 10,
  },
  {
    id: WorkspaceIds.APPROVER,
    label: 'Approvals',
    roleNames: [
      R.SUPERVISOR,
      R.RELEASE_OFFICER,
      R.DEPUTY_DIRECTOR,
      R.DIRECTOR,
      R.CHIEF_REGIONAL_OFFICER,
    ],
    tenantWorkspace: true,
    order: 20,
  },
  {
    id: WorkspaceIds.DRIVER,
    label: 'Driver',
    roleNames: [R.DRIVER],
    tenantWorkspace: true,
    order: 30,
  },
  {
    id: WorkspaceIds.INSPECTOR,
    label: 'Inspections',
    roleNames: [R.INSPECTOR],
    tenantWorkspace: true,
    order: 40,
  },
  {
    id: WorkspaceIds.MAINTENANCE,
    label: 'Maintenance',
    roleNames: [R.MAINTENANCE],
    tenantWorkspace: true,
    order: 50,
  },
  {
    id: WorkspaceIds.TRANSPORT_ADMIN,
    label: 'Transport Administration',
    roleNames: [R.TRANSPORT_ADMIN],
    tenantWorkspace: true,
    order: 60,
  },
  {
    id: WorkspaceIds.TENANT_ADMIN,
    label: 'Tenant Administration',
    roleNames: [R.TENANT_ADMIN],
    tenantWorkspace: true,
    order: 70,
  },
  {
    id: WorkspaceIds.AUDIT,
    label: 'Audit',
    roleNames: [R.AUDITOR],
    tenantWorkspace: true,
    order: 80,
  },
  {
    id: WorkspaceIds.PLATFORM_ADMIN,
    label: 'Platform Administration',
    roleNames: [R.PLATFORM_ADMIN],
    tenantWorkspace: false,
    order: 90,
  },
] as const;

const workspaceById = new Map(workspaceRegistry.map((workspace) => [workspace.id, workspace]));

export function isWorkspaceId(value: unknown): value is WorkspaceId {
  return typeof value === 'string' && workspaceById.has(value as WorkspaceId);
}

export function getEligibleWorkspaces(roleNames: readonly string[]): WorkspaceDefinition[] {
  const platformOnly = roleNames.includes(R.PLATFORM_ADMIN);
  if (platformOnly) {
    return workspaceRegistry.filter((workspace) => workspace.id === WorkspaceIds.PLATFORM_ADMIN);
  }

  const eligible = workspaceRegistry.filter(
    (workspace) =>
      workspace.id === WorkspaceIds.PERSONAL ||
      workspace.roleNames.some((roleName) => roleNames.includes(roleName)),
  );

  return eligible.sort((a, b) => a.order - b.order);
}

/**
 * Resolve a stored workspace without ever turning it into an authorization grant.
 * Invalid or expired role workspaces fall back to the user's primary operational
 * workspace, then to Personal Requester.
 */
export function resolveActiveWorkspace(
  roleNames: readonly string[],
  storedWorkspace?: string | null,
): WorkspaceId {
  const eligible = getEligibleWorkspaces(roleNames);
  if (storedWorkspace && isWorkspaceId(storedWorkspace)) {
    const stored = eligible.find((workspace) => workspace.id === storedWorkspace);
    if (stored) return stored.id;
  }

  const primary = [...eligible]
    .filter((workspace) => workspace.id !== WorkspaceIds.PERSONAL)
    .sort((a, b) => b.order - a.order)[0];
  return primary?.id ?? WorkspaceIds.PERSONAL;
}

export function getWorkspaceDefinition(workspaceId: WorkspaceId) {
  return workspaceById.get(workspaceId)!;
}
