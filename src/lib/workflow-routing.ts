export type PersistedRoutingStep = {
  id: string;
  stepOrder: number;
  actionType: string;
};

export type SubmittedRoutingStep = {
  id: string;
  stepOrder: number;
  assignedUserId: string | null;
};

export type RoutingValidationResult =
  { ok: true; steps: SubmittedRoutingStep[]; orderChanged: boolean } | { ok: false; error: string };

/**
 * Validate the complete ordered step list before a new workflow version is
 * published. Driver acknowledgement remains terminal because it depends on an
 * authorised trip and the final vehicle/driver allocation.
 */
export function validateWorkflowRouting(
  persistedSteps: PersistedRoutingStep[],
  submittedValue: unknown,
): RoutingValidationResult {
  if (!Array.isArray(submittedValue)) {
    return { ok: false, error: 'Workflow steps are required.' };
  }

  const steps: SubmittedRoutingStep[] = [];
  for (const value of submittedValue) {
    if (!value || typeof value !== 'object') {
      return { ok: false, error: 'Every workflow step must be valid.' };
    }
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || !candidate.id) {
      return { ok: false, error: 'Every workflow step must include its ID.' };
    }
    if (!Number.isInteger(candidate.stepOrder) || Number(candidate.stepOrder) < 1) {
      return { ok: false, error: 'Every workflow step must include a valid order.' };
    }
    if (candidate.assignedUserId != null && typeof candidate.assignedUserId !== 'string') {
      return { ok: false, error: 'Workflow assignees must be valid users.' };
    }
    steps.push({
      id: candidate.id,
      stepOrder: Number(candidate.stepOrder),
      assignedUserId:
        typeof candidate.assignedUserId === 'string' && candidate.assignedUserId
          ? candidate.assignedUserId
          : null,
    });
  }

  const persistedById = new Map(persistedSteps.map((step) => [step.id, step]));
  if (
    steps.length !== persistedSteps.length ||
    new Set(steps.map((step) => step.id)).size !== steps.length ||
    steps.some((step) => !persistedById.has(step.id))
  ) {
    return { ok: false, error: 'The submitted steps must exactly match this workflow definition.' };
  }

  const ordered = [...steps].sort((left, right) => left.stepOrder - right.stepOrder);
  if (ordered.some((step, index) => step.stepOrder !== index + 1)) {
    return { ok: false, error: 'Workflow step order must be a continuous sequence starting at 1.' };
  }

  const acknowledgementSteps = ordered.filter(
    (step) => persistedById.get(step.id)?.actionType === 'acknowledge',
  );
  if (acknowledgementSteps.length !== 1 || acknowledgementSteps[0]?.id !== ordered.at(-1)?.id) {
    return { ok: false, error: 'Driver Acknowledgement must remain the final workflow step.' };
  }

  const originalOrder = [...persistedSteps]
    .sort((left, right) => left.stepOrder - right.stepOrder)
    .map((step) => step.id);
  const orderChanged = ordered.some((step, index) => step.id !== originalOrder[index]);
  return { ok: true, steps: ordered, orderChanged };
}
