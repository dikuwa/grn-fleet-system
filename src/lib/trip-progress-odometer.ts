export type ProgressOdometerInput = {
  value: number | null;
  previous: number | null;
  next: number | null;
  authorityStart: number | null;
  authorityEnd: number | null;
};

export type ProgressOdometerResult =
  | { ok: true; floor: number; ceiling: number | null }
  | { ok: false; floor: number; ceiling: number | null; error: string };

/**
 * Validate a progress odometer by journey chronology rather than server arrival
 * order. This lets an older offline event sync after a newer event while still
 * preventing impossible odometer rollback or overshoot between its neighbours.
 */
export function validateProgressOdometer(input: ProgressOdometerInput): ProgressOdometerResult {
  const floor = input.previous ?? input.authorityStart ?? 0;
  const ceiling = input.next ?? input.authorityEnd ?? null;

  if (input.value === null) return { ok: true, floor, ceiling };

  if (!Number.isInteger(input.value) || input.value < 0) {
    return {
      ok: false,
      floor,
      ceiling,
      error: 'Odometer must be a non-negative whole number',
    };
  }

  if (input.value < floor) {
    return {
      ok: false,
      floor,
      ceiling,
      error: `Odometer must be at or above the previous recorded reading (${floor})`,
    };
  }

  if (ceiling !== null && input.value > ceiling) {
    return {
      ok: false,
      floor,
      ceiling,
      error: `Odometer cannot exceed the next recorded reading (${ceiling})`,
    };
  }

  return { ok: true, floor, ceiling };
}
