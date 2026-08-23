export const RESET_SPEC_VERSION = 1 as const;

export type ResetPreset = 'operational' | 'selective' | 'clean_slate';
export type ResetTarget = 'tenant' | 'selected_tenants' | 'all_tenants' | 'platform';
export type ResetCategoryId =
  | 'operations'
  | 'documents'
  | 'programmes'
  | 'fleet'
  | 'people'
  | 'organisation'
  | 'access'
  | 'configuration';

export interface ResetCategoryDefinition {
  id: ResetCategoryId;
  label: string;
  description: string;
  risk: 'standard' | 'elevated' | 'critical';
  dependencies: ResetCategoryId[];
  supportsCutoff: boolean;
  dashboardEffect: string;
}

export interface ResetSpec {
  version: typeof RESET_SPEC_VERSION;
  target: ResetTarget;
  preset: ResetPreset;
  categories: ResetCategoryId[];
  requestedCategories: ResetCategoryId[];
  autoIncludedCategories: ResetCategoryId[];
  cutoff: string | null;
}

export const RESET_CATEGORY_CATALOG: readonly ResetCategoryDefinition[] = [
  {
    id: 'operations',
    label: 'Requests & operations',
    description:
      'Approvals, requests, goods and equipment, allocations, trips, logs, fuel, inspection records, defects, external assignments and operational notifications.',
    risk: 'standard',
    dependencies: [],
    supportsCutoff: true,
    dashboardEffect:
      'Approval, request, trip, allocation, log, fuel and inspection dashboards are cleared; live reports update from the remaining records.',
  },
  {
    id: 'documents',
    label: 'Documents & files',
    description:
      'Generated documents, import history and document share links; operational and master-data attachments follow their parent category.',
    risk: 'elevated',
    dependencies: [],
    supportsCutoff: true,
    dashboardEffect: 'Generated reports, documents and shared links are cleared.',
  },
  {
    id: 'programmes',
    label: 'Programmes',
    description:
      'Tenant programme records; numbering and workflow settings remain unless configuration is also selected.',
    risk: 'elevated',
    dependencies: [],
    supportsCutoff: false,
    dashboardEffect: 'Programme lists return to a clean starting point.',
  },
  {
    id: 'fleet',
    label: 'Fleet master data',
    description:
      'Vehicles, categories, maintenance, defects, compliance documents and vehicle event history.',
    risk: 'critical',
    dependencies: ['operations'],
    supportsCutoff: false,
    dashboardEffect: 'Fleet vehicle and maintenance totals return to zero.',
  },
  {
    id: 'people',
    label: 'People & drivers',
    description:
      'Staff, external parties, driver profiles, all licence versions and images, employee documents, assignments and availability history.',
    risk: 'critical',
    dependencies: ['operations'],
    supportsCutoff: false,
    dashboardEffect: 'Staff and driver directories return to a clean starting point.',
  },
  {
    id: 'organisation',
    label: 'Organisation structure',
    description:
      'Departments, offices and regions after dependent staff, fleet and programme records are cleared.',
    risk: 'critical',
    dependencies: ['operations', 'fleet', 'people', 'configuration'],
    supportsCutoff: false,
    dashboardEffect: 'Department, office and region setup returns to zero.',
  },
  {
    id: 'access',
    label: 'Users & access',
    description:
      'Tenant memberships, role assignments, invitations and sessions, while retaining one protected Tenant Owner.',
    risk: 'critical',
    dependencies: [],
    supportsCutoff: false,
    dashboardEffect: 'Tenant membership totals decrease to the protected owner.',
  },
  {
    id: 'configuration',
    label: 'Workflow & tenant configuration',
    description:
      'Workflow definitions, inspection templates, holidays, preferences and tenant numbering sequences. Inspection records remain under Operations.',
    risk: 'critical',
    dependencies: ['operations'],
    supportsCutoff: false,
    dashboardEffect: 'Tenant workflow and reference setup returns to defaults.',
  },
] as const;

