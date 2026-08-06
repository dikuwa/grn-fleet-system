/**
 * Canonical dashboard route, navigation and authorization registry.
 *
 * Workspace selection narrows an already-valid role assignment. It never adds
 * a role or permission. Server record queries must still apply the returned
 * recordScope in addition to the tenant boundary.
 */

import {
  resolveActiveWorkspace,
  WorkspaceIds,
  type WorkspaceId,
} from '@/lib/workspaces';

export { SystemRoles } from '@/lib/workspaces';
export type { WorkspaceId } from '@/lib/workspaces';

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
export type DashboardAction =
  'view' | 'create' | 'update' | 'delete' | 'import' | 'export' | 'approve';

type RouteAccess = {
  accessMode: DashboardAccessMode;
  recordScope: DashboardRecordScope;
  actions: readonly DashboardAction[];
};

export type RouteDefinition = {
  id: string;
  path: string;
  href?: string;
  label: string;
  icon?: string;
  section: string;
  workspaces: readonly WorkspaceId[];
  access: Partial<Record<WorkspaceId, RouteAccess>>;
  requiredPermissions?: readonly string[];
  requiredAnyPermissions?: readonly string[];
  tenantScoped: boolean;
  platformOnly?: boolean;
  personalRoute?: boolean;
  badgeQuery?: string;
  featureFlag?: string;
  order: number;
  navigationVisible?: boolean;
  directUrlBehaviour?: '403' | '404';
  notificationLinkEligible?: boolean;
  exact?: boolean;
  labelByWorkspace?: Partial<Record<WorkspaceId, string>>;
  sectionByWorkspace?: Partial<Record<WorkspaceId, string>>;
};

const W = WorkspaceIds;
const TENANT_WORKSPACES: readonly WorkspaceId[] = [
  W.PERSONAL,
  W.APPROVER,
  W.DRIVER,
  W.INSPECTOR,
  W.MAINTENANCE,
  W.TRANSPORT_ADMIN,
  W.TENANT_ADMIN,
  W.AUDIT,
];
const ALL_WORKSPACES: readonly WorkspaceId[] = [...TENANT_WORKSPACES, W.PLATFORM_ADMIN];
const VIEW: readonly DashboardAction[] = ['view'];
const READ_EXPORT: readonly DashboardAction[] = ['view', 'export'];
const OPERATE: readonly DashboardAction[] = ['view', 'create', 'update'];
const MANAGE: readonly DashboardAction[] = [
  'view',
  'create',
  'update',
  'delete',
  'import',
  'export',
];
const APPROVE: readonly DashboardAction[] = ['view', 'approve', 'update'];

const ownRead = (): RouteAccess => ({ accessMode: 'own_read', recordScope: 'self', actions: VIEW });
const ownManage = (actions: readonly DashboardAction[] = OPERATE): RouteAccess => ({
  accessMode: 'own_manage',
  recordScope: 'self',
  actions,
});
const assignedRead = (): RouteAccess => ({
  accessMode: 'assigned_read',
  recordScope: 'assigned',
  actions: VIEW,
});
const assignedManage = (actions: readonly DashboardAction[] = OPERATE): RouteAccess => ({
  accessMode: 'assigned_manage',
  recordScope: 'assigned',
  actions,
});
const relatedRead = (): RouteAccess => ({
  accessMode: 'related_read',
  recordScope: 'related',
  actions: VIEW,
});
const tenantRead = (readOnly = false): RouteAccess => ({
  accessMode: readOnly ? 'tenant_read_only' : 'tenant_read',
  recordScope: 'tenant',
  actions: READ_EXPORT,
});
const tenantManage = (actions: readonly DashboardAction[] = MANAGE): RouteAccess => ({
  accessMode: 'tenant_manage',
  recordScope: 'tenant',
  actions,
});
const platformManage = (): RouteAccess => ({
  accessMode: 'platform_manage',
  recordScope: 'platform',
  actions: MANAGE,
});
const every = (workspaces: readonly WorkspaceId[], value: RouteAccess) =>
  Object.fromEntries(workspaces.map((workspace) => [workspace, value])) as Partial<
    Record<WorkspaceId, RouteAccess>
  >;

