export const TERMINAL_RECEIPT_REVIEW_STATUSES = new Set(['verified', 'rejected']);

export type ReceiptCorrectionValue = string | number | null;

export function isTerminalReceiptReviewStatus(status: string): boolean {
  return TERMINAL_RECEIPT_REVIEW_STATUSES.has(status);
}

export function normaliseReceiptCorrections<Field extends string>(
  corrections: Record<string, unknown>,
  allowedFields: ReadonlySet<Field>,
):
  | { ok: true; entries: Array<readonly [Field, ReceiptCorrectionValue]> }
  | { ok: false } {
  const rawEntries = Object.entries(corrections);
  const entries = rawEntries.filter(
    (entry): entry is [Field, ReceiptCorrectionValue] =>
      allowedFields.has(entry[0] as Field) &&
      (entry[1] === null || typeof entry[1] === 'string' || typeof entry[1] === 'number'),
  );
  if (entries.length !== rawEntries.length) return { ok: false };

  return {
    ok: true,
    entries: entries.map(([fieldName, value]) => [
      fieldName,
      typeof value === 'string' && value.trim() === '' ? null : value,
    ] as const),
  };
}
