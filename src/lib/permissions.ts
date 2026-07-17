/**
 * Permission codes used throughout the application.
 * These are stored in the database and checked by domain services.
 */
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

  // Drivers
  DRIVER_LOG_CREATE: 'driver:log-create',
  DRIVER_LOG_VIEW: 'driver:log-view',
  DRIVER_FUEL_CREATE: 'driver:fuel-create',

  // Fuel
  FUEL_MANAGE: 'fuel:manage',
  FUEL_VERIFY: 'fuel:verify',
  FUEL_VIEW: 'fuel:view',

  // Staff
  STAFF_IMPORT: 'staff:import',
  STAFF_MANAGE: 'staff:manage',
  STAFF_VIEW: 'staff:view',

  // Audit
  AUDIT_READ: 'audit:read',
  AUDIT_EXPORT: 'audit:export',

  // Platform
  TENANT_MANAGE: 'tenant:manage',
  TENANT_VIEW: 'tenant:view',
  PLATFORM_ADMIN: 'platform:admin',
  PLATFORM_SUPPORT: 'platform:support',

  // Reports
  REPORT_VIEW: 'report:view',
  REPORT_EXPORT: 'report:export',

  // Files & uploads
  FILE_UPLOAD: 'file:upload',
  FILE_VIEW: 'file:view',
} as const;

export type PermissionCode = (typeof Permissions)[keyof typeof Permissions];

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
      Permissions.VEHICLE_CREATE,
      Permissions.VEHICLE_UPDATE,
      Permissions.TRIP_CLOSE,
      Permissions.TRIP_MANAGE,
      Permissions.TRIP_VIEW,
      Permissions.STAFF_MANAGE,
      Permissions.STAFF_IMPORT,
      Permissions.STAFF_VIEW,
      Permissions.FUEL_MANAGE,
      Permissions.FUEL_VERIFY,
      Permissions.FUEL_VIEW,
      Permissions.REPORT_VIEW,
      Permissions.REPORT_EXPORT,
      Permissions.INSPECTION_VIEW,
    ],
  },
  REQUESTER: {
    name: 'Requester / Programme Owner',
    isSystem: true,
    permissions: [
      Permissions.REQUEST_CREATE,
      Permissions.REQUEST_VIEW,
      Permissions.REQUEST_WITHDRAW,
    ],
  },
  SUPERVISOR: {
    name: 'Immediate Supervisor',
    isSystem: true,
    permissions: [
      Permissions.REQUEST_VIEW,
      Permissions.REQUEST_APPROVE_SUPERVISOR,
    ],
  },
  CONTROL_ADMIN_OFFICER: {
    name: 'Control Administrative Officer',
    isSystem: true,
    permissions: [
      Permissions.VEHICLE_RELEASE_REGIONAL,
      Permissions.INSPECTION_PERFORM,
      Permissions.INSPECTION_VIEW,
      Permissions.TRIP_VIEW,
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
    ],
  },
  fuel: {
    label: 'Fuel Management',
    permissions: [Permissions.FUEL_MANAGE, Permissions.FUEL_VERIFY, Permissions.FUEL_VIEW],
  },
  staff: {
    label: 'Staff Management',
    permissions: [Permissions.STAFF_IMPORT, Permissions.STAFF_MANAGE, Permissions.STAFF_VIEW],
  },
  audit: {
    label: 'Audit',
    permissions: [Permissions.AUDIT_READ, Permissions.AUDIT_EXPORT],
  },
  platform: {
    label: 'Platform Administration',
    permissions: [Permissions.TENANT_MANAGE, Permissions.TENANT_VIEW],
  },
  reports: {
    label: 'Reports',
    permissions: [Permissions.REPORT_VIEW, Permissions.REPORT_EXPORT],
  },
  files: {
    label: 'File Storage',
    permissions: [Permissions.FILE_UPLOAD, Permissions.FILE_VIEW],
  },
};
