import { describe, expect, it } from 'vitest';
import { resetExecutionHttpStatus } from '@/lib/reset-execution-http';

describe('resetExecutionHttpStatus', () => {
  it('maps a request that disappears after route validation to 404', () => {
    expect(resetExecutionHttpStatus(new Error('Reset request not found'))).toBe(404);
  });

  it('maps execution ownership violations to 403', () => {
    expect(
      resetExecutionHttpStatus(
        new Error(
          'This reset remains Platform-executed. Tenant Administration can execute only tenant-originated operational or selective plans.',
        ),
      ),
    ).toBe(403);
  });

  it.each([
    'Reset request must be approved before execution',
    'Confirmation phrase is incorrect. Type exactly: RESET TEST',
    'Run a fresh dry run before executing this reset',
    'Create a durable recovery point before executing this reset',
    'This reset request changed after execution validation. Refresh the request and review its current state before retrying.',
    'Selected data changed after the dry run. Run the dry run again and create a new recovery point before executing.',
    'Backup checksum does not match the stored recovery point.',
  ])('maps governed execution preconditions to 409: %s', (message) => {
    expect(resetExecutionHttpStatus(new Error(message))).toBe(409);
  });

  it('keeps unexpected failures as 500', () => {
    expect(resetExecutionHttpStatus(new Error('database connection terminated unexpectedly'))).toBe(
      500,
    );
  });
});
