import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  archivePackage,
  getPackageByCode,
  getPackageById,
  updatePackage,
} from '@/lib/platform/packages';
import {
  entitlementsForFeatures,
  normalisePackageFeatures,
} from '@/lib/platform/package-feature-catalog';

const tierSchema = z.enum([
  'trial',
  'starter',
  'professional',
  'enterprise',
  'custom_institutional',
]);
const billingSchema = z.enum(['monthly', 'quarterly', 'annually']);
const nullableLimit = z.number().int().min(0).nullable().optional();
const nullableMoney = z.number().int().min(0).nullable().optional();

const updateSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/).optional(),
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  tier: tierSchema.optional(),
  priceMonthlyCents: nullableMoney,
  priceQuarterlyCents: nullableMoney,
  priceAnnuallyCents: nullableMoney,
  defaultBillingInterval: billingSchema.optional(),
  maxVehicles: nullableLimit,
  maxUsers: nullableLimit,
  maxStorageGb: nullableLimit,
  maxDrivers: nullableLimit,
  maxDepartments: nullableLimit,
  maxOffices: nullableLimit,
  maxApiCallsPerMonth: nullableLimit,
  trialDays: z.number().int().min(0).max(365).optional(),
  trialRequiresPaymentMethod: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  features: z.record(z.string(), z.boolean()).optional(),
});

async function requirePlatformAdmin(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return { error: auth.error } as const;

  const permission = await requirePermission(auth.session, Permissions.PLATFORM_ADMIN);
  if (permission instanceof NextResponse) return { error: permission } as const;

  return { session: auth.session } as const;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePlatformAdmin(request);
    if ('error' in auth) return auth.error;

    const { id } = await context.params;
    const existing = await getPackageById(id);
    if (!existing) return NextResponse.json({ error: 'Package not found' }, { status: 404 });

    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid package configuration', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    if (parsed.data.code) {
      const code = parsed.data.code.trim().toUpperCase();
      const duplicate = await getPackageByCode(code);
      if (duplicate && duplicate.id !== id) {
        return NextResponse.json({ error: `Package code ${code} already exists` }, { status: 409 });
      }
    }

    const features = parsed.data.features
      ? normalisePackageFeatures(parsed.data.features)
      : undefined;

    const updated = await updatePackage(id, {
      ...parsed.data,
      ...(parsed.data.code ? { code: parsed.data.code.trim().toUpperCase() } : {}),
      ...(features
        ? {
            features,
            entitlements: entitlementsForFeatures(features),
          }
        : {}),
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Platform Packages] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update subscription package' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePlatformAdmin(request);
    if ('error' in auth) return auth.error;

    const { id } = await context.params;
    const existing = await getPackageById(id);
    if (!existing) return NextResponse.json({ error: 'Package not found' }, { status: 404 });

    await archivePackage(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Platform Packages] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to archive subscription package' }, { status: 500 });
  }
}
