import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/allocations/external/route.ts'),
  'utf8',
);

describe('external allocation nested database conflict recovery', () => {
  it('uses the shared nested database parser at the POST error boundary', () => {
    expect(route).toContain("import { getDatabaseErrorDetails } from '@/lib/database-error-details';");
    expect(route).toContain('const { code, message } = getDatabaseErrorDetails(error);');
    expect(route).not.toContain('function databaseErrorCode(error: unknown)');
    expect(route).not.toContain('function databaseErrorText(error: unknown)');
  });

  it('preserves the established controlled conflict responses', () => {
    expect(route).toContain("code === '23P01'");
    expect(route).toContain("message.includes('allocation_vehicle_overlap')");
    expect(route).toContain("message.includes('allocation_request_already_live')");
    expect(route).toContain("message.includes('external_driver_assignment_overlap')");
    expect(route).toContain("code === '23514' && message.includes('external_driver_assignment_')");
    expect(route).toContain('The vehicle, request, or external driver was allocated by another operation at the same time.');
    expect(route).toContain('The external driver assignment no longer matches the current trip lifecycle.');
  });
});
