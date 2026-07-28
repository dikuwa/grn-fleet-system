/**
 * The single dashboard authorization policy.
 *
 * A capability is never sufficient by itself: every grant also declares its
 * tenant/record scope, access mode, allowed actions, navigation visibility,
 * direct URL behaviour, and notification-link eligibility.
 */

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

export type DashboardAccessMode =
  | 'platform_manage'
  | 'tenant_manage'
  | 'tenant_read'
  | 'tenant_read_only'
  | 'assigned_manage'
  | 'assigned_read'
  | 'own_manage'
  | 'own_read'
  | 'related_read'
  | 'none';
export type DashboardRecordScope = 'self' | 'assigned' | 'related' | 'tenant' | 'platform';
export type DashboardAction = 'view' | 'create' | 'update' | 'delete' | 'import' | 'export' | 'approve';

type RouteGrant = {
  roles: readonly string[];
  accessMode: DashboardAccessMode;
  recordScope: DashboardRecordScope;
  actions: readonly DashboardAction[];
};

export type DashboardRouteRule = {
  prefix: string;
  capability: string;
  grants: readonly RouteGrant[];
  navigationVisible: boolean;
  directUrlBehaviour: '403' | '404';
  notificationLinkEligible: boolean;
  exact?: boolean;
};

const R = SystemRoles;
const APPROVERS = [R.SUPERVISOR, R.RELEASE_OFFICER, R.DEPUTY_DIRECTOR, R.DIRECTOR, R.CHIEF_REGIONAL_OFFICER] as const;
const OFFLINE = [R.REQUESTER, R.TRANSPORT_ADMIN, R.RELEASE_OFFICER, R.DRIVER, R.INSPECTOR] as const;
const VIEW: readonly DashboardAction[] = ['view'];
const READ_EXPORT: readonly DashboardAction[] = ['view', 'export'];
const MANAGE: readonly DashboardAction[] = ['view', 'create', 'update', 'delete', 'import', 'export'];
const OPERATE: readonly DashboardAction[] = ['view', 'create', 'update'];
const APPROVE: readonly DashboardAction[] = ['view', 'approve', 'update'];

const grant = (
  roles: readonly string[],
  accessMode: DashboardAccessMode,
  recordScope: DashboardRecordScope,
  actions: readonly DashboardAction[],
): RouteGrant => ({ roles, accessMode, recordScope, actions });

