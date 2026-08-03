/**
 * Permission codes used throughout the application.
 * These are stored in the database and checked by domain services.
 */
import { WorkspaceIds, type WorkspaceId } from '@/lib/workspaces';

export const Permissions = {
  // Requests
  REQUEST_CREATE: 'request:create',
  REQUEST_VIEW: 'request:view',
  REQUEST_APPROVE_SUPERVISOR: 'request:approve-supervisor',
  REQUEST_REVIEW_TRANSPORT: 'request:review-transport',
  REQUEST_WITHDRAW: 'request:withdraw',
  REQUEST_CANCEL: 'request:cancel',

  // Allocations
  ALLOCATION_MANAGE: 'allocation:manage',
  ALLOCATION_CREATE: 'allocation:create',
  ALLOCATION_OVERRIDE: 'allocation:override',

  // Vehicles
  VEHICLE_MANAGE: 'vehicle:manage',
  VEHICLE_VIEW: 'vehicle:view',
  VEHICLE_CREATE: 'vehicle:create',
  VEHICLE_UPDATE: 'vehicle:update',

  // Vehicle release
  VEHICLE_RELEASE_REGIONAL: 'vehicle:release-regional',
  VEHICLE_RELEASE_NATIONAL: 'vehicle:release-national',
  VEHICLE_RELEASE_OVERRIDE: 'vehicle:release-override',

  // Trip authorisation
  TRIP_AUTHORIZE_REGIONAL: 'trip:authorize-regional',
  TRIP_AUTHORIZE_NATIONAL: 'trip:authorize-national',
  TRIP_AUTHORIZE_EMERGENCY: 'trip:authorize-emergency',

  // Inspections
  INSPECTION_PERFORM: 'inspection:perform',
  INSPECTION_VIEW: 'inspection:view',

  // Trips
  TRIP_CLOSE: 'trip:close',
  TRIP_VIEW: 'trip:view',
  TRIP_MANAGE: 'trip:manage',
  TRIP_AUTHORITY_OVERRIDE_NUMBER: 'tripAuthority:overrideNumber',

  // Drivers
  DRIVER_LOG_CREATE: 'driver:log-create',
  DRIVER_LOG_VIEW: 'driver:log-view',
  DRIVER_FUEL_CREATE: 'driver:fuel-create',
  DRIVER_MANAGE: 'driver:manage',
  DRIVER_ASSIGN: 'driver:assign',
  DRIVER_VERIFY: 'driver:verify',
  DRIVER_SUSPEND: 'driver:suspend',
  DRIVER_REVOKE: 'driver:revoke',
  DRIVER_REACTIVATE: 'driver:reactivate',
  DRIVER_ARCHIVE: 'driver:archive',
  DRIVER_UPLOAD_LICENCE: 'driver:upload-licence',
  DRIVER_REVIEW_LICENCE: 'driver:review-licence',

  // Maintenance
  MAINTENANCE_VIEW: 'maintenance:view',
  MAINTENANCE_MANAGE: 'maintenance:manage',

  // Fuel
  FUEL_MANAGE: 'fuel:manage',
  FUEL_VERIFY: 'fuel:verify',
  FUEL_VIEW: 'fuel:view',

  // Staff
  STAFF_IMPORT: 'staff:import',
  STAFF_MANAGE: 'staff:manage',
  STAFF_VIEW: 'staff:view',
  STAFF_LIFECYCLE_MANAGE: 'staff:lifecycle-manage',
  DELEGATION_MANAGE: 'delegation:manage',
  LICENCE_VERIFY: 'driver:licence-verify',
  SECURE_REQUEST_ASSIST: 'request:assist',

  // User accounts (User Management)
  USER_VIEW: 'user:view',
  USER_MANAGE_STATUS: 'user:manage-status',
  USER_INVITE: 'user:invite',

  // Audit
  AUDIT_READ: 'audit:read',
  AUDIT_EXPORT: 'audit:export',

  // Platform
  TENANT_MANAGE: 'tenant:manage',
  TENANT_VIEW: 'tenant:view',
  PLATFORM_ADMIN: 'platform:admin',
  PLATFORM_SUPPORT: 'platform:support',

  // Programmes
  PROGRAMME_VIEW: 'programme:view',
  PROGRAMME_CREATE: 'programme:create',
  PROGRAMME_EDIT_OWN: 'programme:edit-own',
  PROGRAMME_EDIT_ANY: 'programme:edit-any',
  PROGRAMME_SUBMIT: 'programme:submit',
  PROGRAMME_REVIEW: 'programme:review',
  PROGRAMME_APPROVE: 'programme:approve',
  PROGRAMME_REJECT: 'programme:reject',
  PROGRAMME_PUBLISH: 'programme:publish',
  PROGRAMME_ARCHIVE: 'programme:archive',

  // Reports
  REPORT_VIEW: 'report:view',
  REPORT_EXPORT: 'report:export',

  // Files & uploads
  FILE_UPLOAD: 'file:upload',
  FILE_VIEW: 'file:view',
} as const;

