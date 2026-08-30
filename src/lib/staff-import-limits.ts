export const MAX_SYNCHRONOUS_STAFF_IMPORT_ROWS = 500;

export function staffImportSizeError(rowCount: number): string | null {
  if (rowCount <= MAX_SYNCHRONOUS_STAFF_IMPORT_ROWS) return null;
  return `Staff imports are limited to ${MAX_SYNCHRONOUS_STAFF_IMPORT_ROWS} rows per batch. Split larger files into smaller batches and import them separately.`;
}
