/**
 * Clean/default seed entry point.
 *
 * The application no longer injects the historical Kavango East demo tenant,
 * staff, drivers, vehicles or login fixtures when `pnpm db:seed` is run. Tenant
 * onboarding and the application itself own real tenant/bootstrap creation.
 *
 * Explicit fixture commands remain available for development and automated QA:
 *   pnpm db:seed-demo
 *   pnpm db:seed-e2e
 *   pnpm seed:minimal-test-data
 */

console.log('Clean seed complete: no demo tenant or operational fixture data was created.');
console.log('Use `pnpm db:seed-demo` only when the historical development fixture is required.');