export type PermissionCode = (typeof Permissions)[keyof typeof Permissions];

/**
 * A permission granted by a role is usable only inside the matching active
 * workspace. This prevents a multi-role user's inactive responsibilities from
 * leaking into direct API calls.
 */
export function isPermissionAvailableInWorkspace(
  permission: PermissionCode,
  workspace: WorkspaceId,
) {
  const W = WorkspaceIds;
  const commonRequestPermissions: readonly PermissionCode[] = [
    Permissions.REQUEST_CREATE,
    Permissions.REQUEST_VIEW,
    Permissions.REQUEST_WITHDRAW,
  ];
  const commonProgrammePermissions: readonly PermissionCode[] = [
    Permissions.PROGRAMME_VIEW,
    Permissions.PROGRAMME_CREATE,
    Permissions.PROGRAMME_EDIT_OWN,
    Permissions.PROGRAMME_SUBMIT,
  ];
  if (commonRequestPermissions.includes(permission) && workspace !== W.PLATFORM_ADMIN) return true;
  if (commonProgrammePermissions.includes(permission) && workspace !== W.PLATFORM_ADMIN) return true;

  const policies: Record<string, readonly PermissionCode[]> = {
    [W.PERSONAL]: [...commonRequestPermissions, Permissions.FILE_VIEW, Permissions.FILE_UPLOAD],
    [W.APPROVER]: [
      Permissions.REQUEST_VIEW,
      Permissions.REQUEST_APPROVE_SUPERVISOR,
      Permissions.REQUEST_REVIEW_TRANSPORT,
      Permissions.VEHICLE_RELEASE_REGIONAL,
      Permissions.VEHICLE_RELEASE_NATIONAL,
      Permissions.TRIP_AUTHORIZE_REGIONAL,
      Permissions.TRIP_AUTHORIZE_NATIONAL,
      Permissions.TRIP_AUTHORIZE_EMERGENCY,
      Permissions.FILE_VIEW,
    ],
    [W.DRIVER]: [
      ...commonRequestPermissions,
      Permissions.DRIVER_LOG_CREATE,
      Permissions.DRIVER_LOG_VIEW,
      Permissions.DRIVER_FUEL_CREATE,
      Permissions.TRIP_VIEW,
      Permissions.INSPECTION_VIEW,
      // Drivers perform departure/return inspections on their assigned trips
      // from the mobile console (offline-first), so INSPECTION_PERFORM must be
      // usable inside the DRIVER workspace even though the API also requires
      // the dashboard-action gate on /dashboard/inspections/new.
      Permissions.INSPECTION_PERFORM,
      Permissions.FILE_VIEW,
      Permissions.FILE_UPLOAD,
    ],
    [W.INSPECTOR]: [
      ...commonRequestPermissions,
      Permissions.INSPECTION_PERFORM,
      Permissions.INSPECTION_VIEW,
      Permissions.VEHICLE_VIEW,
      Permissions.TRIP_VIEW,
      Permissions.FILE_VIEW,
      Permissions.FILE_UPLOAD,
    ],
    [W.MAINTENANCE]: [
      ...commonRequestPermissions,
      Permissions.MAINTENANCE_VIEW,
      Permissions.MAINTENANCE_MANAGE,
      Permissions.VEHICLE_VIEW,
      Permissions.INSPECTION_VIEW,
      Permissions.FILE_VIEW,
      Permissions.FILE_UPLOAD,
    ],
    [W.TRANSPORT_ADMIN]: [
      ...commonRequestPermissions,
      Permissions.PROGRAMME_VIEW,
      Permissions.REQUEST_REVIEW_TRANSPORT,
      Permissions.REQUEST_CANCEL,
      Permissions.ALLOCATION_MANAGE,
      Permissions.ALLOCATION_CREATE,
      Permissions.ALLOCATION_OVERRIDE,
      Permissions.VEHICLE_MANAGE,
      Permissions.VEHICLE_VIEW,
      Permissions.VEHICLE_CREATE,
      Permissions.VEHICLE_UPDATE,
      Permissions.TRIP_CLOSE,
      Permissions.TRIP_VIEW,
      Permissions.TRIP_MANAGE,
      Permissions.FUEL_MANAGE,
      Permissions.FUEL_VERIFY,
      Permissions.FUEL_VIEW,
      Permissions.REPORT_VIEW,
      Permissions.REPORT_EXPORT,
      Permissions.INSPECTION_VIEW,
      Permissions.DRIVER_MANAGE,
      Permissions.DRIVER_ASSIGN,
      Permissions.DRIVER_VERIFY,
      Permissions.DRIVER_SUSPEND,
      Permissions.DRIVER_REVOKE,
      Permissions.DRIVER_REACTIVATE,
      Permissions.DRIVER_ARCHIVE,
      Permissions.DRIVER_UPLOAD_LICENCE,
      Permissions.DRIVER_REVIEW_LICENCE,
      Permissions.USER_VIEW,
      Permissions.USER_MANAGE_STATUS,
      Permissions.FILE_VIEW,
      Permissions.FILE_UPLOAD,
    ],
    [W.TENANT_ADMIN]: [
      ...commonRequestPermissions,
      ...commonProgrammePermissions,
      Permissions.PROGRAMME_EDIT_ANY,
      Permissions.PROGRAMME_REVIEW,
      Permissions.PROGRAMME_APPROVE,
      Permissions.PROGRAMME_REJECT,
      Permissions.PROGRAMME_PUBLISH,
      Permissions.PROGRAMME_ARCHIVE,
      Permissions.REQUEST_CANCEL,
      Permissions.TENANT_VIEW,
      Permissions.TENANT_MANAGE,
      Permissions.STAFF_MANAGE,
      Permissions.STAFF_IMPORT,
      Permissions.STAFF_VIEW,
      Permissions.STAFF_LIFECYCLE_MANAGE,
      Permissions.DELEGATION_MANAGE,
      Permissions.LICENCE_VERIFY,
      Permissions.SECURE_REQUEST_ASSIST,
      Permissions.DRIVER_MANAGE,
      Permissions.DRIVER_VERIFY,
      Permissions.DRIVER_SUSPEND,
      Permissions.DRIVER_REVOKE,
      Permissions.DRIVER_REACTIVATE,
      Permissions.DRIVER_ARCHIVE,
      Permissions.DRIVER_UPLOAD_LICENCE,
      Permissions.DRIVER_REVIEW_LICENCE,
      Permissions.USER_VIEW,
      Permissions.USER_MANAGE_STATUS,
      Permissions.USER_INVITE,
      Permissions.AUDIT_READ,
      Permissions.AUDIT_EXPORT,
      Permissions.REPORT_VIEW,
      Permissions.REPORT_EXPORT,
      Permissions.FILE_VIEW,
      Permissions.FILE_UPLOAD,
    ],
    [W.AUDIT]: [
      Permissions.REQUEST_VIEW,
      Permissions.AUDIT_READ,
      Permissions.AUDIT_EXPORT,
      Permissions.REPORT_VIEW,
      Permissions.REPORT_EXPORT,
      Permissions.TRIP_VIEW,
      Permissions.VEHICLE_VIEW,
      Permissions.INSPECTION_VIEW,
      Permissions.FUEL_VIEW,
      Permissions.STAFF_VIEW,
      Permissions.MAINTENANCE_VIEW,
      Permissions.FILE_VIEW,
    ],
    [W.PLATFORM_ADMIN]: [
      Permissions.PLATFORM_ADMIN,
      Permissions.PLATFORM_SUPPORT,
      Permissions.TENANT_VIEW,
      Permissions.TENANT_MANAGE,
      Permissions.AUDIT_READ,
      Permissions.AUDIT_EXPORT,
    ],
  };
  return policies[workspace]?.includes(permission) ?? false;
}

