export type FilterParam = string | string[] | null | undefined;
export type FilterParams = Record<string, FilterParam>;

const UNFILTERED_VALUES = new Set(['', 'all']);

export function normalizeOptionalFilter(value: FilterParam): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw?.trim();
  return normalized && !UNFILTERED_VALUES.has(normalized.toLowerCase()) ? normalized : undefined;
}

export function hasActiveFilters(
  filters: FilterParams,
  ignoredKeys: readonly string[] = ['page'],
): boolean {
  const ignored = new Set(ignoredKeys);
  return Object.entries(filters).some(
    ([key, value]) => !ignored.has(key) && normalizeOptionalFilter(value) !== undefined,
  );
}

export function buildFilterUrl(
  basePath: string,
  params: FilterParams,
  overrides: FilterParams = {},
): string {
  const next = { ...params, ...overrides };
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(next)) {
    const normalized = normalizeOptionalFilter(value);
    if (normalized) query.set(key, normalized);
  }

  const queryString = query.toString();
  return queryString ? `${basePath}?${queryString}` : basePath;
}