export const dashboardRoutePolicy: readonly DashboardRouteRule[] = [
  {
    prefix: '/dashboard/notifications/history',
    capability: 'notification:history',
    grants: [
      grant([R.TENANT_ADMIN], 'tenant_manage', 'tenant', READ_EXPORT),
      grant([R.AUDITOR], 'tenant_read_only', 'tenant', READ_EXPORT),
    ],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: false,
  },
  {
    prefix: '/dashboard/platform',
    capability: 'platform:manage',
    grants: [grant([R.PLATFORM_ADMIN], 'platform_manage', 'platform', MANAGE)],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },
  {
    prefix: '/dashboard/admin',
    capability: 'tenant:security-manage',
    grants: [grant([R.TENANT_ADMIN], 'tenant_manage', 'tenant', MANAGE)],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },
  {
    prefix: '/dashboard/settings',
    capability: 'tenant:settings-manage',
    grants: [grant([R.TENANT_ADMIN], 'tenant_manage', 'tenant', MANAGE)],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },
  {
    prefix: '/dashboard/offices',
    capability: 'tenant:organisation-manage',
    grants: [grant([R.TENANT_ADMIN], 'tenant_manage', 'tenant', MANAGE)],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },
  {
    prefix: '/dashboard/departments',
    capability: 'tenant:organisation-manage',
    grants: [grant([R.TENANT_ADMIN], 'tenant_manage', 'tenant', MANAGE)],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },
  {
    prefix: '/dashboard/delegations',
    capability: 'tenant:acting-roles',
    grants: [
      grant([R.TENANT_ADMIN], 'tenant_manage', 'tenant', MANAGE),
      grant([R.AUDITOR], 'tenant_read_only', 'tenant', VIEW),
    ],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },

  { prefix: '/dashboard/staff/new', capability: 'staff:create', grants: [grant([R.TENANT_ADMIN], 'tenant_manage', 'tenant', ['view', 'create'])], navigationVisible: false, directUrlBehaviour: '403', notificationLinkEligible: false },
  { prefix: '/dashboard/staff/import', capability: 'staff:import', grants: [grant([R.TENANT_ADMIN], 'tenant_manage', 'tenant', ['view', 'import'])], navigationVisible: false, directUrlBehaviour: '403', notificationLinkEligible: false },
  { prefix: '/dashboard/staff/imports', capability: 'staff:import-history', grants: [grant([R.TENANT_ADMIN], 'tenant_manage', 'tenant', ['view', 'import'])], navigationVisible: false, directUrlBehaviour: '403', notificationLinkEligible: false },
  {
    prefix: '/dashboard/staff',
    capability: 'staff:view',
    grants: [
      grant([R.TENANT_ADMIN], 'tenant_manage', 'tenant', MANAGE),
      grant([R.AUDITOR], 'tenant_read_only', 'tenant', READ_EXPORT),
    ],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },
  {
    prefix: '/dashboard/drivers',
    capability: 'driver:oversight',
    grants: [
      grant([R.TENANT_ADMIN], 'tenant_manage', 'tenant', MANAGE),
      grant([R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', MANAGE),
    ],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },

  {
    prefix: '/dashboard/audit',
    capability: 'audit:view',
    grants: [
      grant([R.TENANT_ADMIN], 'tenant_read', 'tenant', READ_EXPORT),
      grant([R.AUDITOR], 'tenant_read_only', 'tenant', READ_EXPORT),
    ],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },
  {
    prefix: '/dashboard/reports',
    capability: 'report:view',
    grants: [
      grant([R.TENANT_ADMIN, R.TRANSPORT_ADMIN], 'tenant_read', 'tenant', READ_EXPORT),
      grant([R.AUDITOR], 'tenant_read_only', 'tenant', READ_EXPORT),
    ],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },
  { prefix: '/dashboard/share-links', capability: 'document:share', grants: [grant([R.TENANT_ADMIN, R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', MANAGE)], navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true },
  {
    prefix: '/dashboard/documents',
    capability: 'document:view',
    grants: [
      grant([R.TENANT_ADMIN, R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', MANAGE),
      grant([R.AUDITOR], 'tenant_read_only', 'tenant', READ_EXPORT),
    ],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },

  { prefix: '/dashboard/driver-mobile', capability: 'driver:console', grants: [grant([R.DRIVER], 'assigned_manage', 'assigned', OPERATE)], navigationVisible: true, directUrlBehaviour: '404', notificationLinkEligible: true },
  { prefix: '/dashboard/driver-self-service', capability: 'driver:self-service', grants: [grant([R.DRIVER], 'own_manage', 'self', OPERATE)], navigationVisible: true, directUrlBehaviour: '404', notificationLinkEligible: true },
  { prefix: '/dashboard/logs', capability: 'driver:logs', grants: [grant([R.DRIVER], 'own_manage', 'self', OPERATE), grant([R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', OPERATE)], navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true },
  {
    prefix: '/dashboard/approvals',
    capability: 'workflow:assigned-action',
    grants: [
      grant([R.TRANSPORT_ADMIN], 'assigned_manage', 'assigned', APPROVE),
      grant(APPROVERS, 'assigned_manage', 'assigned', APPROVE),
    ],
    navigationVisible: true, directUrlBehaviour: '404', notificationLinkEligible: true,
  },

  { prefix: '/dashboard/requests/new', capability: 'request:create', grants: [grant([R.REQUESTER], 'own_manage', 'self', ['view', 'create']), grant([R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', ['view', 'create'])], navigationVisible: false, directUrlBehaviour: '403', notificationLinkEligible: false },
  {
    prefix: '/dashboard/programmes',
    capability: 'programme:view',
    grants: [
      grant([R.REQUESTER], 'own_manage', 'self', OPERATE),
      grant([R.TENANT_ADMIN], 'tenant_manage', 'tenant', MANAGE),
    ],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },
  {
    prefix: '/dashboard/requests',
    capability: 'request:view',
    grants: [
      grant([R.REQUESTER], 'own_manage', 'self', OPERATE),
      grant([R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', OPERATE),
      grant([R.TENANT_ADMIN], 'tenant_read', 'tenant', READ_EXPORT),
      grant([R.AUDITOR], 'tenant_read_only', 'tenant', READ_EXPORT),
    ],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },
  { prefix: '/dashboard/allocations/new', capability: 'allocation:create', grants: [grant([R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', OPERATE)], navigationVisible: false, directUrlBehaviour: '403', notificationLinkEligible: false },
  {
    prefix: '/dashboard/allocations',
    capability: 'allocation:view',
    grants: [
      grant([R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', OPERATE),
      grant([R.TENANT_ADMIN], 'tenant_read', 'tenant', VIEW),
    ],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },

  { prefix: '/dashboard/trips/closure-review', capability: 'trip:closure-review', grants: [grant([R.TRANSPORT_ADMIN], 'assigned_manage', 'assigned', APPROVE), grant([R.TENANT_ADMIN], 'tenant_read', 'tenant', VIEW)], navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true },
  { prefix: '/dashboard/trips/active', capability: 'trip:active-operations', grants: [grant([R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', OPERATE), grant([R.TENANT_ADMIN], 'tenant_read', 'tenant', VIEW)], navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true },
  {
    prefix: '/dashboard/trips',
    capability: 'trip:view',
    grants: [
      grant([R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', OPERATE),
      grant([R.DRIVER], 'assigned_manage', 'assigned', OPERATE),
      grant([R.TENANT_ADMIN], 'tenant_read', 'tenant', READ_EXPORT),
      grant([R.AUDITOR], 'tenant_read_only', 'tenant', READ_EXPORT),
    ],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },
  { prefix: '/dashboard/fuel/new', capability: 'fuel:create', grants: [grant([R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', OPERATE), grant([R.DRIVER], 'own_manage', 'self', ['view', 'create'])], navigationVisible: false, directUrlBehaviour: '403', notificationLinkEligible: false },
  {
    prefix: '/dashboard/fuel',
    capability: 'fuel:view',
    grants: [
      grant([R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', OPERATE),
      grant([R.DRIVER], 'own_manage', 'self', OPERATE),
      grant([R.TENANT_ADMIN], 'tenant_read', 'tenant', READ_EXPORT),
      grant([R.AUDITOR], 'tenant_read_only', 'tenant', READ_EXPORT),
    ],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },
  { prefix: '/dashboard/reimbursements', capability: 'reimbursement:view', grants: [grant([R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', OPERATE), grant([R.TENANT_ADMIN], 'tenant_read', 'tenant', VIEW)], navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true },

  { prefix: '/dashboard/fleet/new', capability: 'fleet:create', grants: [grant([R.TENANT_ADMIN, R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', ['view', 'create'])], navigationVisible: false, directUrlBehaviour: '403', notificationLinkEligible: false },
  { prefix: '/dashboard/fleet/import', capability: 'fleet:import', grants: [grant([R.TENANT_ADMIN, R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', ['view', 'import'])], navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: false },
  { prefix: '/dashboard/fleet/imports', capability: 'fleet:import-history', grants: [grant([R.TENANT_ADMIN, R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', ['view', 'import'])], navigationVisible: false, directUrlBehaviour: '403', notificationLinkEligible: false },
  { prefix: '/dashboard/fleet/map', capability: 'fleet:map', grants: [grant([R.TENANT_ADMIN, R.TRANSPORT_ADMIN], 'tenant_read', 'tenant', VIEW)], navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true },
  {
    prefix: '/dashboard/fleet/compliance',
    capability: 'fleet:compliance',
    grants: [
      grant([R.TENANT_ADMIN, R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', MANAGE),
      grant([R.AUDITOR], 'tenant_read_only', 'tenant', READ_EXPORT),
    ],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },
  { prefix: '/dashboard/fleet/predictive-maintenance', capability: 'fleet:predictive-maintenance', grants: [grant([R.TENANT_ADMIN, R.TRANSPORT_ADMIN], 'tenant_read', 'tenant', VIEW), grant([R.MAINTENANCE], 'related_read', 'related', VIEW)], navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true },
  { prefix: '/dashboard/fleet/expenses', capability: 'fleet:expenses', grants: [grant([R.TENANT_ADMIN], 'tenant_read', 'tenant', VIEW), grant([R.TRANSPORT_ADMIN, R.MAINTENANCE], 'tenant_manage', 'tenant', OPERATE), grant([R.AUDITOR], 'tenant_read_only', 'tenant', VIEW)], navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true },
  { prefix: '/dashboard/fleet/defects', capability: 'fleet:defects', grants: [grant([R.TRANSPORT_ADMIN, R.MAINTENANCE], 'tenant_manage', 'tenant', OPERATE), grant([R.TENANT_ADMIN], 'tenant_read', 'tenant', VIEW), grant([R.AUDITOR], 'tenant_read_only', 'tenant', VIEW)], navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true },
  {
    prefix: '/dashboard/fleet',
    capability: 'fleet:view',
    grants: [
      grant([R.TENANT_ADMIN, R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', MANAGE),
      grant([R.MAINTENANCE], 'tenant_read', 'tenant', VIEW),
      grant([R.AUDITOR], 'tenant_read_only', 'tenant', READ_EXPORT),
    ],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },
  { prefix: '/dashboard/expiry-alerts', capability: 'compliance:expiry', grants: [grant([R.TENANT_ADMIN, R.TRANSPORT_ADMIN], 'tenant_read', 'tenant', READ_EXPORT), grant([R.MAINTENANCE], 'related_read', 'related', VIEW), grant([R.AUDITOR], 'tenant_read_only', 'tenant', VIEW)], navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true },
  { prefix: '/dashboard/maintenance/new', capability: 'maintenance:create', grants: [grant([R.TRANSPORT_ADMIN, R.MAINTENANCE], 'tenant_manage', 'tenant', OPERATE)], navigationVisible: false, directUrlBehaviour: '403', notificationLinkEligible: false },
  {
    prefix: '/dashboard/maintenance',
    capability: 'maintenance:view',
    grants: [
      grant([R.TRANSPORT_ADMIN, R.MAINTENANCE], 'tenant_manage', 'tenant', OPERATE),
      grant([R.TENANT_ADMIN], 'tenant_read', 'tenant', VIEW),
      grant([R.AUDITOR], 'tenant_read_only', 'tenant', READ_EXPORT),
    ],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },

  { prefix: '/dashboard/inspections/templates', capability: 'inspection:templates', grants: [grant([R.TENANT_ADMIN, R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', MANAGE)], navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true },
  { prefix: '/dashboard/inspections/new', capability: 'inspection:perform', grants: [grant([R.TRANSPORT_ADMIN, R.RELEASE_OFFICER, R.DRIVER, R.INSPECTOR], 'assigned_manage', 'assigned', OPERATE)], navigationVisible: false, directUrlBehaviour: '404', notificationLinkEligible: false },
  { prefix: '/dashboard/inspections/departure', capability: 'inspection:perform', grants: [grant([R.TRANSPORT_ADMIN, R.RELEASE_OFFICER, R.DRIVER, R.INSPECTOR], 'assigned_manage', 'assigned', OPERATE)], navigationVisible: false, directUrlBehaviour: '404', notificationLinkEligible: false },
  { prefix: '/dashboard/inspections/return', capability: 'inspection:perform', grants: [grant([R.TRANSPORT_ADMIN, R.RELEASE_OFFICER, R.DRIVER, R.INSPECTOR], 'assigned_manage', 'assigned', OPERATE)], navigationVisible: false, directUrlBehaviour: '404', notificationLinkEligible: false },
  {
    prefix: '/dashboard/inspections',
    capability: 'inspection:view',
    grants: [
      grant([R.TRANSPORT_ADMIN], 'tenant_manage', 'tenant', OPERATE),
      grant([R.RELEASE_OFFICER, R.DRIVER, R.INSPECTOR], 'assigned_manage', 'assigned', OPERATE),
      grant([R.TENANT_ADMIN], 'tenant_read', 'tenant', VIEW),
      grant([R.AUDITOR], 'tenant_read_only', 'tenant', READ_EXPORT),
    ],
    navigationVisible: true, directUrlBehaviour: '403', notificationLinkEligible: true,
  },
  { prefix: '/dashboard/sync-conflicts', capability: 'offline:own', grants: [grant(OFFLINE, 'own_manage', 'self', OPERATE)], navigationVisible: false, directUrlBehaviour: '404', notificationLinkEligible: false },
  { prefix: '/dashboard/offline', capability: 'offline:own', grants: [grant(OFFLINE, 'own_manage', 'self', OPERATE)], navigationVisible: true, directUrlBehaviour: '404', notificationLinkEligible: false },
];

const modeRank: Record<DashboardAccessMode, number> = {
  none: 0,
  own_read: 1,
  related_read: 2,
  assigned_read: 3,
  tenant_read_only: 4,
  tenant_read: 5,
  own_manage: 6,
  assigned_manage: 7,
  tenant_manage: 8,
  platform_manage: 9,
};

function pathMatches(pathname: string, rule: DashboardRouteRule) {
  return rule.exact ? pathname === rule.prefix : pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`);
}

export function resolveDashboardAccess(pathname: string, roleNames: readonly string[]) {
  if (pathname === '/dashboard' || pathname === '/dashboard/profile' || pathname === '/dashboard/notifications') {
    return {
      allowed: true,
      capability: 'authenticated:common',
      accessMode: 'own_read' as DashboardAccessMode,
      recordScope: pathname === '/dashboard/notifications' ? 'tenant' as const : 'self' as const,
      actions: VIEW,
      navigationVisible: true,
      directUrlBehaviour: '403' as const,
      notificationLinkEligible: true,
    };
  }
  const rule = dashboardRoutePolicy.find((candidate) => pathMatches(pathname, candidate));
  if (!rule) return { allowed: false, capability: null, accessMode: 'none' as const, recordScope: null, actions: [] as readonly DashboardAction[], navigationVisible: false, directUrlBehaviour: '403' as const, notificationLinkEligible: false };
  const matching = rule.grants.filter((candidate) => candidate.roles.some((role) => roleNames.includes(role)));
  const selected = matching.sort((a, b) => modeRank[b.accessMode] - modeRank[a.accessMode])[0];
  if (!selected) return { allowed: false, capability: rule.capability, accessMode: 'none' as const, recordScope: null, actions: [] as readonly DashboardAction[], navigationVisible: false, directUrlBehaviour: rule.directUrlBehaviour, notificationLinkEligible: false };
  const actions = Array.from(new Set(matching.flatMap((candidate) => candidate.actions)));
  return { allowed: true, capability: rule.capability, accessMode: selected.accessMode, recordScope: selected.recordScope, actions, navigationVisible: rule.navigationVisible, directUrlBehaviour: rule.directUrlBehaviour, notificationLinkEligible: rule.notificationLinkEligible };
}

export function canAccessDashboardPath(pathname: string, roleNames: readonly string[]) {
  return resolveDashboardAccess(pathname, roleNames).allowed;
}

export function canNavigateDashboardPath(pathname: string, roleNames: readonly string[]) {
  const access = resolveDashboardAccess(pathname, roleNames);
  return access.allowed && access.navigationVisible;
}

export function canPerformDashboardAction(pathname: string, roleNames: readonly string[], action: DashboardAction) {
  const access = resolveDashboardAccess(pathname, roleNames);
  return access.allowed && access.actions.includes(action);
}
