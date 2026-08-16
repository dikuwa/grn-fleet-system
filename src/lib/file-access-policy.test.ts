import { describe, expect, it } from 'vitest';
import { canTenantAdminUseGenericFileKey } from './file-access-policy';

describe('Tenant Admin generic file access policy', () => {
  it('blocks Transport Operations evidence namespaces', () => {
    for (const key of [
      'inspections/photo.jpg',
      'receipts/fuel.jpg',
      'vehicles/roadworthy.pdf',
      'trip-incidents/evidence.jpg',
    ]) {
      expect(canTenantAdminUseGenericFileKey(key), key).toBe(false);
    }
  });

  it('preserves governance and staff-document access', () => {
    for (const key of [
      'documents/staff-file.pdf',
      'imports/staff.csv',
      'signatures/official.png',
      'driver-licences/driver/v2/front/licence.jpg',
    ]) {
      expect(canTenantAdminUseGenericFileKey(key), key).toBe(true);
    }
  });
});
