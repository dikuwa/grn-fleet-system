/**
 * Subscription package management service.
 *
 * Manages the lifecycle of subscription packages that Platform Admins create
 * and manage. These define the entitlements available to tenants.
 */

import { getDb } from '@/db';
import { subscriptionPackages, packageEntitlements } from '@/db/schema/packages';
import { eq, asc, inArray } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreatePackageInput = {
  code: string;
  name: string;
  description?: string;
  tier: 'trial' | 'starter' | 'professional' | 'enterprise' | 'custom_institutional';
  priceMonthlyCents?: number | null;
  priceQuarterlyCents?: number | null;
  priceAnnuallyCents?: number | null;
  defaultBillingInterval: 'monthly' | 'quarterly' | 'annually';
  maxVehicles?: number | null;
  maxUsers?: number | null;
  maxStorageGb?: number | null;
  maxDrivers?: number | null;
  maxDepartments?: number | null;
  maxOffices?: number | null;
  maxApiCallsPerMonth?: number | null;
  features?: Record<string, boolean>;
  trialDays?: number;
  trialRequiresPaymentMethod?: boolean;
  sortOrder?: number;
  entitlements?: Array<{ permissionCode: string; isIncluded: boolean }>;
};

export type UpdatePackageInput = Partial<CreatePackageInput>;

