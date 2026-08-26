/**
 * Lightweight accidental-change guard. Typing this exact phrase unlocks the
 * protected editor for a built-in role. It is intentionally NOT a security
 * boundary — authorization continues to come from the authenticated session,
 * tenant membership, the Tenant Administrator permission and the server-side
 * required-permission checks.
 */
export const PROTECTED_ROLE_EDIT_PHRASE = 'EDIT ROLE';

/**
 * Role metadata — single source of truth for role responsibilities, system
 * permission baselines and human-readable permission labels.
 *
 * Built-in roles are structural contracts referenced by routing, workflow
 * routing, approval chains, notifications and API authorization. Their
 * identities (names) and required permission baselines must never be altered
 * casually. Everything here derives from the canonical `RoleDefinitions` in
 * `src/lib/permissions.ts` so the UI, server enforcement and seed stay in
 * lockstep.
 */
import { Permissions, PermissionGroups, RoleDefinitions } from '@/lib/permissions';
import { PlatformSystemRoles, SystemRoles } from '@/lib/workspaces';

/** Tenant-managed built-in roles (platform roles are managed from Platform Users). */
export const TENANT_SYSTEM_ROLE_NAMES: readonly string[] = [
  RoleDefinitions.TENANT_ADMIN.name,
  RoleDefinitions.TENANT_AUDITOR.name,
  RoleDefinitions.TRANSPORT_ADMIN.name,
  RoleDefinitions.REQUESTER.name,
  RoleDefinitions.SUPERVISOR.name,
  RoleDefinitions.FINANCE_BUDGET_REVIEWER.name,
  RoleDefinitions.CONTROL_ADMIN_OFFICER.name,
  RoleDefinitions.DEPUTY_DIRECTOR.name,
  RoleDefinitions.DIRECTOR.name,
  RoleDefinitions.CHIEF_REGIONAL_OFFICER.name,
  RoleDefinitions.DRIVER.name,
  RoleDefinitions.INSPECTOR.name,
  RoleDefinitions.MAINTENANCE_OFFICER.name,
] as const;

function findRoleDefinition(name: string) {
  return Object.values(RoleDefinitions).find((definition) => definition.name === name);
}

/** True for any built-in tenant role that the Tenant Administrator manages. */
export function isTenantSystemRole(roleName: string): boolean {
  return TENANT_SYSTEM_ROLE_NAMES.includes(roleName);
}

/**
 * Permissions a built-in role requires to perform its structural job. These
 * are the role's seeded baseline from `RoleDefinitions` and cannot be removed
 * by a Tenant Administrator — the server rejects any save that omits them.
 */
export const SYSTEM_ROLE_REQUIRED_PERMISSIONS: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries(
    TENANT_SYSTEM_ROLE_NAMES.map((name) => [name, findRoleDefinition(name)?.permissions ?? []]),
  ) as Readonly<Record<string, readonly string[]>>;

/**
 * Plain-English responsibility for each built-in role — why the role exists.
 * This is intentionally separate from the permission-derived "Current access"
 * so the responsibility text never becomes misleading when configurable
 * permissions change.
 */
export const SYSTEM_ROLE_RESPONSIBILITIES: Readonly<Record<string, string>> = {
  [RoleDefinitions.TENANT_ADMIN.name]:
    'Administers the organisation: manages users, staff, programmes and tenant settings.',
  [RoleDefinitions.TRANSPORT_ADMIN.name]:
    'Reviews transport requests, coordinates vehicles and drivers, and manages transport operations.',
  [RoleDefinitions.REQUESTER.name]:
    'Creates transport requests and manages programmes used for travel planning.',
  [RoleDefinitions.SUPERVISOR.name]:
    'Reviews requests submitted by staff under their supervision and provides the first approval decision.',
  [RoleDefinitions.FINANCE_BUDGET_REVIEWER.name]:
    'Reviews the financial impact of transport requests and records the governing budget decision.',
  [RoleDefinitions.CONTROL_ADMIN_OFFICER.name]:
    'Performs administrative review and release of trips and carries out official vehicle inspections.',
  [RoleDefinitions.DEPUTY_DIRECTOR.name]: 'Gives final authorisation for regional trips.',
  [RoleDefinitions.DIRECTOR.name]: 'Releases national trips for final authorisation.',
  [RoleDefinitions.CHIEF_REGIONAL_OFFICER.name]:
    'Gives final authorisation for national trips, including emergency overrides.',
  [RoleDefinitions.DRIVER.name]:
    'Accesses assigned trips, records journey information, and reports defects, accidents or breakdowns.',
  [RoleDefinitions.INSPECTOR.name]:
    'Performs official departure and return inspections and records inspection evidence.',
  [RoleDefinitions.MAINTENANCE_OFFICER.name]:
    'Manages vehicle maintenance records, service schedules, defects and maintenance activities.',
  [RoleDefinitions.TENANT_AUDITOR.name]:
    'Reviews operational records, reports and audit history without managing day-to-day transport workflows.',
};

