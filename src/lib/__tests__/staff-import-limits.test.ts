import { describe, expect, it } from 'vitest';
import {
  MAX_SYNCHRONOUS_STAFF_IMPORT_ROWS,
  staffImportSizeError,
} from '@/lib/staff-import-limits';

describe('staff import synchronous batch boundary', () => {
  it('accepts the documented maximum batch size', () => {
    expect(MAX_SYNCHRONOUS_STAFF_IMPORT_ROWS).toBe(500);
    expect(staffImportSizeError(500)).toBeNull();
  });

  it('rejects the first row beyond the synchronous boundary with actionable guidance', () => {
    expect(staffImportSizeError(501)).toBe(
      'Staff imports are limited to 500 rows per batch. Split larger files into smaller batches and import them separately.',
    );
  });

  it('rejects very large batches through the same deterministic contract', () => {
    expect(staffImportSizeError(10_000)).toContain('limited to 500 rows per batch');
  });
});