/**
 * Predefined role definitions with their permissions
 */
export const RoleDefinitions = {
  PLATFORM_SUPER_ADMIN: {
    name: 'Platform Super Administrator',
    isSystem: true,
    permissions: [
      Permissions.TENANT_MANAGE,
      Permissions.TENANT_VIEW,
      Permissions.PLATFORM_ADMIN,
      Permissions.AUDIT_READ,
    ],
  },
  PLATFORM_SUPPORT: {
    name: 'Platform Support Administrator',
    isSystem: true,
    permissions: [Permissions.PLATFORM_SUPPORT, Permissions.TENANT_VIEW],
  },
  PLATFORM_AUDITOR: {
    name: 'Platform Auditor',
    isSystem: true,
    permissions: [Permissions.TENANT_VIEW, Permissions.AUDIT_READ, Permissions.AUDIT_EXPORT],
  },
  TENANT_ADMIN: {
    name: 'Tenant Administrator',
    isSystem: true,
    permissions: [
      Permissions.TENANT_VIEW,
      Permissions.TENANT_MANAGE,
      Permissions.STAFF_MANAGE,
      Permissions.STAFF_IMPORT,
      Permissions.STAFF_VIEW,
      Permissions.STAFF_LIFECYCLE_MANAGE,
      Permissions.DELEGATION_MANAGE,
      Permissions.LICENCE_VERIFY,
      Permissions.SECURE_REQUEST_ASSIST,
      Permissions.USER_VIEW,
      Permissions.USER_MANAGE_STATUS,
      Permissions.USER_INVITE,
      Permissions.REQUEST_CREATE,
      Permissions.REQUEST_VIEW,
      Permissions.REQUEST_CANCEL,
      Permissions.PROGRAMME_VIEW,
      Permissions.PROGRAMME_CREATE,
      Permissions.PROGRAMME_EDIT_OWN,
      Permissions.PROGRAMME_EDIT_ANY,
      Permissions.PROGRAMME_SUBMIT,
      Permissions.PROGRAMME_REVIEW,
      Permissions.PROGRAMME_APPROVE,
      Permissions.PROGRAMME_REJECT,
      Permissions.PROGRAMME_PUBLISH,
      Permissions.PROGRAMME_ARCHIVE,
      Permissions.VEHICLE_VIEW,
      Permissions.VEHICLE_UPDATE,
      Permissions.ALLOCATION_CREATE,
      Permissions.AUDIT_READ,
      Permissions.DRIVER_LOG_VIEW,
      Permissions.FUEL_VIEW,
      Permissions.FUEL_MANAGE,
      Permissions.FUEL_VERIFY,
      Permissions.TRIP_VIEW,
      Permissions.TRIP_AUTHORITY_OVERRIDE_NUMBER,
      Permissions.INSPECTION_VIEW,
      Permissions.INSPECTION_PERFORM,
      Permissions.MAINTENANCE_VIEW,
      Permissions.AUDIT_EXPORT,
      Permissions.REPORT_VIEW,
      Permissions.REPORT_EXPORT,
      Permissions.FILE_VIEW,
      Permissions.FILE_UPLOAD,
    ],
  },
  INSPECTOR: {
    name: 'Inspector',
    isSystem: true,
    permissions: [
      Permissions.INSPECTION_PERFORM,
      Permissions.INSPECTION_VIEW,
      Permissions.TRIP_VIEW,
      Permissions.VEHICLE_VIEW,
    ],
  },
  MAINTENANCE_OFFICER: {
    name: 'Maintenance Officer',
    isSystem: true,
    permissions: [
      Permissions.VEHICLE_VIEW,
      Permissions.VEHICLE_UPDATE,
      Permissions.TRIP_VIEW,
      Permissions.FUEL_VIEW,
      Permissions.INSPECTION_VIEW,
      Permissions.MAINTENANCE_VIEW,
      Permissions.MAINTENANCE_MANAGE,
    ],
  },
  TRANSPORT_ADMIN: {
    name: 'Transport Administrator',
    isSystem: true,
    permissions: [
      Permissions.REQUEST_CREATE,
      Permissions.REQUEST_VIEW,
      Permissions.REQUEST_REVIEW_TRANSPORT,
      Permissions.REQUEST_CANCEL,
      Permissions.ALLOCATION_MANAGE,
      Permissions.ALLOCATION_CREATE,
      Permissions.ALLOCATION_OVERRIDE,
      Permissions.VEHICLE_MANAGE,
      Permissions.VEHICLE_VIEW,
      Permissions.VEHICLE_CREATE,
      Permissions.VEHICLE_UPDATE,
      Permissions.TRIP_CLOSE,
      Permissions.TRIP_MANAGE,
      Permissions.TRIP_VIEW,
      Permissions.STAFF_MANAGE,
      Permissions.STAFF_IMPORT,
      Permissions.STAFF_VIEW,
      Permissions.STAFF_LIFECYCLE_MANAGE,
      Permissions.DELEGATION_MANAGE,
      Permissions.LICENCE_VERIFY,
      Permissions.SECURE_REQUEST_ASSIST,
      Permissions.USER_VIEW,
      Permissions.USER_MANAGE_STATUS,
      Permissions.FUEL_MANAGE,
      Permissions.FUEL_VERIFY,
      Permissions.FUEL_VIEW,
      Permissions.REPORT_VIEW,
      Permissions.REPORT_EXPORT,
      Permissions.INSPECTION_VIEW,
      Permissions.FILE_VIEW,
      Permissions.FILE_UPLOAD,
      Permissions.DRIVER_MANAGE,
      Permissions.DRIVER_ASSIGN,
      Permissions.DRIVER_VERIFY,
      Permissions.DRIVER_SUSPEND,
      Permissions.DRIVER_REVOKE,
      Permissions.DRIVER_REACTIVATE,
      Permissions.DRIVER_ARCHIVE,
      Permissions.DRIVER_UPLOAD_LICENCE,
      Permissions.DRIVER_REVIEW_LICENCE,
      Permissions.MAINTENANCE_VIEW,
      Permissions.MAINTENANCE_MANAGE,
    ],
  },
  REQUESTER: {
    name: 'Requester / Programme Owner',
    isSystem: true,
    permissions: [
      Permissions.REQUEST_CREATE,
      Permissions.REQUEST_VIEW,
      Permissions.REQUEST_WITHDRAW,
      Permissions.PROGRAMME_VIEW,
      Permissions.PROGRAMME_CREATE,
      Permissions.PROGRAMME_EDIT_OWN,
      Permissions.PROGRAMME_SUBMIT,
    ],
  },
  SUPERVISOR: {
    name: 'Immediate Supervisor',
    isSystem: true,
    permissions: [Permissions.REQUEST_VIEW, Permissions.REQUEST_APPROVE_SUPERVISOR],
  },
  CONTROL_ADMIN_OFFICER: {
    name: 'Control Administrative Officer',
    isSystem: true,
    permissions: [
      Permissions.VEHICLE_RELEASE_REGIONAL,
      Permissions.INSPECTION_PERFORM,
      Permissions.INSPECTION_VIEW,
      Permissions.TRIP_VIEW,
      // Release officers perform inspections and upload inspection photos,
      // so they need the file permissions just like inspectors do.  They also
      // need to look up fleet vehicles while performing an inspection.
      Permissions.VEHICLE_VIEW,
      Permissions.FILE_VIEW,
      Permissions.FILE_UPLOAD,
    ],
  },
  DEPUTY_DIRECTOR: {
    name: 'Deputy Director',
    isSystem: true,
    permissions: [
      Permissions.TRIP_AUTHORIZE_REGIONAL,
      Permissions.TRIP_VIEW,
      Permissions.REQUEST_VIEW,
    ],
  },
  DIRECTOR: {
    name: 'Director',
    isSystem: true,
    permissions: [
      Permissions.VEHICLE_RELEASE_NATIONAL,
      Permissions.TRIP_VIEW,
      Permissions.REQUEST_VIEW,
    ],
  },
  CHIEF_REGIONAL_OFFICER: {
    name: 'Chief Regional Officer',
    isSystem: true,
    permissions: [
      Permissions.TRIP_AUTHORIZE_NATIONAL,
      Permissions.TRIP_AUTHORIZE_EMERGENCY,
      Permissions.TRIP_VIEW,
      Permissions.REQUEST_VIEW,
    ],
  },
  DRIVER: {
    name: 'Assigned Driver',
    isSystem: true,
    permissions: [
      Permissions.DRIVER_LOG_CREATE,
      Permissions.DRIVER_LOG_VIEW,
      Permissions.DRIVER_FUEL_CREATE,
      Permissions.TRIP_VIEW,
      Permissions.INSPECTION_VIEW,
      Permissions.INSPECTION_PERFORM,
      Permissions.FILE_VIEW,
      Permissions.FILE_UPLOAD,
    ],
  },
  TENANT_AUDITOR: {
    name: 'Tenant Auditor',
    isSystem: true,
    permissions: [
      Permissions.AUDIT_READ,
      Permissions.AUDIT_EXPORT,
      Permissions.REPORT_VIEW,
      Permissions.REPORT_EXPORT,
      Permissions.TRIP_VIEW,
      Permissions.VEHICLE_VIEW,
      Permissions.INSPECTION_VIEW,
      Permissions.FUEL_VIEW,
      Permissions.STAFF_VIEW,
      Permissions.MAINTENANCE_VIEW,
      Permissions.FILE_VIEW,
    ],
  },
} as const;

