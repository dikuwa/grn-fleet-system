/**
 * Seed default subscription packages for the GovFleet platform.
 *
 * Run with: npx tsx scripts/seed-packages.ts
 *
 * Creates the following packages:
 * - TRIAL (7-day free trial)
 * - STARTER (basic fleet management)
 * - PROFESSIONAL (standard package for regional councils)
 * - ENTERPRISE (unlimited fleet)
 * - CUSTOM_INSTITUTIONAL (bespoke large orgs)
 */

import { getDb } from '../src/db';
import { subscriptionPackages, packageEntitlements } from '../src/db/schema/packages';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Package definitions
// ---------------------------------------------------------------------------

const PACKAGES = [
  {
    code: 'TRIAL',
    name: 'Free Trial',
    description: '7-day trial with full access to all features',
    tier: 'trial' as const,
    status: 'active' as const,
    monthlyPrice: 0,
    quarterlyPrice: 0,
    annualPrice: 0,
    currency: 'NAD',
    trialDays: 7,
    gracePeriodDays: 0,
    maxVehicles: 50,
    maxUsers: 25,
    maxDrivers: 25,
    maxDepartments: 10,
    maxStorageGb: 1,
    features: [
      'vehicle_management',
      'trip_management',
      'fuel_tracking',
      'inspection_system',
      'driver_management',
      'maintenance_tracking',
      'reporting',
      'user_management',
    ],
    entitlements: [
      { code: 'vehicles', limit: 50, overageAllowed: false },
      { code: 'users', limit: 25, overageAllowed: false },
      { code: 'drivers', limit: 25, overageAllowed: false },
      { code: 'storage', limit: 1, overageAllowed: false },
    ],
  },
  {
    code: 'STARTER',
    name: 'Starter',
    description: 'Basic fleet management for small organisations',
    tier: 'starter' as const,
    status: 'active' as const,
    monthlyPrice: 45000, // NAD 450.00
    quarterlyPrice: 121500, // NAD 1,215.00 (5% discount)
    annualPrice: 432000, // NAD 4,320.00 (20% discount)
    currency: 'NAD',
    trialDays: 14,
    gracePeriodDays: 7,
    maxVehicles: 50,
    maxUsers: 15,
    maxDrivers: 15,
    maxDepartments: 5,
    maxStorageGb: 5,
    features: [
      'vehicle_management',
      'trip_management',
      'fuel_tracking',
      'inspection_system',
      'driver_management',
      'reporting',
      'user_management',
    ],
    entitlements: [
      { code: 'vehicles', limit: 50, overageAllowed: false },
      { code: 'users', limit: 15, overageAllowed: false },
      { code: 'drivers', limit: 15, overageAllowed: false },
      { code: 'storage', limit: 5, overageAllowed: false },
    ],
  },
  {
    code: 'PROFESSIONAL',
    name: 'Professional',
    description: 'Standard package for regional councils and government agencies',
    tier: 'professional' as const,
    status: 'active' as const,
    monthlyPrice: 90000, // NAD 900.00
    quarterlyPrice: 243000, // NAD 2,430.00 (10% discount)
    annualPrice: 864000, // NAD 8,640.00 (20% discount)
    currency: 'NAD',
    trialDays: 30,
    gracePeriodDays: 14,
    maxVehicles: 150,
    maxUsers: 50,
    maxDrivers: 50,
    maxDepartments: 20,
    maxStorageGb: 25,
    features: [
      'vehicle_management',
      'trip_management',
      'fuel_tracking',
      'inspection_system',
      'driver_management',
      'maintenance_tracking',
      'reporting',
      'programme_management',
      'user_management',
      'advanced_analytics',
      'export_reports',
    ],
    entitlements: [
      { code: 'vehicles', limit: 150, overageAllowed: false },
      { code: 'users', limit: 50, overageAllowed: false },
      { code: 'drivers', limit: 50, overageAllowed: false },
      { code: 'storage', limit: 25, overageAllowed: false },
    ],
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Unlimited fleet management for large organisations',
    tier: 'enterprise' as const,
    status: 'active' as const,
    monthlyPrice: 180000, // NAD 1,800.00
    quarterlyPrice: 486000, // NAD 4,860.00 (10% discount)
    annualPrice: 1728000, // NAD 17,280.00 (20% discount)
    currency: 'NAD',
    trialDays: 30,
    gracePeriodDays: 21,
    maxVehicles: null, // unlimited
    maxUsers: null, // unlimited
    maxDrivers: null, // unlimited
    maxDepartments: null, // unlimited
    maxStorageGb: 100,
    features: [
      'vehicle_management',
      'trip_management',
      'fuel_tracking',
      'inspection_system',
      'driver_management',
      'maintenance_tracking',
      'reporting',
      'programme_management',
      'user_management',
      'advanced_analytics',
      'export_reports',
      'api_access',
      'priority_support',
      'custom_branding',
    ],
    entitlements: [
      { code: 'vehicles', limit: null, overageAllowed: true },
      { code: 'users', limit: null, overageAllowed: true },
      { code: 'drivers', limit: null, overageAllowed: true },
      { code: 'storage', limit: 100, overageAllowed: false },
    ],
  },
  {
    code: 'CUSTOM_INSTITUTIONAL',
    name: 'Custom Institutional',
    description: 'Bespoke package for large institutions with dedicated support and SLA',
    tier: 'custom' as const,
    status: 'active' as const,
    monthlyPrice: 0, // custom pricing
    quarterlyPrice: 0,
    annualPrice: 0,
    currency: 'NAD',
    trialDays: 0,
    gracePeriodDays: 30,
    maxVehicles: null,
    maxUsers: null,
    maxDrivers: null,
    maxDepartments: null,
    maxStorageGb: null,
    features: [
      'vehicle_management',
      'trip_management',
      'fuel_tracking',
      'inspection_system',
      'driver_management',
      'maintenance_tracking',
      'reporting',
      'programme_management',
      'user_management',
      'advanced_analytics',
      'export_reports',
      'api_access',
      'priority_support',
      'custom_branding',
      'white_labeling',
      'dedicated_account_manager',
    ],
    entitlements: [
      { code: 'vehicles', limit: null, overageAllowed: true },
      { code: 'users', limit: null, overageAllowed: true },
      { code: 'drivers', limit: null, overageAllowed: true },
      { code: 'storage', limit: null, overageAllowed: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main() {
  const db = getDb();
  let created = 0;
  let skipped = 0;

  for (const pkg of PACKAGES) {
    const [existing] = await db
      .select({ id: subscriptionPackages.id })
      .from(subscriptionPackages)
      .where(eq(subscriptionPackages.code, pkg.code))
      .limit(1);

    if (existing) {
      console.log(`  Skipping ${pkg.code} (already exists)`);
      skipped++;
      continue;
    }

    // Insert package
    const [createdPkg] = await db
      .insert(subscriptionPackages)
      .values({
        code: pkg.code,
        name: pkg.name,
        description: pkg.description,
        tier: pkg.tier,
        status: pkg.status,
        monthlyPrice: pkg.monthlyPrice,
        quarterlyPrice: pkg.quarterlyPrice,
        annualPrice: pkg.annualPrice,
        currency: pkg.currency,
        trialDays: pkg.trialDays,
        gracePeriodDays: pkg.gracePeriodDays,
        maxVehicles: pkg.maxVehicles,
        maxUsers: pkg.maxUsers,
        maxDrivers: pkg.maxDrivers,
        maxDepartments: pkg.maxDepartments,
        maxStorageGb: pkg.maxStorageGb,
        features: pkg.features,
      })
      .returning();

    // Insert entitlements
    if (pkg.entitlements.length > 0) {
      await db.insert(packageEntitlements).values(
        pkg.entitlements.map((ent) => ({
          packageId: createdPkg.id,
          code: ent.code,
          limit: ent.limit,
          overageAllowed: ent.overageAllowed,
        })),
      );
    }

    console.log(`  Created ${pkg.code} (${pkg.name})`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});