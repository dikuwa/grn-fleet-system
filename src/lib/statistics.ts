export type CountValue = string | number | bigint | null | undefined;

export function numericCount(value: CountValue): number {
  if (value === null || value === undefined || value === '') return 0;
  const count = Number(value);
  return Number.isFinite(count) ? count : 0;
}

export function groupedCountMap<TKey extends string>(
  rows: readonly { key: TKey; count: CountValue }[],
): Map<TKey, number> {
  const result = new Map<TKey, number>();
  for (const row of rows) {
    result.set(row.key, (result.get(row.key) ?? 0) + numericCount(row.count));
  }
  return result;
}

export function sumGroupedCounts<TKey extends string>(
  counts: ReadonlyMap<TKey, number>,
  keys: readonly TKey[],
): number {
  return keys.reduce((total, key) => total + numericCount(counts.get(key)), 0);
}