export const routeRegistry: readonly RouteDefinition[] = [
  {
    id: 'dashboard',
    path: '/dashboard',
    label: 'Dashboard',
    icon: 'LayoutDashboard',
    section: 'Overview',
    workspaces: ALL_WORKSPACES,
    access: every(ALL_WORKSPACES, ownRead()),
    tenantScoped: false,
    personalRoute: true,
    order: 10,
    exact: true,
    navigationVisible: true,
  },
  {
    id: 'profile',
    path: '/dashboard/profile',
    label: 'My Profile',
    icon: 'User',
    section: 'Overview',
    workspaces: ALL_WORKSPACES,
    access: every(ALL_WORKSPACES, ownManage(['view', 'update'])),
    tenantScoped: false,
    personalRoute: true,
    order: 20,
    navigationVisible: true,
  },
  {
    id: 'request-new',
    path: '/dashboard/requests/new',
    label: 'New Transport Request',
    icon: 'FilePlus2',
    section: 'My Transport',
    workspaces: TENANT_WORKSPACES,
    access: every(TENANT_WORKSPACES, ownManage(['view', 'create'])),
    tenantScoped: true,
    personalRoute: true,
    order: 30,
    navigationVisible: true,
    notificationLinkEligible: false,
  },
  {
    id: 'requests',
    path: '/dashboard/requests',
    label: 'My Requests',
    icon: 'FileText',
    section: 'My Transport',
    workspaces: TENANT_WORKSPACES,
    access: {
      ...every(TENANT_WORKSPACES, ownManage()),
      [W.TRANSPORT_ADMIN]: tenantManage(OPERATE),
      [W.AUDIT]: tenantRead(true),
    },
    labelByWorkspace: {
      [W.TRANSPORT_ADMIN]: 'Incoming Operational Requests',
      [W.AUDIT]: 'Request Register',
    },
    tenantScoped: true,
    personalRoute: true,
    order: 40,
    navigationVisible: true,
  },
  {
    id: 'request-drafts',
    path: '/dashboard/requests',
    href: '/dashboard/requests?status=draft',
    label: 'My Drafts',
    icon: 'ClipboardList',
    section: 'My Transport',
    workspaces: [W.PERSONAL],
    access: { [W.PERSONAL]: ownManage() },
    tenantScoped: true,
    personalRoute: true,
    order: 50,
    navigationVisible: true,
    exact: true,
    badgeQuery: 'requests:drafts',
  },
  {
    id: 'programmes',
    path: '/dashboard/programmes',
    label: 'My Programmes',
    icon: 'ClipboardList',
    section: 'Programmes',
    workspaces: [W.PERSONAL, W.TENANT_ADMIN],
    access: { [W.PERSONAL]: ownManage(), [W.TENANT_ADMIN]: tenantManage() },
    labelByWorkspace: { [W.TENANT_ADMIN]: 'Programmes' },
    tenantScoped: true,
    order: 60,
    navigationVisible: true,
  },
  {
    id: 'notifications',
    path: '/dashboard/notifications',
    label: 'Notifications',
    icon: 'Bell',
    section: 'Personal',
    workspaces: ALL_WORKSPACES,
    access: every(ALL_WORKSPACES, ownManage(['view', 'update'])),
    tenantScoped: true,
    personalRoute: true,
    order: 900,
    navigationVisible: true,
  },
  {
    id: 'approvals',
    path: '/dashboard/approvals',
    label: 'Assigned Approvals',
    icon: 'ClipboardCheck',
    section: 'Approvals',
    workspaces: [W.APPROVER, W.TRANSPORT_ADMIN],
    access: { [W.APPROVER]: assignedManage(APPROVE), [W.TRANSPORT_ADMIN]: assignedManage(APPROVE) },
    tenantScoped: true,
    order: 100,
    navigationVisible: true,
    directUrlBehaviour: '404',
    badgeQuery: 'approvals:assigned',
  },
  {
    id: 'delegations',
    path: '/dashboard/delegations',
    label: 'My Delegations',
    icon: 'CalendarClock',
    section: 'Approvals',
    workspaces: [W.APPROVER, W.TENANT_ADMIN],
    access: { [W.APPROVER]: ownRead(), [W.TENANT_ADMIN]: tenantManage() },
    labelByWorkspace: { [W.TENANT_ADMIN]: 'Acting Roles & Delegations' },
    tenantScoped: true,
    order: 110,
    navigationVisible: true,
  },
  {
    id: 'driver-console',
    path: '/dashboard/driver-mobile',
    label: 'Driver Console',
    icon: 'Gauge',
    section: 'Driver',
    workspaces: [W.DRIVER],
    access: { [W.DRIVER]: assignedManage() },
    tenantScoped: true,
    order: 120,
    navigationVisible: true,
    directUrlBehaviour: '404',
    badgeQuery: 'trips:assigned-attention',
  },
  {
    id: 'driver-self-service',
    path: '/dashboard/driver-self-service',
    label: 'Driver Self-Service',
    icon: 'User',
    section: 'Driver',
    workspaces: [W.DRIVER],
    access: { [W.DRIVER]: ownManage() },
    tenantScoped: true,
    order: 130,
    navigationVisible: true,
  },
  {
    id: 'daily-logs',
    path: '/dashboard/logs',
    label: 'Daily Logs',
    icon: 'ClipboardCheck',
    section: 'Driver',
    workspaces: [W.DRIVER],
    access: { [W.DRIVER]: assignedManage() },
    tenantScoped: true,
    order: 140,
    navigationVisible: true,
  },
  {
    id: 'trips-readiness',
    path: '/dashboard/trips/readiness',
    label: 'Release Readiness',
    icon: 'ClipboardCheck',
    section: 'Driver',
    workspaces: [W.DRIVER, W.TRANSPORT_ADMIN],
    access: { [W.DRIVER]: assignedManage(), [W.TRANSPORT_ADMIN]: tenantManage(OPERATE) },
    sectionByWorkspace: { [W.TRANSPORT_ADMIN]: 'Allocations & Trips' },
    tenantScoped: true,
    order: 150,
    navigationVisible: true,
  },
  {
    id: 'trips-closure',
    path: '/dashboard/trips/closure-review',
    label: 'Closure Review',
    icon: 'Clock',
    section: 'Allocations & Trips',
    workspaces: [W.TRANSPORT_ADMIN],
    access: { [W.TRANSPORT_ADMIN]: assignedManage(APPROVE) },
    tenantScoped: true,
    order: 250,
    navigationVisible: true,
  },
  {
    id: 'trips-active',
    path: '/dashboard/trips/active',
    label: 'Active Trips',
    icon: 'Gauge',
    section: 'Allocations & Trips',
    workspaces: [W.TRANSPORT_ADMIN],
    access: { [W.TRANSPORT_ADMIN]: tenantManage(OPERATE) },
    tenantScoped: true,
    order: 240,
    navigationVisible: true,
  },
  {
    id: 'trips',
    path: '/dashboard/trips',
    label: 'Trips',
    icon: 'Gauge',
    section: 'Allocations & Trips',
    workspaces: [W.DRIVER, W.TRANSPORT_ADMIN, W.AUDIT],
    access: {
      [W.DRIVER]: assignedManage(),
      [W.TRANSPORT_ADMIN]: tenantManage(OPERATE),
      [W.AUDIT]: tenantRead(true),
    },
    labelByWorkspace: { [W.DRIVER]: 'Assigned Trips', [W.AUDIT]: 'Trip Register' },
    sectionByWorkspace: { [W.DRIVER]: 'Driver', [W.AUDIT]: 'Audit Registers' },
    tenantScoped: true,
    order: 160,
    navigationVisible: true,
    badgeQuery: 'trips:assigned-attention',
  },
  {
    id: 'fuel-new',
    path: '/dashboard/fuel/new',
    label: 'Record Fuel',
    section: 'Driver',
    workspaces: [W.DRIVER, W.TRANSPORT_ADMIN],
    access: {
      [W.DRIVER]: assignedManage(['view', 'create']),
      [W.TRANSPORT_ADMIN]: tenantManage(['view', 'create']),
    },
    tenantScoped: true,
    order: 165,
    navigationVisible: false,
    notificationLinkEligible: false,
  },
  {
    id: 'fuel',
    path: '/dashboard/fuel',
    label: 'My Fuel Entries',
    icon: 'Fuel',
    section: 'Driver',
    workspaces: [W.DRIVER, W.TRANSPORT_ADMIN, W.AUDIT],
    access: {
      [W.DRIVER]: assignedManage(),
      [W.TRANSPORT_ADMIN]: tenantManage(OPERATE),
      [W.AUDIT]: tenantRead(true),
    },
    labelByWorkspace: {
      [W.TRANSPORT_ADMIN]: 'Fuel Administration',
      [W.AUDIT]: 'Fuel & Expense Audit',
    },
    sectionByWorkspace: {
      [W.TRANSPORT_ADMIN]: 'Operational Management',
      [W.AUDIT]: 'Audit Registers',
    },
    tenantScoped: true,
    order: 170,
    navigationVisible: true,
  },
  {
    id: 'offline',
    path: '/dashboard/offline',
    label: 'Offline Drafts',
    icon: 'Database',
    section: 'Personal',
    workspaces: [W.DRIVER, W.INSPECTOR, W.MAINTENANCE, W.TRANSPORT_ADMIN],
    access: {
      [W.DRIVER]: ownManage(),
      [W.INSPECTOR]: ownManage(),
      [W.MAINTENANCE]: ownManage(),
      [W.TRANSPORT_ADMIN]: ownManage(),
    },
    tenantScoped: true,
    personalRoute: true,
    order: 180,
    navigationVisible: true,
    directUrlBehaviour: '404',
  },
  {
    id: 'sync-conflicts',
    path: '/dashboard/sync-conflicts',
    label: 'Sync Conflicts',
    section: 'Personal',
    workspaces: [W.DRIVER, W.INSPECTOR, W.MAINTENANCE, W.TRANSPORT_ADMIN],
    access: {
      [W.DRIVER]: ownManage(),
      [W.INSPECTOR]: ownManage(),
      [W.MAINTENANCE]: ownManage(),
      [W.TRANSPORT_ADMIN]: ownManage(),
    },
    tenantScoped: true,
    order: 181,
    navigationVisible: false,
    directUrlBehaviour: '404',
  },
  {
    id: 'inspections-template',
    path: '/dashboard/inspections/templates',
    label: 'Inspection Templates',
    icon: 'ClipboardList',
    section: 'Operational Management',
    workspaces: [W.TRANSPORT_ADMIN],
    access: { [W.TRANSPORT_ADMIN]: tenantManage() },
    tenantScoped: true,
    requiredPermissions: ['inspection-template:manage'],
    order: 205,
    navigationVisible: false,
  },
  {
    id: 'inspections-new',
    path: '/dashboard/inspections/new',
    label: 'Perform Inspection',
    section: 'Inspections',
    // Phase 32: drivers do not perform official inspections — only Inspectors,
    // Release Officers (INSPECTOR workspace) and Transport Administrators.
    workspaces: [W.INSPECTOR, W.TRANSPORT_ADMIN],
    access: {
      [W.INSPECTOR]: assignedManage(),
      [W.TRANSPORT_ADMIN]: tenantManage(OPERATE),
    },
    tenantScoped: true,
    order: 191,
    navigationVisible: false,
    directUrlBehaviour: '404',
  },
  {
    id: 'inspections-departure',
    path: '/dashboard/inspections/departure',
    label: 'Departure Inspection',
    section: 'Inspections',
    workspaces: [W.INSPECTOR, W.TRANSPORT_ADMIN],
    access: {
      [W.INSPECTOR]: assignedManage(),
      [W.TRANSPORT_ADMIN]: tenantManage(OPERATE),
    },
    tenantScoped: true,
    order: 192,
    navigationVisible: false,
    directUrlBehaviour: '404',
  },
  {
    id: 'inspections-return',
    path: '/dashboard/inspections/return',
    label: 'Return Inspection',
    section: 'Inspections',
    workspaces: [W.INSPECTOR, W.TRANSPORT_ADMIN],
    access: {
      [W.INSPECTOR]: assignedManage(),
      [W.TRANSPORT_ADMIN]: tenantManage(OPERATE),
    },
    tenantScoped: true,
    order: 193,
    navigationVisible: false,
    directUrlBehaviour: '404',
  },
  {
    id: 'inspections',
    path: '/dashboard/inspections',
    label: 'Assigned Inspections',
    icon: 'ClipboardCheck',
    section: 'Inspections',
    workspaces: [W.DRIVER, W.INSPECTOR, W.TRANSPORT_ADMIN, W.AUDIT],
    access: {
      [W.DRIVER]: assignedManage(['view']),
      [W.INSPECTOR]: assignedManage(),
      [W.TRANSPORT_ADMIN]: tenantManage(OPERATE),
      [W.AUDIT]: tenantRead(true),
    },
    labelByWorkspace: {
      [W.TRANSPORT_ADMIN]: 'Inspection Scheduling',
      [W.AUDIT]: 'Inspection Register',
    },
    sectionByWorkspace: {
      [W.TRANSPORT_ADMIN]: 'Operational Management',
      [W.AUDIT]: 'Audit Registers',
    },
    tenantScoped: true,
    order: 190,
    navigationVisible: true,
    badgeQuery: 'inspections:assigned',
  },
  {
    id: 'fleet-new',
    path: '/dashboard/fleet/new',
    label: 'Add Vehicle',
    section: 'Operational Management',
    workspaces: [W.TRANSPORT_ADMIN],
    access: { [W.TRANSPORT_ADMIN]: tenantManage(['view', 'create']) },
    tenantScoped: true,
    order: 211,
    navigationVisible: false,
  },
  {
    id: 'fleet-import',
    path: '/dashboard/fleet/import',
    label: 'Import Vehicles',
    icon: 'Truck',
    section: 'Operational Management',
    workspaces: [W.TRANSPORT_ADMIN],
    access: { [W.TRANSPORT_ADMIN]: tenantManage(['view', 'import']) },
    tenantScoped: true,
    order: 212,
    navigationVisible: false,
  },
  {
    id: 'fleet-import-history',
    path: '/dashboard/fleet/imports',
    label: 'Vehicle Imports',
    section: 'Operational Management',
    workspaces: [W.TRANSPORT_ADMIN],
    access: { [W.TRANSPORT_ADMIN]: tenantManage(['view', 'import']) },
    tenantScoped: true,
    order: 213,
    navigationVisible: false,
  },
  {
    id: 'fleet-map',
    path: '/dashboard/fleet/map',
    label: 'Fleet Map',
    section: 'Operational Management',
    workspaces: [W.TRANSPORT_ADMIN],
    access: { [W.TRANSPORT_ADMIN]: tenantRead() },
    tenantScoped: true,
    order: 214,
    navigationVisible: false,
  },
  {
    id: 'fleet-compliance',
    path: '/dashboard/fleet/compliance',
    label: 'Compliance Reports',
    icon: 'Shield',
    section: 'Audit Registers',
    workspaces: [W.TRANSPORT_ADMIN, W.AUDIT],
    access: { [W.TRANSPORT_ADMIN]: tenantManage(), [W.AUDIT]: tenantRead(true) },
    sectionByWorkspace: { [W.TRANSPORT_ADMIN]: 'Operational Management' },
    tenantScoped: true,
    order: 215,
    navigationVisible: true,
  },
  {
    id: 'fleet-predictive',
    path: '/dashboard/fleet/predictive-maintenance',
    label: 'Predictive Maintenance',
    icon: 'BrainCircuit',
    section: 'Maintenance',
    workspaces: [W.MAINTENANCE],
    access: { [W.MAINTENANCE]: relatedRead() },
    tenantScoped: true,
    order: 220,
    navigationVisible: true,
  },
  {
    id: 'fleet-expenses',
    path: '/dashboard/fleet/expenses',
    label: 'Fuel & Expense Audit',
    icon: 'Receipt',
    section: 'Audit Registers',
    workspaces: [W.AUDIT],
    access: { [W.AUDIT]: tenantRead(true) },
    tenantScoped: true,
    order: 221,
    navigationVisible: true,
  },
  {
    id: 'fleet-defects',
    path: '/dashboard/fleet/defects',
    label: 'Reported Defects',
    icon: 'AlertTriangle',
    section: 'Inspections',
    workspaces: [W.INSPECTOR, W.MAINTENANCE, W.AUDIT],
    access: {
      [W.INSPECTOR]: ownRead(),
      [W.MAINTENANCE]: assignedManage(),
      [W.AUDIT]: tenantRead(true),
    },
    labelByWorkspace: { [W.MAINTENANCE]: 'Defects', [W.AUDIT]: 'Defect Register' },
    sectionByWorkspace: { [W.MAINTENANCE]: 'Maintenance', [W.AUDIT]: 'Audit Registers' },
    tenantScoped: true,
    order: 200,
    navigationVisible: true,
  },
  {
    id: 'fleet',
    path: '/dashboard/fleet',
    label: 'Vehicle Lookup',
    icon: 'CarFront',
    section: 'Inspections',
    workspaces: [W.INSPECTOR, W.MAINTENANCE, W.TRANSPORT_ADMIN, W.AUDIT],
    access: {
      [W.INSPECTOR]: assignedRead(),
      [W.MAINTENANCE]: relatedRead(),
      [W.TRANSPORT_ADMIN]: tenantManage(),
      [W.AUDIT]: tenantRead(true),
    },
    labelByWorkspace: { [W.TRANSPORT_ADMIN]: 'Fleet', [W.AUDIT]: 'Vehicle Register' },
    sectionByWorkspace: {
      [W.MAINTENANCE]: 'Maintenance',
      [W.TRANSPORT_ADMIN]: 'Operational Management',
      [W.AUDIT]: 'Audit Registers',
    },
    tenantScoped: true,
    order: 210,
    navigationVisible: true,
  },
  {
    id: 'expiry-alerts',
    path: '/dashboard/expiry-alerts',
    label: 'Expiry Alerts',
    icon: 'CalendarClock',
    section: 'Maintenance',
    workspaces: [W.MAINTENANCE],
    access: { [W.MAINTENANCE]: relatedRead() },
    tenantScoped: true,
    order: 222,
    navigationVisible: true,
  },
  {
    id: 'maintenance-new',
    path: '/dashboard/maintenance/new',
    label: 'New Maintenance Record',
    section: 'Maintenance',
    workspaces: [W.MAINTENANCE],
    access: { [W.MAINTENANCE]: assignedManage() },
    tenantScoped: true,
    order: 231,
    navigationVisible: false,
  },
  {
    id: 'maintenance',
    path: '/dashboard/maintenance',
    label: 'Assigned Work Orders',
    icon: 'Wrench',
    section: 'Maintenance',
    workspaces: [W.MAINTENANCE, W.AUDIT],
    access: { [W.MAINTENANCE]: assignedManage(), [W.AUDIT]: tenantRead(true) },
    labelByWorkspace: { [W.AUDIT]: 'Maintenance Audit' },
    sectionByWorkspace: { [W.AUDIT]: 'Audit Registers' },
    tenantScoped: true,
    order: 230,
    navigationVisible: true,
  },
  {
    id: 'allocations-new',
    path: '/dashboard/allocations/new',
    label: 'New Allocation',
    section: 'Allocations & Trips',
    workspaces: [W.TRANSPORT_ADMIN],
    access: { [W.TRANSPORT_ADMIN]: tenantManage(['view', 'create']) },
    tenantScoped: true,
    order: 235,
    navigationVisible: false,
  },
  {
    id: 'allocations',
    path: '/dashboard/allocations',
    label: 'Allocations',
    icon: 'Truck',
    section: 'Allocations & Trips',
    workspaces: [W.TRANSPORT_ADMIN],
    access: { [W.TRANSPORT_ADMIN]: tenantManage(OPERATE) },
    tenantScoped: true,
    order: 236,
    navigationVisible: true,
  },
  {
    id: 'reimbursements',
    path: '/dashboard/reimbursements',
    label: 'Reimbursements',
    icon: 'ClipboardList',
    section: 'Operational Management',
    workspaces: [W.TRANSPORT_ADMIN],
    access: { [W.TRANSPORT_ADMIN]: tenantManage(OPERATE) },
    tenantScoped: true,
    order: 260,
    navigationVisible: true,
  },
  {
    id: 'drivers',
    path: '/dashboard/drivers',
    label: 'Drivers',
    icon: 'CarFront',
    section: 'Operational Management',
    workspaces: [W.TRANSPORT_ADMIN, W.TENANT_ADMIN],
    access: { [W.TRANSPORT_ADMIN]: tenantManage(), [W.TENANT_ADMIN]: tenantManage() },
    labelByWorkspace: { [W.TENANT_ADMIN]: 'Drivers Administration' },
    sectionByWorkspace: { [W.TENANT_ADMIN]: 'People & Organisation' },
    tenantScoped: true,
    order: 270,
    navigationVisible: true,
  },
  {
    id: 'drivers-licence-verification',
    path: '/dashboard/drivers/licences',
    label: 'Licence Verification',
    icon: 'ShieldCheck',
    section: 'Operational Management',
    workspaces: [W.TRANSPORT_ADMIN, W.TENANT_ADMIN],
    access: {
      [W.TRANSPORT_ADMIN]: tenantManage(OPERATE),
      [W.TENANT_ADMIN]: tenantRead(),
    },
    sectionByWorkspace: { [W.TENANT_ADMIN]: 'People & Organisation' },
    tenantScoped: true,
    order: 271,
    navigationVisible: true,
    badgeQuery: 'licences:pending-verification',
  },
  {
    id: 'documents',
    path: '/dashboard/documents',
    label: 'My Documents',
    icon: 'FileSpreadsheet',
    section: 'My Transport',
    workspaces: [W.PERSONAL, W.DRIVER, W.TRANSPORT_ADMIN, W.AUDIT],
    access: {
      [W.PERSONAL]: ownRead(),
      [W.DRIVER]: assignedRead(),
      [W.TRANSPORT_ADMIN]: tenantManage(),
      [W.AUDIT]: tenantRead(true),
    },
    labelByWorkspace: {
      [W.DRIVER]: 'My Trip Documents',
      [W.TRANSPORT_ADMIN]: 'Operational Documents',
      [W.AUDIT]: 'Document Register',
    },
    sectionByWorkspace: {
      [W.DRIVER]: 'Driver',
      [W.TRANSPORT_ADMIN]: 'Documents & Reporting',
      [W.AUDIT]: 'Audit Registers',
    },
    tenantScoped: true,
    order: 280,
    navigationVisible: true,
  },
  {
    id: 'share-links',
    path: '/dashboard/share-links',
    label: 'Share Links',
    icon: 'Link2',
    section: 'Documents & Reporting',
    workspaces: [W.TRANSPORT_ADMIN, W.AUDIT],
    access: { [W.TRANSPORT_ADMIN]: tenantManage(), [W.AUDIT]: tenantRead(true) },
    labelByWorkspace: { [W.AUDIT]: 'Share-Link Register' },
    sectionByWorkspace: { [W.AUDIT]: 'Audit Registers' },
    tenantScoped: true,
    order: 290,
    navigationVisible: true,
  },
  {
    id: 'reports-licence-expiry',
    path: '/dashboard/reports/licence-expiry',
    label: 'Licence Expiry',
    section: 'Documents & Reporting',
    workspaces: [W.TRANSPORT_ADMIN, W.TENANT_ADMIN, W.AUDIT],
    access: {
      [W.TRANSPORT_ADMIN]: tenantRead(),
      [W.TENANT_ADMIN]: tenantRead(),
      [W.AUDIT]: tenantRead(true),
    },
    tenantScoped: true,
    order: 301,
    navigationVisible: false,
  },
  {
    id: 'reports',
    path: '/dashboard/reports',
    label: 'Reports',
    icon: 'FileBarChart',
    section: 'Documents & Reporting',
    workspaces: [W.TRANSPORT_ADMIN, W.TENANT_ADMIN, W.AUDIT],
    access: {
      [W.TRANSPORT_ADMIN]: tenantRead(),
      [W.TENANT_ADMIN]: tenantRead(),
      [W.AUDIT]: tenantRead(true),
    },
    labelByWorkspace: {
      [W.TENANT_ADMIN]: 'Tenant Reports',
      [W.AUDIT]: 'Compliance Reports & Export Centre',
    },
    sectionByWorkspace: { [W.TENANT_ADMIN]: 'Governance', [W.AUDIT]: 'Audit Registers' },
    tenantScoped: true,
    order: 300,
    navigationVisible: true,
  },
  {
    id: 'staff-new',
    path: '/dashboard/staff/new',
    label: 'Add Staff',
    section: 'People & Organisation',
    workspaces: [W.TENANT_ADMIN],
    access: { [W.TENANT_ADMIN]: tenantManage(['view', 'create']) },
    tenantScoped: true,
    order: 311,
    navigationVisible: false,
  },
  {
    id: 'staff-import',
    path: '/dashboard/staff/import',
    label: 'Import Staff',
    section: 'People & Organisation',
    workspaces: [W.TENANT_ADMIN],
    access: { [W.TENANT_ADMIN]: tenantManage(['view', 'import']) },
    tenantScoped: true,
    order: 312,
    navigationVisible: false,
  },
  {
    id: 'staff-imports',
    path: '/dashboard/staff/imports',
    label: 'Staff Imports',
    section: 'People & Organisation',
    workspaces: [W.TENANT_ADMIN],
    access: { [W.TENANT_ADMIN]: tenantManage(['view', 'import']) },
    tenantScoped: true,
    order: 313,
    navigationVisible: false,
  },
  {
    id: 'staff',
    path: '/dashboard/staff',
    label: 'Staff Directory',
    icon: 'Users',
    section: 'People & Organisation',
    workspaces: [W.TENANT_ADMIN, W.AUDIT],
    access: { [W.TENANT_ADMIN]: tenantManage(), [W.AUDIT]: tenantRead(true) },
    labelByWorkspace: { [W.AUDIT]: 'Driver & Staff Register' },
    sectionByWorkspace: { [W.AUDIT]: 'Audit Registers' },
    tenantScoped: true,
    order: 310,
    navigationVisible: true,
  },
  {
    id: 'organisation',
    path: '/dashboard/organisation',
    label: 'Organisation Structure',
    icon: 'Building2',
    section: 'People & Organisation',
    workspaces: [W.TENANT_ADMIN],
    access: { [W.TENANT_ADMIN]: tenantManage() },
    tenantScoped: true,
    order: 320,
    navigationVisible: true,
  },
  {
    id: 'offices',
    path: '/dashboard/offices',
    label: 'Offices',
    section: 'People & Organisation',
    workspaces: [W.TENANT_ADMIN],
    access: { [W.TENANT_ADMIN]: tenantManage() },
    tenantScoped: true,
    order: 321,
    navigationVisible: false,
  },
  {
    id: 'departments',
    path: '/dashboard/departments',
    label: 'Departments',
    section: 'People & Organisation',
    workspaces: [W.TENANT_ADMIN],
    access: { [W.TENANT_ADMIN]: tenantManage() },
    tenantScoped: true,
    order: 322,
    navigationVisible: false,
  },
  {
    id: 'admin',
    path: '/dashboard/admin',
    label: 'Administration',
    section: 'People & Organisation',
    workspaces: [W.TENANT_ADMIN],
    access: { [W.TENANT_ADMIN]: tenantManage() },
    tenantScoped: true,
    order: 329,
    navigationVisible: false,
  },
  {
    id: 'admin-users',
    path: '/dashboard/admin/users',
    label: 'User Management',
    icon: 'Users',
    section: 'People & Organisation',
    workspaces: [W.TENANT_ADMIN],
    access: { [W.TENANT_ADMIN]: tenantManage() },
    tenantScoped: true,
    order: 330,
    navigationVisible: true,
  },
  {
    id: 'admin-roles',
    path: '/dashboard/admin/roles',
    label: 'Roles & Permissions',
    icon: 'Shield',
    section: 'People & Organisation',
    workspaces: [W.TENANT_ADMIN],
    access: { [W.TENANT_ADMIN]: tenantManage() },
    tenantScoped: true,
    order: 340,
    navigationVisible: true,
  },
  {
    id: 'admin-workflows',
    path: '/dashboard/admin/workflows',
    label: 'Workflow Routing',
    icon: 'GitBranch',
    section: 'Workflow & Programmes',
    workspaces: [W.TENANT_ADMIN],
    access: { [W.TENANT_ADMIN]: tenantManage() },
    tenantScoped: true,
    order: 350,
    navigationVisible: true,
  },
  {
    id: 'admin-regions',
    path: '/dashboard/admin/regions',
    label: 'Regions & Jurisdictions',
    icon: 'MapPin',
    section: 'Workflow & Programmes',
    workspaces: [W.TENANT_ADMIN],
    access: { [W.TENANT_ADMIN]: tenantManage() },
    tenantScoped: true,
    order: 360,
    navigationVisible: true,
  },
  {
    id: 'settings',
    path: '/dashboard/settings',
    label: 'Tenant Branding & Settings',
    icon: 'Settings',
    section: 'Tenant Configuration',
    workspaces: [W.TENANT_ADMIN],
    access: { [W.TENANT_ADMIN]: tenantManage() },
    tenantScoped: true,
    order: 370,
    navigationVisible: true,
  },
  {
    id: 'notification-deliveries',
    path: '/dashboard/notifications/deliveries',
    label: 'Delivery Dashboard',
    icon: 'Send',
    section: 'Tenant Configuration',
    workspaces: [W.TRANSPORT_ADMIN, W.TENANT_ADMIN],
    access: { [W.TRANSPORT_ADMIN]: tenantRead(), [W.TENANT_ADMIN]: tenantManage(READ_EXPORT) },
    sectionByWorkspace: { [W.TRANSPORT_ADMIN]: 'Documents & Reporting' },
    tenantScoped: true,
    order: 380,
    navigationVisible: true,
    notificationLinkEligible: false,
  },
  {
    id: 'notification-history',
    path: '/dashboard/notifications/history',
    label: 'Email History',
    icon: 'Mail',
    section: 'Tenant Configuration',
    workspaces: [W.TENANT_ADMIN, W.AUDIT],
    access: { [W.TENANT_ADMIN]: tenantManage(READ_EXPORT), [W.AUDIT]: tenantRead(true) },
    sectionByWorkspace: { [W.AUDIT]: 'Audit Registers' },
    tenantScoped: true,
    order: 390,
    navigationVisible: true,
    notificationLinkEligible: false,
  },
  {
    id: 'audit',
    path: '/dashboard/audit',
    label: 'Tenant Audit Log',
    icon: 'FileText',
    section: 'Governance',
    workspaces: [W.TENANT_ADMIN, W.AUDIT],
    access: { [W.TENANT_ADMIN]: tenantRead(), [W.AUDIT]: tenantRead(true) },
    labelByWorkspace: { [W.AUDIT]: 'Audit Log' },
    sectionByWorkspace: { [W.AUDIT]: 'Audit Registers' },
    tenantScoped: true,
    order: 400,
    navigationVisible: true,
  },
  {
    id: 'platform',
    path: '/dashboard/platform',
    label: 'Platform Dashboard',
    icon: 'LayoutDashboard',
    section: 'Platform',
    workspaces: [W.PLATFORM_ADMIN],
    access: { [W.PLATFORM_ADMIN]: platformManage() },
    tenantScoped: false,
    platformOnly: true,
    order: 500,
    navigationVisible: true,
  },
  {
    id: 'platform-tenants',
    path: '/dashboard/platform/tenants',
    label: 'Tenants',
    icon: 'Globe',
    section: 'Platform',
    workspaces: [W.PLATFORM_ADMIN],
    access: { [W.PLATFORM_ADMIN]: platformManage() },
    tenantScoped: false,
    platformOnly: true,
    order: 510,
    navigationVisible: true,
  },
  {
    id: 'platform-onboard',
    path: '/dashboard/platform/onboard',
    label: 'Onboard Tenant',
    icon: 'Building2',
    section: 'Platform',
    workspaces: [W.PLATFORM_ADMIN],
    access: { [W.PLATFORM_ADMIN]: platformManage() },
    tenantScoped: false,
    platformOnly: true,
    order: 520,
    navigationVisible: true,
  },
  {
    id: 'platform-audit',
    path: '/dashboard/platform/audit',
    label: 'Platform Audit',
    icon: 'FileText',
    section: 'Platform',
    workspaces: [W.PLATFORM_ADMIN],
    access: { [W.PLATFORM_ADMIN]: platformManage() },
    tenantScoped: false,
    platformOnly: true,
    order: 530,
    navigationVisible: true,
  },
] as const;

