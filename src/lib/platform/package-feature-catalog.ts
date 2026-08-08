import { Permissions, type PermissionCode } from '@/lib/permissions';

export type PackageFeatureKey =
  | 'vehicle_management'
  | 'trip_management'
  | 'fuel_tracking'
  | 'inspection_system'
  | 'driver_management'
  | 'maintenance_tracking'
  | 'reporting'
  | 'programme_management'
  | 'user_management'
  | 'advanced_analytics'
  | 'export_reports'
  | 'api_access'
  | 'priority_support'
  | 'custom_branding'
  | 'white_labeling'
  | 'dedicated_account_manager';

export const PACKAGE_FEATURES: ReadonlyArray<{
  key: PackageFeatureKey;
  label: string;
  description: string;
  permissions: readonly PermissionCode[];
}> = [
  {
    key: 'vehicle_management',
    label: 'Vehicle Management',
    description: 'Vehicle register, creation and operational management.',
    permissions: [
      Permissions.VEHICLE_VIEW,
      Permissions.VEHICLE_CREATE,
      Permissions.VEHICLE_UPDATE,
      Permissions.VEHICLE_MANAGE,
    ],
  },
  {
    key: 'trip_management',
    label: 'Trip Management',
    description: 'Trip visibility, operational management and closure.',
    permissions: [Permissions.TRIP_VIEW, Permissions.TRIP_MANAGE, Permissions.TRIP_CLOSE],
  },
  {
    key: 'fuel_tracking',
    label: 'Fuel Tracking',
    description: 'Fuel records, validation and verification.',
    permissions: [Permissions.FUEL_VIEW, Permissions.FUEL_MANAGE, Permissions.FUEL_VERIFY],
  },
  {
    key: 'inspection_system',
    label: 'Inspections',
    description: 'Vehicle inspection viewing and performance.',
    permissions: [Permissions.INSPECTION_VIEW, Permissions.INSPECTION_PERFORM],
  },
  {
    key: 'driver_management',
    label: 'Driver Management',
    description: 'Driver management, assignment and verification.',
    permissions: [Permissions.DRIVER_MANAGE, Permissions.DRIVER_ASSIGN, Permissions.DRIVER_VERIFY],
  },
  {
    key: 'maintenance_tracking',
    label: 'Maintenance',
    description: 'Maintenance visibility and management.',
    permissions: [Permissions.MAINTENANCE_VIEW, Permissions.MAINTENANCE_MANAGE],
  },
  {
    key: 'reporting',
    label: 'Reporting',
    description: 'Operational reporting access.',
    permissions: [Permissions.REPORT_VIEW],
  },
  {
    key: 'programme_management',
    label: 'Programme Management',
    description: 'Programme viewing, creation and submission.',
    permissions: [
      Permissions.PROGRAMME_VIEW,
      Permissions.PROGRAMME_CREATE,
      Permissions.PROGRAMME_SUBMIT,
    ],
  },
  {
    key: 'user_management',
    label: 'User Management',
    description: 'Tenant user viewing, invitations and account-status management.',
    permissions: [
      Permissions.USER_VIEW,
      Permissions.USER_INVITE,
      Permissions.USER_MANAGE_STATUS,
    ],
  },
  {
    key: 'advanced_analytics',
    label: 'Advanced Analytics',
    description: 'Extended analytics and export capability.',
    permissions: [Permissions.REPORT_EXPORT],
  },
  {
    key: 'export_reports',
    label: 'Report Export',
    description: 'Exportable reporting and audit outputs.',
    permissions: [Permissions.REPORT_EXPORT],
  },
  {
    key: 'api_access',
    label: 'API Access',
    description: 'Reserved package flag for supported API integrations.',
    permissions: [],
  },
  {
    key: 'priority_support',
    label: 'Priority Support',
    description: 'Commercial support entitlement.',
    permissions: [],
  },
  {
    key: 'custom_branding',
    label: 'Custom Branding',
    description: 'Tenant branding entitlement.',
    permissions: [],
  },
  {
    key: 'white_labeling',
    label: 'White Labelling',
    description: 'Reserved white-label commercial entitlement.',
    permissions: [],
  },
  {
    key: 'dedicated_account_manager',
    label: 'Dedicated Account Manager',
    description: 'Commercial service entitlement.',
    permissions: [],
  },
] as const;

export function normalisePackageFeatures(input: Record<string, boolean> | undefined) {
  const allowed = new Set(PACKAGE_FEATURES.map((feature) => feature.key));
  return Object.fromEntries(
    Object.entries(input ?? {})
      .filter(([key]) => allowed.has(key as PackageFeatureKey))
      .map(([key, value]) => [key, Boolean(value)]),
  ) as Record<string, boolean>;
}

export function entitlementsForFeatures(features: Record<string, boolean>) {
  const enabled = new Set(
    Object.entries(features)
      .filter(([, value]) => value)
      .map(([key]) => key),
  );

  const permissions = new Set<PermissionCode>();
  for (const feature of PACKAGE_FEATURES) {
    if (!enabled.has(feature.key)) continue;
    for (const permission of feature.permissions) permissions.add(permission);
  }

  return [...permissions].map((permissionCode) => ({
    permissionCode,
    isIncluded: true,
  }));
}
