import { Permissions, type PermissionCode } from '@/lib/permissions';

type DashboardAccessRule = { prefix: string; anyOf: PermissionCode[] };

// Longest/specific prefixes must come first.
export const dashboardAccessRules: DashboardAccessRule[] = [
  { prefix: '/dashboard/platform', anyOf: [Permissions.PLATFORM_ADMIN] },
  { prefix: '/dashboard/admin', anyOf: [Permissions.TENANT_MANAGE] },
  { prefix: '/dashboard/settings', anyOf: [Permissions.TENANT_MANAGE] },
  { prefix: '/dashboard/offices', anyOf: [Permissions.TENANT_MANAGE] },
  { prefix: '/dashboard/departments', anyOf: [Permissions.TENANT_MANAGE] },
  { prefix: '/dashboard/audit', anyOf: [Permissions.AUDIT_READ] },
  { prefix: '/dashboard/reports', anyOf: [Permissions.REPORT_VIEW] },
  { prefix: '/dashboard/documents', anyOf: [Permissions.FILE_VIEW] },
  { prefix: '/dashboard/share-links', anyOf: [Permissions.FILE_VIEW] },
  { prefix: '/dashboard/driver-mobile', anyOf: [Permissions.DRIVER_LOG_VIEW] },
  { prefix: '/dashboard/driver-self-service', anyOf: [Permissions.DRIVER_LOG_VIEW] },
  { prefix: '/dashboard/profile', anyOf: [Permissions.REQUEST_VIEW, Permissions.VEHICLE_VIEW, Permissions.STAFF_VIEW] },
  { prefix: '/dashboard/logs', anyOf: [Permissions.DRIVER_LOG_VIEW, Permissions.TRIP_MANAGE] },
  { prefix: '/dashboard/approvals', anyOf: [
    Permissions.REQUEST_APPROVE_SUPERVISOR,
    Permissions.REQUEST_REVIEW_TRANSPORT,
    Permissions.VEHICLE_RELEASE_REGIONAL,
    Permissions.VEHICLE_RELEASE_NATIONAL,
    Permissions.TRIP_AUTHORIZE_REGIONAL,
    Permissions.TRIP_AUTHORIZE_NATIONAL,
  ] },
  { prefix: '/dashboard/requests/new', anyOf: [Permissions.REQUEST_CREATE] },
  { prefix: '/dashboard/programmes', anyOf: [Permissions.REQUEST_CREATE, Permissions.REQUEST_VIEW] },
  { prefix: '/dashboard/requests', anyOf: [Permissions.REQUEST_CREATE, Permissions.REQUEST_VIEW] },
  { prefix: '/dashboard/allocations', anyOf: [Permissions.ALLOCATION_MANAGE, Permissions.ALLOCATION_CREATE] },
  { prefix: '/dashboard/trips', anyOf: [Permissions.TRIP_VIEW, Permissions.TRIP_MANAGE] },
  { prefix: '/dashboard/fuel', anyOf: [Permissions.FUEL_VIEW, Permissions.FUEL_MANAGE, Permissions.DRIVER_FUEL_CREATE] },
  { prefix: '/dashboard/reimbursements', anyOf: [Permissions.FUEL_VIEW, Permissions.FUEL_MANAGE] },
  { prefix: '/dashboard/maintenance', anyOf: [Permissions.MAINTENANCE_VIEW, Permissions.MAINTENANCE_MANAGE] },
  { prefix: '/dashboard/fleet/defects', anyOf: [Permissions.MAINTENANCE_VIEW, Permissions.MAINTENANCE_MANAGE] },
  { prefix: '/dashboard/fleet', anyOf: [Permissions.VEHICLE_VIEW, Permissions.VEHICLE_MANAGE] },
  { prefix: '/dashboard/expiry-alerts', anyOf: [Permissions.VEHICLE_VIEW, Permissions.STAFF_VIEW] },
  { prefix: '/dashboard/inspections', anyOf: [Permissions.INSPECTION_VIEW, Permissions.INSPECTION_PERFORM] },
  { prefix: '/dashboard/drivers', anyOf: [Permissions.STAFF_VIEW, Permissions.DRIVER_MANAGE] },
  { prefix: '/dashboard/staff', anyOf: [Permissions.STAFF_VIEW, Permissions.STAFF_MANAGE] },
];

export function canAccessDashboardPath(pathname: string, permissionCodes: readonly string[]) {
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/notifications') || pathname.startsWith('/dashboard/offline')) return true;
  const rule = dashboardAccessRules.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return Boolean(rule?.anyOf.some((permission) => permissionCodes.includes(permission)));
}