function normalizePath(pathname: string) {
  return pathname.split(/[?#]/, 1)[0] || '/';
}

function pathMatches(pathname: string, route: RouteDefinition) {
  const normalized = normalizePath(pathname);
  return route.exact
    ? normalized === route.path
    : normalized === route.path || normalized.startsWith(`${route.path}/`);
}

function routeSpecificity(route: RouteDefinition) {
  return route.path.split('/').length * 1_000 + route.path.length;
}

function workspaceFromRoleContext(roleNames: readonly string[], requested?: WorkspaceId) {
  const marker = roleNames
    .find((role) => role.startsWith('workspace:'))
    ?.slice('workspace:'.length);
  return resolveActiveWorkspace(roleNames, requested ?? marker);
}

export function resolveDashboardAccess(
  pathname: string,
  roleNames: readonly string[],
  workspace?: WorkspaceId,
) {
  const activeWorkspace = workspaceFromRoleContext(roleNames, workspace);
  const route = [...routeRegistry]
    .filter((candidate) => pathMatches(pathname, candidate))
    .sort((a, b) => routeSpecificity(b) - routeSpecificity(a))[0];
  const access = route?.access[activeWorkspace];

  if (!route || !access) {
    return {
      allowed: false,
      routeId: route?.id ?? null,
      capability: route?.id ?? null,
      activeWorkspace,
      accessMode: 'none' as const,
      recordScope: null,
      actions: [] as readonly DashboardAction[],
      navigationVisible: false,
      directUrlBehaviour: route?.directUrlBehaviour ?? ('403' as const),
      notificationLinkEligible: false,
    };
  }

  return {
    allowed: true,
    routeId: route.id,
    capability: route.id,
    activeWorkspace,
    accessMode: access.accessMode,
    recordScope: access.recordScope,
    actions: access.actions,
    navigationVisible: route.navigationVisible !== false,
    directUrlBehaviour: route.directUrlBehaviour ?? ('403' as const),
    notificationLinkEligible: route.notificationLinkEligible !== false,
  };
}

export function getWorkspaceNavigation(workspace: WorkspaceId) {
  const seen = new Set<string>();
  return routeRegistry
    .filter((route) => route.navigationVisible !== false && route.access[workspace])
    .filter((route) => {
      const key = route.href ?? route.path;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((route) => ({
      ...route,
      href: route.href ?? route.path,
      label: route.labelByWorkspace?.[workspace] ?? route.label,
      section: route.sectionByWorkspace?.[workspace] ?? route.section,
    }))
    .sort((a, b) => a.order - b.order);
}

export function canAccessDashboardPath(
  pathname: string,
  roleNames: readonly string[],
  workspace?: WorkspaceId,
) {
  return resolveDashboardAccess(pathname, roleNames, workspace).allowed;
}

export function canNavigateDashboardPath(
  pathname: string,
  roleNames: readonly string[],
  workspace?: WorkspaceId,
) {
  const access = resolveDashboardAccess(pathname, roleNames, workspace);
  return access.allowed && access.navigationVisible;
}

export function canPerformDashboardAction(
  pathname: string,
  roleNames: readonly string[],
  action: DashboardAction,
  workspace?: WorkspaceId,
) {
  const access = resolveDashboardAccess(pathname, roleNames, workspace);
  return access.allowed && access.actions.includes(action);
}
