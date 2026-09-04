export class VehicleInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VehicleInputValidationError';
  }
}

export function parseOptionalNonNegativeInteger(
  value: unknown,
  label: string,
): number | null {
  if (value === undefined || value === null || value === '') return null;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new VehicleInputValidationError(`${label} must be a non-negative whole number`);
  }

  return parsed;
}

export function parseOptionalIsoDate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;

  const normalized = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) {
    throw new VehicleInputValidationError(`${label} must use YYYY-MM-DD format`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new VehicleInputValidationError(`${label} must be a real calendar date`);
  }

  return normalized;
}
