const LICENCE_ALIASES: Record<string, string> = {
  EB: 'BE',
  EC: 'CE',
  CE1: 'C1E',
};

/**
 * Namibia Road Traffic and Transport Regulations, 2001 (regulation 110,
 * Table 2) licence authorisations.
 *
 * This maps the licence printed on the driver's card to the vehicle classes
 * that licence authorises. Motorcycle classes remain separate from motor
 * vehicle classes.
 */
const NAMIBIA_LICENCE_COVERAGE: Record<string, readonly string[]> = {
  A1: ['A1'],
  A: ['A', 'A1'],
  B: ['B'],
  BE: ['B', 'BE'],
  C1: ['B', 'C1'],
  C: ['B', 'C1', 'C'],
  C1E: ['B', 'C1', 'BE', 'C1E'],
  CE: ['B', 'C1', 'C', 'BE', 'C1E', 'CE'],
};

export function normalizeNamibiaLicenceClass(value: string | null | undefined): string {
  const normalized = String(value || '').trim().toUpperCase().replaceAll(' ', '');
  return LICENCE_ALIASES[normalized] || normalized;
}

export function namibiaLicenceClassCovers(
  driverClass: string | null | undefined,
  requiredClass: string | null | undefined,
): boolean {
  const driver = normalizeNamibiaLicenceClass(driverClass);
  const required = normalizeNamibiaLicenceClass(requiredClass);
  if (!driver || !required) return false;
  return NAMIBIA_LICENCE_COVERAGE[driver]?.includes(required) ?? driver === required;
}

export function anyNamibiaLicenceClassCovers(
  driverClasses: Array<string | null | undefined>,
  requiredClass: string | null | undefined,
): boolean {
  if (!requiredClass) return true;
  return driverClasses.some((driverClass) => namibiaLicenceClassCovers(driverClass, requiredClass));
}