/** Platform system roles are managed only from Platform Users. */
export const PLATFORM_SYSTEM_ROLE_NAMES: readonly string[] = PlatformSystemRoles; /**
 * Fixed permission baseline for each platform system role. Platform roles are
 * fully system-managed: their capabilities are granted by GovFleet and can
 * never be edited by platform operators. This derives from the canonical
 * `RoleDefinitions` in `src/lib/permissions.ts`, which the seed and the
 * platform workspace policy both use, so the three stay in lockstep by
 * construction.
 */
export const PLATFORM_ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  [RoleDefinitions.PLATFORM_SUPER_ADMIN.name]: RoleDefinitions.PLATFORM_SUPER_ADMIN.permissions,
  [RoleDefinitions.PLATFORM_SUPPORT.name]: RoleDefinitions.PLATFORM_SUPPORT.permissions,
  [RoleDefinitions.PLATFORM_AUDITOR.name]: RoleDefinitions.PLATFORM_AUDITOR.permissions,
};

/** Plain-English responsibility for each platform system role. */
export const PLATFORM_ROLE_RESPONSIBILITIES: Readonly<Record<string, string>> = {
  [SystemRoles.PLATFORM_ADMIN]:
    'Owns platform operations: manages tenants, subscriptions and billing, operational resets, platform content, demo requests and all platform users.',
  [SystemRoles.PLATFORM_SUPPORT]:
    'Assists with platform onboarding and operations: views tenant information, manages demo requests and emergency contacts.',
  [SystemRoles.PLATFORM_AUDITOR]:
    'Reviews platform activity and audit history across tenants without making operational changes.',
};

/**
 * Responsibility for any role. System roles (tenant or platform) use their
 * predefined system description; custom roles fall back to their stored
 * description so the card never shows a placeholder when one was provided.
 */
export function roleResponsibility(
  roleName: string,
  description: string | null | undefined,
): string {
  return (
    SYSTEM_ROLE_RESPONSIBILITIES[roleName] ??
    PLATFORM_ROLE_RESPONSIBILITIES[roleName] ??
    (description?.trim() ? description.trim() : 'Tenant custom role.')
  );
}

/**
 * Human-readable labels for permission codes. Display-layer only — the
 * underlying permission keys are never renamed.
 */
