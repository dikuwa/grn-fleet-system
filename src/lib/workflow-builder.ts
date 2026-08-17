import { Permissions } from '@/lib/permissions';

export type GovernedWorkflowAction =
  'supervisor_approve' | 'transport_review' | 'release' | 'authorise' | 'acknowledge';

export type WorkflowPresetId = 'lean' | 'standard' | 'controlled';
export type AssignmentStrategy =
  'requester_supervisor' | 'department_permission_pool' | 'permission_pool' | 'named_user';

export const WORKFLOW_ASSIGNMENT_STRATEGIES = [
  { id: 'requester_supervisor', label: "Requester's recorded supervisor" },
  {
    id: 'department_permission_pool',
    label: "Eligible supervisors within the requester's department",
  },
  { id: 'permission_pool', label: 'Permission-based tenant pool' },
  { id: 'named_user', label: 'Named eligible person' },
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

export const MANDATORY_WORKFLOW_ACTIONS: GovernedWorkflowAction[] = [
  'transport_review',
  'authorise',
  'acknowledge',
];

export const WORKFLOW_PRESETS = [
  {
    id: 'lean' as const,
    label: 'Lean',
    description: 'Transport Review → Final Authorisation → Driver Acknowledgement',
    actions: ['transport_review', 'authorise', 'acknowledge'] as GovernedWorkflowAction[],
  },
  {
    id: 'standard' as const,
    label: 'Standard',
    description:
      'Supervisor Approval → Transport Review → Final Authorisation → Driver Acknowledgement',
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
      'Supervisor Approval → Transport Review → Administrative Release → Final Authorisation → Driver Acknowledgement',
    actions: GOVERNED_ACTION_ORDER,
  },
] as const;

export function governedStage(actionType: GovernedWorkflowAction, scope: string) {
  const national = scope === 'national';
  const stages = {
    supervisor_approve: {
      label: 'Supervisor Approval',
      description: "The sponsor or requester's supervisor reviews the request.",
      requiredPermission: Permissions.REQUEST_APPROVE_SUPERVISOR,
    },
    transport_review: {
      label: 'Transport Review',
      description: 'Transport Administration reviews feasibility and operational requirements.',
      requiredPermission: Permissions.REQUEST_REVIEW_TRANSPORT,
    },
    release: {
      label: 'Administrative Release',
      description: 'An authorised officer releases the request for final authorisation.',
      requiredPermission: national
        ? Permissions.VEHICLE_RELEASE_NATIONAL
        : Permissions.VEHICLE_RELEASE_REGIONAL,
    },
    authorise: {
      label: 'Final Authorisation',
      description: 'The designated authority gives final approval.',
      requiredPermission: national
        ? Permissions.TRIP_AUTHORIZE_NATIONAL
        : Permissions.TRIP_AUTHORIZE_REGIONAL,
    },
    acknowledge: {
      label: 'Driver Acknowledgement',
      description: 'The allocated driver acknowledges the final trip and vehicle details.',
      requiredPermission: Permissions.DRIVER_LOG_CREATE,
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
    return { ok: false, error: 'Only governed approval stages may be published.' };
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
