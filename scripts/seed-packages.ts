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
import { Permissions, type PermissionCode } from '../src/lib/permissions';

// ---------------------------------------------------------------------------
// Feature flags → real permission codes
//
// The package row carries feature flags (Record<string, boolean>) used by the
// entitlement gate, while package_entitlements stores fine-grained permission
// codes. Each feature flag maps to the permission codes it unlocks so the
// seeded packages agree with the permissions the app actually checks.
// ---------------------------------------------------------------------------

const FEATURE_PERMISSIONS: Record<string, readonly PermissionCode[]> = {
  vehicle_management: [
    Permissions.VEHICLE_VIEW,
    Permissions.VEHICLE_CREATE,
    Permissions.VEHICLE_UPDATE,
    Permissions.VEHICLE_MANAGE,
  ],
  trip_management: [Permissions.TRIP_VIEW, Permissions.TRIP_MANAGE, Permissions.TRIP_CLOSE],
  fuel_tracking: [Permissions.FUEL_VIEW, Permissions.FUEL_MANAGE, Permissions.FUEL_VERIFY],
  inspection_system: [Permissions.INSPECTION_VIEW, Permissions.INSPECTION_PERFORM],
  driver_management: [Permissions.DRIVER_MANAGE, Permissions.DRIVER_ASSIGN, Permissions.DRIVER_VERIFY],
  maintenance_tracking: [Permissions.MAINTENANCE_VIEW, Permissions.MAINTENANCE_MANAGE],
  reporting: [Permissions.REPORT_VIEW],
  programme_management: [Permissions.PROGRAMME_VIEW, Permissions.PROGRAMME_CREATE, Permissions.PROGRAMME_SUBMIT],
  user_management: [Permissions.USER_VIEW, Permissions.USER_INVITE, Permissions.USER_MANAGE_STATUS],
  advanced_analytics: [Permissions.REPORT_EXPORT],
  export_reports: [Permissions.REPORT_EXPORT],
  api_access: [],
  priority_support: [],
  custom_branding: [],
  white_labeling: [],
  dedicated_account_manager: [],
};

// ---------------------------------------------------------------------------
// Package definitions
// ---------------------------------------------------------------------------

type PackageDefinition = {
  code: string;
  name: string;
  description: string;
  tier: 'trial' | 'starter' | 'professional' | 'enterprise' | 'custom_institutional';
  priceMonthlyCents: number | null;
  priceQuarterlyCents: number | null;
  priceAnnuallyCents: number | null;
  trialDays: number;
  maxVehicles: number | null;
  maxUsers: number | null;
  maxDrivers: number | null;
  maxDepartments: number | null;
  maxStorageGb: number | null;
  features: readonly string[];
  sortOrder: number;
};

const PACKAGES: PackageDefinition[] = [
  {
    code: 'TRIAL',
    name: 'Free Trial',
    description: '7-day trial with full access to all features',
    tier: 'trial',
    priceMonthlyCents: 0,
    priceQuarterlyCents: 0,
    priceAnnuallyCents: 0,
    trialDays: 7,
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
    sortOrder: 10,
  },
  {
    code: 'STARTER',
    name: 'Starter',
    description: 'Basic fleet management for small organisations',
    tier: 'starter',
    priceMonthlyCents: 45000, // NAD 450.00
    priceQuarterlyCents: 121500, // NAD 1,215.00 (5% discount)
    priceAnnuallyCents: 432000, // NAD 4,320.00 (20% discount)
    trialDays: 14,
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
    sortOrder: 20,
  },
  {
    code: 'PROFESSIONAL',
    name: 'Professional',
    description: 'Standard package for regional councils and government agencies',
    tier: 'professional',
    priceMonthlyCents: 90000, // NAD 900.00
    priceQuarterlyCents: 243000, // NAD 2,430.00 (10% discount)
    priceAnnuallyCents: 864000, // NAD 8,640.00 (20% discount)
    trialDays: 30,
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
    sortOrder: 30,
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Unlimited fleet management for large organisations',
    tier: 'enterprise',
    priceMonthlyCents: 180000, // NAD 1,800.00
    priceQuarterlyCents: 486000, // NAD 4,860.00 (10% discount)
    priceAnnuallyCents: 1728000, // NAD 17,280.00 (20% discount)
    trialDays: 30,
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
    sortOrder: 40,
  },
  {
    code: 'CUSTOM_INSTITUTIONAL',
    name: 'Custom Institutional',
    description: 'Bespoke package for large institutions with dedicated support and SLA',
    tier: 'custom_institutional',
    priceMonthlyCents: 0, // custom pricing
    priceQuarterlyCents: 0,
    priceAnnuallyCents: 0,
    trialDays: 0,
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
    sortOrder: 50,
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
        status: 'active',
        priceMonthlyCents: pkg.priceMonthlyCents,
        priceQuarterlyCents: pkg.priceQuarterlyCents,
        priceAnnuallyCents: pkg.priceAnnuallyCents,
        defaultBillingInterval: 'annually',
        trialDays: pkg.trialDays,
        maxVehicles: pkg.maxVehicles,
        maxUsers: pkg.maxUsers,
        maxDrivers: pkg.maxDrivers,
        maxDepartments: pkg.maxDepartments,
        maxStorageGb: pkg.maxStorageGb,
        features: Object.fromEntries(pkg.features.map((f) => [f, true])),
        sortOrder: pkg.sortOrder,
      })
      .returning();

    // Insert permission entitlements derived from the feature flags
    const permissionCodes = [
      ...new Set(pkg.features.flatMap((f) => FEATURE_PERMISSIONS[f] ?? [])),
    ];
    if (permissionCodes.length > 0) {
      await db.insert(packageEntitlements).values(
        permissionCodes.map((permissionCode) => ({
          packageId: createdPkg.id,
          permissionCode,
          isIncluded: true,
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