const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  [Permissions.REQUEST_CREATE]: 'Create transport requests',
  [Permissions.REQUEST_VIEW]: 'View transport requests',
  [Permissions.REQUEST_APPROVE_SUPERVISOR]: 'Approve staff transport requests',
  [Permissions.REQUEST_APPROVE_ORGANISATIONAL]: 'Approve requests for the responsible organisation',
  [Permissions.REQUEST_REVIEW_FINANCE]: 'Review request budget impact',
  [Permissions.REQUEST_REVIEW_TRANSPORT]: 'Review transport requests',
  [Permissions.REQUEST_WITHDRAW]: 'Withdraw own requests',
  [Permissions.REQUEST_CANCEL]: 'Cancel transport requests',

  [Permissions.ALLOCATION_MANAGE]: 'Manage vehicle allocations',
  [Permissions.ALLOCATION_CREATE]: 'Create vehicle allocations',
  [Permissions.ALLOCATION_OVERRIDE]: 'Override allocation rules',

  [Permissions.VEHICLE_MANAGE]: 'Manage fleet vehicles',
  [Permissions.VEHICLE_VIEW]: 'View fleet vehicles',
  [Permissions.VEHICLE_CREATE]: 'Add fleet vehicles',
  [Permissions.VEHICLE_UPDATE]: 'Update fleet vehicles',

  [Permissions.VEHICLE_RELEASE_REGIONAL]: 'Release regional trips',
  [Permissions.VEHICLE_RELEASE_NATIONAL]: 'Release national trips',
  [Permissions.VEHICLE_RELEASE_OVERRIDE]: 'Override vehicle release',

  [Permissions.TRIP_AUTHORIZE_REGIONAL]: 'Authorise regional trips',
  [Permissions.TRIP_AUTHORIZE_NATIONAL]: 'Authorise national trips',
  [Permissions.TRIP_AUTHORIZE_EMERGENCY]: 'Authorise emergency trips',

  [Permissions.INSPECTION_PERFORM]: 'Perform vehicle inspections',
  [Permissions.INSPECTION_VIEW]: 'View inspection records',

  [Permissions.TRIP_CLOSE]: 'Close completed trips',
  [Permissions.TRIP_VIEW]: 'View trip details',
  [Permissions.TRIP_MANAGE]: 'Manage trips',
  [Permissions.TRIP_AUTHORITY_OVERRIDE_NUMBER]: 'Override trip authority numbers',

  [Permissions.TRIP_INCIDENT_MANAGE]: 'Manage trip incidents',
  [Permissions.TRIP_INCIDENT_REPORT]: 'Report trip incidents',
  [Permissions.INCIDENT_COMPLETE_DETAILS]: 'Complete incident details',
  [Permissions.INCIDENT_INVESTIGATE]: 'Investigate incidents',
  [Permissions.INCIDENT_CLOSE_INVESTIGATION]: 'Close incident investigations',
  [Permissions.INCIDENT_TECHNICAL_CLEARANCE]: 'Issue technical clearance',
  [Permissions.INCIDENT_INSURANCE_UPDATE]: 'Update insurance records',
  [Permissions.EMERGENCY_CONTACTS_MANAGE]: 'Manage emergency contacts',

  [Permissions.DRIVER_LOG_CREATE]: 'Record trip logs',
  [Permissions.DRIVER_LOG_VIEW]: 'View trip logs',
  [Permissions.DRIVER_FUEL_CREATE]: 'Record fuel transactions',
  [Permissions.DRIVER_MANAGE]: 'Manage driver records',
  [Permissions.DRIVER_ASSIGN]: 'Assign drivers to trips',
  [Permissions.DRIVER_VERIFY]: 'Verify driver authorisation',
  [Permissions.DRIVER_SUSPEND]: 'Suspend drivers',
  [Permissions.DRIVER_REVOKE]: 'Revoke driving authority',
  [Permissions.DRIVER_REACTIVATE]: 'Reactivate drivers',
  [Permissions.DRIVER_ARCHIVE]: 'Archive driver records',
  [Permissions.DRIVER_UPLOAD_LICENCE]: 'Upload driver licences',
  [Permissions.DRIVER_REVIEW_LICENCE]: 'Review licence renewals',

  [Permissions.MAINTENANCE_VIEW]: 'View maintenance records',
  [Permissions.MAINTENANCE_MANAGE]: 'Manage maintenance records',

  [Permissions.FUEL_MANAGE]: 'Manage fuel transactions',
  [Permissions.FUEL_VERIFY]: 'Verify fuel transactions',
  [Permissions.FUEL_VIEW]: 'View fuel records',

  [Permissions.STAFF_IMPORT]: 'Import staff records',
  [Permissions.STAFF_MANAGE]: 'Manage staff records',
  [Permissions.STAFF_VIEW]: 'View staff directory',
  [Permissions.STAFF_LIFECYCLE_MANAGE]: 'Manage staff lifecycle',
  [Permissions.DELEGATION_MANAGE]: 'Manage acting appointments',
  [Permissions.LICENCE_VERIFY]: 'Verify licence records',
  [Permissions.SECURE_REQUEST_ASSIST]: 'Assist with secure requests',

  [Permissions.USER_VIEW]: 'View user accounts',
  [Permissions.USER_MANAGE_STATUS]: 'Manage user account status',
  [Permissions.USER_INVITE]: 'Invite new users',

  [Permissions.AUDIT_READ]: 'View audit records',
  [Permissions.AUDIT_EXPORT]: 'Export audit records',
  [Permissions.LEGAL_POLICY_VIEW]: 'View Legal & Policy Register',
  [Permissions.LEGAL_POLICY_MANAGE]: 'Manage Legal & Policy Register',

  [Permissions.TENANT_MANAGE]: 'Manage tenant settings',
  [Permissions.TENANT_VIEW]: 'View tenant information',
  [Permissions.PLATFORM_ADMIN]: 'Platform administration',
  [Permissions.PLATFORM_SUPPORT]: 'Platform support',
  [Permissions.SITE_MANAGE]: 'Manage platform content',
  [Permissions.BILLING_MANAGE]: 'Manage billing',
  [Permissions.RESET_MANAGE]: 'Manage platform resets',
  [Permissions.DEMO_MANAGE]: 'Manage demo requests',

  [Permissions.PROGRAMME_VIEW]: 'View programmes',
  [Permissions.PROGRAMME_CREATE]: 'Create programmes',
  [Permissions.PROGRAMME_EDIT_OWN]: 'Edit own programmes',
  [Permissions.PROGRAMME_EDIT_ANY]: 'Edit any programme',
  [Permissions.PROGRAMME_SUBMIT]: 'Submit programmes',
  [Permissions.PROGRAMME_REVIEW]: 'Review programmes',
  [Permissions.PROGRAMME_APPROVE]: 'Approve programmes',
  [Permissions.PROGRAMME_REJECT]: 'Reject programmes',
  [Permissions.PROGRAMME_PUBLISH]: 'Publish programmes',
  [Permissions.PROGRAMME_ARCHIVE]: 'Archive programmes',

  [Permissions.REPORT_VIEW]: 'View reports',
  [Permissions.REPORT_EXPORT]: 'Export reports',

  [Permissions.FILE_UPLOAD]: 'Upload documents',
  [Permissions.FILE_VIEW]: 'View documents',
};

