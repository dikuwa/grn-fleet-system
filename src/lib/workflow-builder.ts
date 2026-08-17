import { Permissions } from '@/lib/permissions';

export type GovernedWorkflowAction =
  'supervisor_approve' | 'transport_review' | 'release' | 'authorise' | 'acknowledge';

export type WorkflowPresetId = 'lean' | 'standard' | 'controlled';
export type AssignmentStrategy =
  'requester_supervisor' | 'department_permission_pool' | 'permission_pool' | 'named_user';

/**
 * These stages are operational lifecycle controls, not ordinary tenant approval
 * gates. They remain persisted in the existing workflow definition for runtime
 * compatibility, but builders should present them as governed/locked stages.
 */
export const SYSTEM_LIFECYCLE_ACTIONS: GovernedWorkflowAction[] = [
  'transport_review',
  'acknowledge',
];

/** Approval/release gates a tenant may opt into without changing the system lifecycle. */
export const TENANT_OPTIONAL_WORKFLOW_ACTIONS: GovernedWorkflowAction[] = [
  'supervisor_approve',
  'release',
];

export const WORKFLOW_ASSIGNMENT_STRATEGIES = [
  { id: 'requester_supervisor', label: "Requester's supervisor" },
  {
    id: 'department_permission_pool',
    label: "Department approval pool",
  },
  { id: 'permission_pool', label: 'Eligible tenant approval pool' },
  { id: 'named_user', label: 'Specific eligible person' },
] as const;

export const DEFAULT_ASSIGNMENT_FALLBACKS: AssignmentStrategy[] = [
  'requester_supervisor',
  'department_permission_pool',
  'permission_pool',
];

export const GOVERNED_ACTION_ORDER: GovernedWorkflowAction[] = [
  'supervisor_approve',
  'transport_review',
  'release',
  'authorise',
  'acknowledge',
];

/**
 * The current engine still requires transport review, final authorisation and
 * driver acknowledgement. Keeping this contract avoids changing active request
 * semantics while the UI distinguishes system lifecycle from tenant choices.
 */
export const MANDATORY_WORKFLOW_ACTIONS: GovernedWorkflowAction[] = [
  'transport_review',
  'authorise',
  'acknowledge',
];

export const WORKFLOW_PRESETS = [
  {
    id: 'lean' as const,
    label: 'Simple',
    description: 'No department supervisor gate. Uses the governed transport lifecycle.',
    actions: ['transport_review', 'authorise', 'acknowledge'] as GovernedWorkflowAction[],
  },
  {
    id: 'standard' as const,
    label: 'Standard',
    description: 'Adds the requester’s supervisor before the governed transport lifecycle.',
    actions: [
      'supervisor_approve',
      'transport_review',
      'authorise',
      'acknowledge',
    ] as GovernedWorkflowAction[],
  },
  {
    id: 'controlled' as const,
    label: 'Controlled',
    description:
      'Adds supervisor approval and an administrative release gate around the governed transport lifecycle.',
    actions: GOVERNED_ACTION_ORDER,
  },
] as const;

export function isSystemLifecycleAction(actionType: string): boolean {
  return SYSTEM_LIFECYCLE_ACTIONS.includes(actionType as GovernedWorkflowAction);
}

export function isTenantOptionalWorkflowAction(actionType: string): boolean {
  return TENANT_OPTIONAL_WORKFLOW_ACTIONS.includes(actionType as GovernedWorkflowAction);
}

export function governedStage(actionType: GovernedWorkflowAction, scope: string) {
  const national = scope === 'national';
  const stages = {
    supervisor_approve: {
      label: 'Supervisor Approval',
      description: "Optional organisational gate resolved from the sponsor or requester's supervisor path.",
      requiredPermission: Permissions.REQUEST_APPROVE_SUPERVISOR,
      stageKind: 'tenant_gate' as const,
    },
    transport_review: {
      label: 'Transport Review',
      description:
        'System lifecycle stage: Transport Administration validates feasibility, driver, vehicle and operational requirements.',
      requiredPermission: Permissions.REQUEST_REVIEW_TRANSPORT,
      stageKind: 'system_lifecycle' as const,
    },
    release: {
      label: 'Administrative Release',
      description: 'Optional governed release gate used by organisations that require it.',
      requiredPermission: national
        ? Permissions.VEHICLE_RELEASE_NATIONAL
        : Permissions.VEHICLE_RELEASE_REGIONAL,
      stageKind: 'tenant_gate' as const,
    },
    authorise: {
      label: 'Final Authorisation',
      description:
        'Governed authority gate required by the current transport lifecycle. The responsible role/person may be resolved by tenant configuration.',
      requiredPermission: national
        ? Permissions.TRIP_AUTHORIZE_NATIONAL
        : Permissions.TRIP_AUTHORIZE_REGIONAL,
      stageKind: 'governed_authority' as const,
    },
    acknowledge: {
      label: 'Driver Acknowledgement',
      description:
        'System lifecycle stage completed by the allocated driver from Driver Console after authorisation.',
      requiredPermission: Permissions.DRIVER_LOG_CREATE,
      stageKind: 'system_lifecycle' as const,
    },
  } as const;
  return stages[actionType];
}

export function validateGovernedActions(
  value: unknown,
): { ok: true; actions: GovernedWorkflowAction[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'Workflow stages are required.' };
  const actions = value.map((entry) =>
    typeof entry === 'string'
      ? entry
      : entry && typeof entry === 'object'
        ? String((entry as Record<string, unknown>).actionType ?? '')
        : '',
  );
  if (actions.some((action) => !GOVERNED_ACTION_ORDER.includes(action as GovernedWorkflowAction))) {
    return { ok: false, error: 'Only governed transport workflow stages may be published.' };
  }
  if (new Set(actions).size !== actions.length) {
    return { ok: false, error: 'A governed stage can only appear once.' };
  }
  for (const mandatory of MANDATORY_WORKFLOW_ACTIONS) {
    if (!actions.includes(mandatory))
      return { ok: false, error: `${governedStage(mandatory, 'regional').label} is mandatory.` };
  }
  const canonical = GOVERNED_ACTION_ORDER.filter((action) => actions.includes(action));
  if (canonical.some((action, index) => actions[index] !== action)) {
    return { ok: false, error: 'Workflow stages must remain in the governed lifecycle order.' };
  }
  return { ok: true, actions: actions as GovernedWorkflowAction[] };
}

export function normalizeAssignmentConfig(value: unknown, assignedUserId?: string | null) {
  const config = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const valid = new Set(WORKFLOW_ASSIGNMENT_STRATEGIES.map((item) => item.id));
  const requested = String(config.assignmentStrategy ?? '');
  const assignmentStrategy: AssignmentStrategy = valid.has(requested as AssignmentStrategy)
    ? (requested as AssignmentStrategy)
    : assignedUserId
      ? 'named_user'
      : 'permission_pool';
  const fallbackStrategies = Array.isArray(config.fallbackStrategies)
    ? config.fallbackStrategies.filter((item): item is AssignmentStrategy =>
        valid.has(item as AssignmentStrategy),
      )
    : DEFAULT_ASSIGNMENT_FALLBACKS;
  return { ...config, assignmentStrategy, fallbackStrategies };
}
