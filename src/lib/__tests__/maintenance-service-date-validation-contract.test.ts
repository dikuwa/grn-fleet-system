import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseOptionalIsoDate,
  VehicleInputValidationError,
} from '@/lib/vehicle-input-validation';

const maintenanceRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/maintenance/route.ts'),
  'utf8',
);

describe('maintenance service-date validation contract', () => {
  it('accepts real calendar dates including leap day and rejects impossible dates', () => {
    expect(parseOptionalIsoDate('2028-02-29', 'Service date')).toBe('2028-02-29');
    expect(() => parseOptionalIsoDate('2026-02-30', 'Service date')).toThrow(
      VehicleInputValidationError,
    );
  });

  it('strictly validates service and next-service dates before persistence', () => {
    expect(maintenanceRoute).toContain("parseOptionalIsoDate(serviceDateInput, 'Service date')");
    expect(maintenanceRoute).toContain("parseOptionalIsoDate(body.nextServiceDate, 'Next service date')");
    expect(maintenanceRoute).toContain('error instanceof VehicleInputValidationError');
    expect(maintenanceRoute).toContain('{ status: 422 }');
    expect(maintenanceRoute).not.toContain('Date.parse');
  });
});