const CATEGORY_IDS = new Set<ResetCategoryId>(
  RESET_CATEGORY_CATALOG.map((category) => category.id),
);
/**
 * A go-live clean slate removes the tenant's working/test footprint. It is
 * deliberately not a tenant-shell wipe: fleet, people, organisation, access
 * and configuration remain available as separately reviewed selective scopes.
 */
export const CLEAN_SLATE_CATEGORIES: ResetCategoryId[] = ['operations', 'documents', 'programmes'];

export function isResetCategoryId(value: unknown): value is ResetCategoryId {
  return typeof value === 'string' && CATEGORY_IDS.has(value as ResetCategoryId);
}

export function resolveResetCategories(requested: ResetCategoryId[]) {
  const requestedUnique = [...new Set(requested.filter(isResetCategoryId))];
  const resolved = new Set<ResetCategoryId>(requestedUnique);
  const visit = (id: ResetCategoryId) => {
    const definition = RESET_CATEGORY_CATALOG.find((category) => category.id === id);
    for (const dependency of definition?.dependencies ?? []) {
      if (!resolved.has(dependency)) resolved.add(dependency);
      visit(dependency);
    }
  };
  requestedUnique.forEach(visit);
  const categories = RESET_CATEGORY_CATALOG.map((category) => category.id).filter((id) =>
    resolved.has(id),
  );
  return {
    categories,
    autoIncludedCategories: categories.filter((id) => !requestedUnique.includes(id)),
  };
}

function normalizeCutoff(value: unknown, categories: ResetCategoryId[]): string | null {
  if (
    !categories.every((id) => RESET_CATEGORY_CATALOG.find((item) => item.id === id)?.supportsCutoff)
  )
    return null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Reset cutoff must be a valid date');
  if (parsed.getTime() >= Date.now()) throw new Error('Reset cutoff must be in the past');
  return parsed.toISOString();
}

export function normalizeResetSpec(
  value: unknown,
  defaults: { target?: ResetTarget; preset?: ResetPreset } = {},
): ResetSpec {
  const input =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const preset: ResetPreset =
    input.preset === 'selective' || input.preset === 'clean_slate'
      ? input.preset
      : (defaults.preset ?? 'operational');
  const target: ResetTarget = ['tenant', 'selected_tenants', 'all_tenants', 'platform'].includes(
    String(input.target),
  )
    ? (input.target as ResetTarget)
    : (defaults.target ?? 'tenant');
  const inputCategories = Array.isArray(input.categories)
    ? input.categories.filter(isResetCategoryId)
    : [];
  const requestedCategories =
    preset === 'operational'
      ? (['operations'] as ResetCategoryId[])
      : preset === 'clean_slate'
        ? [...CLEAN_SLATE_CATEGORIES]
        : [...new Set(inputCategories)];
  if (requestedCategories.length === 0) throw new Error('Select at least one reset category');
  const resolved = resolveResetCategories(requestedCategories);
  return {
    version: RESET_SPEC_VERSION,
    target,
    preset,
    requestedCategories,
    categories: resolved.categories,
    autoIncludedCategories: resolved.autoIncludedCategories,
    cutoff: normalizeCutoff(input.cutoff, resolved.categories),
  };
}

export function resetScopeForSpec(
  spec: ResetSpec,
): 'operational' | 'fleet' | 'user_access' | 'full' {
  if (
    spec.preset === 'clean_slate' ||
    spec.categories.includes('organisation') ||
    spec.categories.length > 3
  )
    return 'full';
  if (spec.categories.includes('access')) return 'user_access';
  if (spec.categories.includes('fleet')) return 'fleet';
  return 'operational';
}

export const RESET_ALWAYS_PROTECTED = [
  'Tenant identity and branding',
  'Subscription, billing and payments',
  'One Tenant Owner and all Platform Administrators',
  'People, fleet and organisation master data',
  'Roles, permissions and tenant configuration',
  'Audit history',
  'Protected recovery points and reset history',
  'Global authentication accounts',
] as const;
