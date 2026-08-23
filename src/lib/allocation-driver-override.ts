export function evaluateDriverNominationOverride(input: {
  assignedDriverEmployeeId?: string | null;
  preferredDriverEmployeeId?: string | null;
  nominatedDriverEmployeeIds?: readonly string[];
  reason?: string | null;
}) {
  const nominatedDriverEmployeeIds = Array.from(
    new Set(
      [
        ...(input.nominatedDriverEmployeeIds ?? []),
        input.preferredDriverEmployeeId ?? null,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const assignedDriverEmployeeId = input.assignedDriverEmployeeId || null;
  const overridden = Boolean(
    assignedDriverEmployeeId &&
      nominatedDriverEmployeeIds.length > 0 &&
      !nominatedDriverEmployeeIds.includes(assignedDriverEmployeeId),
  );
  const reason = input.reason?.trim() || '';

  return {
    overridden,
    reason,
    nominatedDriverEmployeeIds,
    reasonRequired: overridden && reason.length < 3,
  };
}