/**
 * Get all default permission codes for seeding
 */
export function getAllPermissionCodes(): PermissionCode[] {
  return Object.values(Permissions);
}

/**
 * Permission groups for UI organisation
 */
export const PermissionGroups: Record<string, { label: string; permissions: PermissionCode[] }> = {
  requests: {
    label: 'Transport Requests',
    permissions: [
      Permissions.REQUEST_CREATE,
      Permissions.REQUEST_VIEW,
      Permissions.REQUEST_APPROVE_SUPERVISOR,
      Permissions.REQUEST_REVIEW_TRANSPORT,
      Permissions.REQUEST_WITHDRAW,
      Permissions.REQUEST_CANCEL,
    ],
  },
  allocations: {
    label: 'Vehicle Allocation',
    permissions: [
      Permissions.ALLOCATION_MANAGE,
      Permissions.ALLOCATION_CREATE,
      Permissions.ALLOCATION_OVERRIDE,
    ],
  },
  vehicles: {
    label: 'Fleet Management',
    permissions: [
      Permissions.VEHICLE_MANAGE,
      Permissions.VEHICLE_VIEW,
      Permissions.VEHICLE_CREATE,
      Permissions.VEHICLE_UPDATE,
    ],
  },
  release: {
    label: 'Vehicle Release',
    permissions: [
      Permissions.VEHICLE_RELEASE_REGIONAL,
      Permissions.VEHICLE_RELEASE_NATIONAL,
      Permissions.VEHICLE_RELEASE_OVERRIDE,
    ],
  },
  authorisation: {
    label: 'Trip Authorisation',
    permissions: [
      Permissions.TRIP_AUTHORIZE_REGIONAL,
      Permissions.TRIP_AUTHORIZE_NATIONAL,
      Permissions.TRIP_AUTHORIZE_EMERGENCY,
    ],
  },
  inspections: {
    label: 'Inspections',
    permissions: [Permissions.INSPECTION_PERFORM, Permissions.INSPECTION_VIEW],
  },
  trips: {
    label: 'Trip Management',
    permissions: [Permissions.TRIP_CLOSE, Permissions.TRIP_VIEW, Permissions.TRIP_MANAGE],
  },
  drivers: {
    label: 'Driver Operations',
    permissions: [
      Permissions.DRIVER_LOG_CREATE,
      Permissions.DRIVER_LOG_VIEW,
      Permissions.DRIVER_FUEL_CREATE,
      Permissions.DRIVER_MANAGE,
      Permissions.DRIVER_ASSIGN,
      Permissions.DRIVER_VERIFY,
      Permissions.DRIVER_SUSPEND,
      Permissions.DRIVER_REVOKE,
      Permissions.DRIVER_REACTIVATE,
      Permissions.DRIVER_ARCHIVE,
      Permissions.DRIVER_UPLOAD_LICENCE,
      Permissions.DRIVER_REVIEW_LICENCE,
    ],
  },
  fuel: {
    label: 'Fuel Management',
    permissions: [Permissions.FUEL_MANAGE, Permissions.FUEL_VERIFY, Permissions.FUEL_VIEW],
  },
  maintenance: {
    label: 'Maintenance',
    permissions: [Permissions.MAINTENANCE_VIEW, Permissions.MAINTENANCE_MANAGE],
  },
  staff: {
    label: 'Staff Management',
    permissions: [
      Permissions.STAFF_IMPORT,
      Permissions.STAFF_MANAGE,
      Permissions.STAFF_VIEW,
      Permissions.STAFF_LIFECYCLE_MANAGE,
      Permissions.DELEGATION_MANAGE,
      Permissions.LICENCE_VERIFY,
      Permissions.SECURE_REQUEST_ASSIST,
    ],
  },
  audit: {
    label: 'Audit',
    permissions: [Permissions.AUDIT_READ, Permissions.AUDIT_EXPORT],
  },
  platform: {
    label: 'Platform Administration',
    permissions: [
      Permissions.TENANT_MANAGE,
      Permissions.TENANT_VIEW,
      Permissions.PLATFORM_ADMIN,
      Permissions.PLATFORM_SUPPORT,
    ],
  },
  reports: {
    label: 'Reports',
    permissions: [Permissions.REPORT_VIEW, Permissions.REPORT_EXPORT],
  },
  programmes: {
    label: 'Programmes',
    permissions: [
      Permissions.PROGRAMME_VIEW,
      Permissions.PROGRAMME_CREATE,
      Permissions.PROGRAMME_EDIT_OWN,
      Permissions.PROGRAMME_EDIT_ANY,
      Permissions.PROGRAMME_SUBMIT,
      Permissions.PROGRAMME_REVIEW,
      Permissions.PROGRAMME_APPROVE,
      Permissions.PROGRAMME_REJECT,
      Permissions.PROGRAMME_PUBLISH,
      Permissions.PROGRAMME_ARCHIVE,
    ],
  },
  files: {
    label: 'File Storage',
    permissions: [Permissions.FILE_UPLOAD, Permissions.FILE_VIEW],
  },
};
