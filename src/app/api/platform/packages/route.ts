import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { createPackage, getPackageByCode, listPackages } from '@/lib/platform/packages';
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

const packageSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional().default(''),
  tier: tierSchema,
  priceMonthlyCents: nullableMoney,
  priceQuarterlyCents: nullableMoney,
  priceAnnuallyCents: nullableMoney,
  defaultBillingInterval: billingSchema,
  maxVehicles: nullableLimit,
  maxUsers: nullableLimit,
  maxStorageGb: nullableLimit,
  maxDrivers: nullableLimit,
  maxDepartments: nullableLimit,
  maxOffices: nullableLimit,
  maxApiCallsPerMonth: nullableLimit,
  trialDays: z.number().int().min(0).max(365).optional().default(0),
  trialRequiresPaymentMethod: z.boolean().optional().default(false),
  sortOrder: z.number().int().min(0).max(10000).optional().default(0),
  features: z.record(z.string(), z.boolean()).optional().default({}),
});

async function requirePlatformAdmin(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return { error: auth.error } as const;

  const permission = await requirePermission(auth.session, Permissions.PLATFORM_ADMIN);
  if (permission instanceof NextResponse) return { error: permission } as const;

  return { session: auth.session } as const;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePlatformAdmin(request);
    if ('error' in auth) return auth.error;

    const packages = await listPackages();
    return NextResponse.json({ success: true, data: { packages } });
  } catch (error) {
    console.error('[Platform Packages] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load subscription packages' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePlatformAdmin(request);
    if ('error' in auth) return auth.error;

    const parsed = packageSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid package configuration', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const code = parsed.data.code.trim().toUpperCase();
    if (await getPackageByCode(code)) {
      return NextResponse.json({ error: `Package code ${code} already exists` }, { status: 409 });
    }

    const features = normalisePackageFeatures(parsed.data.features);
    const created = await createPackage({
      ...parsed.data,
      code,
      features,
      entitlements: entitlementsForFeatures(features),
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    console.error('[Platform Packages] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create subscription package' }, { status: 500 });
  }
}