export type PackageWithEntitlements = typeof subscriptionPackages.$inferSelect & {
  entitlements: Array<{ permissionCode: string; isIncluded: boolean }>;
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** List all packages ordered by tier and sort order. */
export async function listPackages(): Promise<PackageWithEntitlements[]> {
  const db = getDb();
  const packages = await db
    .select()
    .from(subscriptionPackages)
    .orderBy(
      asc(subscriptionPackages.tier),
      asc(subscriptionPackages.sortOrder),
    );

  if (packages.length === 0) return packages;

  const packageIds = packages.map((p) => p.id);
  const entitlementRows = await db
    .select()
    .from(packageEntitlements)
    .where(inArray(packageEntitlements.packageId, packageIds));

  const grouped: Record<string, Array<{ permissionCode: string; isIncluded: boolean }>> = {};
  for (const row of entitlementRows) {
    const pkgId = row.packageId;
    if (!grouped[pkgId]) grouped[pkgId] = [];
    grouped[pkgId]!.push({
      permissionCode: row.permissionCode,
      isIncluded: row.isIncluded,
    });
  }

  return packages.map((pkg) => ({
    ...pkg,
    entitlements: grouped[pkg.id] ?? [],
  }));
}

/** Get a single package by ID. */
export async function getPackageById(id: string): Promise<PackageWithEntitlements | null> {
  const db = getDb();
  const [pkg] = await db
    .select()
    .from(subscriptionPackages)
    .where(eq(subscriptionPackages.id, id))
    .limit(1);

  if (!pkg) return null;

  const entitlementRows = await db
    .select()
    .from(packageEntitlements)
    .where(eq(packageEntitlements.packageId, pkg.id));

  return {
    ...pkg,
    entitlements: entitlementRows.map((e) => ({
      permissionCode: e.permissionCode,
      isIncluded: e.isIncluded,
    })),
  };
}

/** Get a package by code. */
export async function getPackageByCode(code: string): Promise<PackageWithEntitlements | null> {
  const db = getDb();
  const [pkg] = await db
    .select()
    .from(subscriptionPackages)
    .where(eq(subscriptionPackages.code, code))
    .limit(1);

  if (!pkg) return null;

  const entitlementRows = await db
    .select()
    .from(packageEntitlements)
    .where(eq(packageEntitlements.packageId, pkg.id));

  return {
    ...pkg,
    entitlements: entitlementRows.map((e) => ({
      permissionCode: e.permissionCode,
      isIncluded: e.isIncluded,
    })),
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Create a new subscription package. */
export async function createPackage(input: CreatePackageInput): Promise<PackageWithEntitlements> {
  const db = getDb();

  const [created] = await db
    .insert(subscriptionPackages)
    .values({
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      description: input.description,
      tier: input.tier,
      status: 'active',
      priceMonthlyCents: input.priceMonthlyCents,
      priceQuarterlyCents: input.priceQuarterlyCents,
      priceAnnuallyCents: input.priceAnnuallyCents,
      defaultBillingInterval: input.defaultBillingInterval,
      maxVehicles: input.maxVehicles,
      maxUsers: input.maxUsers,
      maxStorageGb: input.maxStorageGb,
      maxDrivers: input.maxDrivers,
      maxDepartments: input.maxDepartments,
      maxOffices: input.maxOffices,
      maxApiCallsPerMonth: input.maxApiCallsPerMonth,
      features: input.features ?? {},
      trialDays: input.trialDays ?? 0,
      trialRequiresPaymentMethod: input.trialRequiresPaymentMethod ?? false,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();

  if (input.entitlements && input.entitlements.length > 0) {
    await db.insert(packageEntitlements).values(
      input.entitlements.map((e) => ({
        packageId: created.id,
        permissionCode: e.permissionCode,
        isIncluded: e.isIncluded,
      })),
    );
  }

  return {
    ...created,
    entitlements: input.entitlements ?? [],
  };
}

/** Update an existing subscription package. */
export async function updatePackage(
  id: string,
  input: UpdatePackageInput,
): Promise<PackageWithEntitlements> {
  const db = getDb();

  const updates: Record<string, unknown> = {};
  if (input.code !== undefined) updates.code = input.code.trim().toUpperCase();
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.description !== undefined) updates.description = input.description;
  if (input.tier !== undefined) updates.tier = input.tier;
  if (input.priceMonthlyCents !== undefined) updates.priceMonthlyCents = input.priceMonthlyCents;
  if (input.priceQuarterlyCents !== undefined) updates.priceQuarterlyCents = input.priceQuarterlyCents;
  if (input.priceAnnuallyCents !== undefined) updates.priceAnnuallyCents = input.priceAnnuallyCents;
  if (input.defaultBillingInterval !== undefined) updates.defaultBillingInterval = input.defaultBillingInterval;
  if (input.maxVehicles !== undefined) updates.maxVehicles = input.maxVehicles;
  if (input.maxUsers !== undefined) updates.maxUsers = input.maxUsers;
  if (input.maxStorageGb !== undefined) updates.maxStorageGb = input.maxStorageGb;
  if (input.maxDrivers !== undefined) updates.maxDrivers = input.maxDrivers;
  if (input.maxDepartments !== undefined) updates.maxDepartments = input.maxDepartments;
  if (input.maxOffices !== undefined) updates.maxOffices = input.maxOffices;
  if (input.maxApiCallsPerMonth !== undefined) updates.maxApiCallsPerMonth = input.maxApiCallsPerMonth;
  if (input.features !== undefined) updates.features = input.features;
  if (input.trialDays !== undefined) updates.trialDays = input.trialDays;
  if (input.trialRequiresPaymentMethod !== undefined) updates.trialRequiresPaymentMethod = input.trialRequiresPaymentMethod;
  if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;

  updates.updatedAt = new Date();

  if (Object.keys(updates).length > 1) {
    await db
      .update(subscriptionPackages)
      .set(updates)
      .where(eq(subscriptionPackages.id, id));
  }

  // Replace entitlements if provided
  if (input.entitlements !== undefined) {
    await db.delete(packageEntitlements).where(eq(packageEntitlements.packageId, id));
    if (input.entitlements.length > 0) {
      await db.insert(packageEntitlements).values(
        input.entitlements.map((e) => ({
          packageId: id,
          permissionCode: e.permissionCode,
          isIncluded: e.isIncluded,
        })),
      );
    }
  }

  const pkg = await getPackageById(id);
  if (!pkg) throw new Error('Package not found after update');
  return pkg;
}

/** Deactivate a package (soft delete — existing subscriptions keep their reference). */
export async function archivePackage(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(subscriptionPackages)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(subscriptionPackages.id, id));
}

/** Get the price for a package at a given billing interval. */
export function getPackagePrice(
  pkg: { priceMonthlyCents: number | null; priceQuarterlyCents: number | null; priceAnnuallyCents: number | null },
  interval: 'monthly' | 'quarterly' | 'annually',
): number | null {
  switch (interval) {
    case 'monthly': return pkg.priceMonthlyCents;
    case 'quarterly': return pkg.priceQuarterlyCents;
    case 'annually': return pkg.priceAnnuallyCents;
  }
}