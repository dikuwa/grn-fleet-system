export type IncidentVehicleSafetyInput = {
  severity: 'minor' | 'moderate' | 'serious' | 'critical';
  vehicleDamage: boolean;
  vehicleSafe?: boolean | null;
};

/**
 * Vehicle restriction is based only on vehicle-specific safety evidence or a
 * critical incident. Journey continuation is intentionally not part of this
 * decision: a trip can stop for injury, security, weather, police, or other
 * non-mechanical reasons while the vehicle itself remains roadworthy.
 */
export function incidentRequiresVehicleRestriction(input: IncidentVehicleSafetyInput): boolean {
  return input.severity === 'critical' || input.vehicleDamage || input.vehicleSafe === false;
}

/** Preserve unknown vehicle condition instead of inferring it from journey continuation. */
export function normalizedVehicleSafety(vehicleSafe?: boolean | null): boolean | null {
  return vehicleSafe ?? null;
}
