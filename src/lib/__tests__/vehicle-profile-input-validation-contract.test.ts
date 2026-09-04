import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const createRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/route.ts'),
  'utf8',
);
const editRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/[id]/route.ts'),
  'utf8',
);

describe('vehicle profile input validation contract', () => {
  it('uses shared integer and date validators on create and edit routes', () => {
    for (const source of [createRoute, editRoute]) {
      expect(source).toContain('parseOptionalNonNegativeInteger');
      expect(source).toContain('parseOptionalIsoDate');
      expect(source).toContain('VehicleInputValidationError');
      expect(source).toContain('{ status: 422 }');
    }
  });

  it('validates all integer profile fields before persistence', () => {
    for (const field of [
      'manufactureYear',
      'tareKg',
      'grossVehicleMassKg',
      'seatedCapacity',
      'standingCapacity',
    ]) {
      expect(createRoute).toContain(`body.${field}`);
      expect(editRoute).toContain(`body.${field}`);
    }
  });

  it('validates both profile date fields before persistence', () => {
    for (const field of ['roadworthyTestDate', 'licenceExpiryDate']) {
      expect(createRoute).toContain(`parseOptionalIsoDate(body.${field}`);
      expect(editRoute).toContain(`parseOptionalIsoDate(body.${field}`);
    }
  });
});