/** Readable label for a permission code, falling back to a code-derived label. */
export function permissionLabel(code: string): string {
  const known = PERMISSION_LABELS[code];
  if (known) return known;
  const [, action = code] = code.split(':');
  return action
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Short human-readable area labels for the "Current access" card summary,
 * keyed by `PermissionGroups` key. Falls back to the full group label when a
 * group has no short form.
 */
const CURRENT_ACCESS_GROUP_LABELS: Readonly<Record<string, string>> = {
  requests: 'Requests',
  allocations: 'Allocations',
  vehicles: 'Vehicles',
  release: 'Release',
  authorisation: 'Authorisation',
  inspections: 'Inspections',
  incidents: 'Incidents',
  trips: 'Trips',
  drivers: 'Drivers',
  fuel: 'Fuel',
  maintenance: 'Maintenance',
  staff: 'Staff',
  userAccounts: 'Users',
  audit: 'Audit',
  platform: 'Platform',
  reports: 'Reports',
  programmes: 'Programmes',
  files: 'Files',
  emergencyContacts: 'Emergency Contacts',
};

/**
 * Derive human-readable capability areas from actual permission codes.
 * Always derived from the persisted permission set — never maintained by hand.
 */
export function summarizeCurrentAccess(permissionCodes: readonly string[]): string[] {
  const present = new Set(permissionCodes);
  const areas: string[] = [];
  for (const [groupKey, group] of Object.entries(PermissionGroups)) {
    if (group.permissions.some((permission) => present.has(permission))) {
      areas.push(CURRENT_ACCESS_GROUP_LABELS[groupKey] ?? group.label);
    }
  }
  return areas;
}
