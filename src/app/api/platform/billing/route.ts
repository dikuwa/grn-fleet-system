/**
 * Platform Billing Settings API
 *
 * GET   /api/platform/billing — List all tenants' billing settings
 * POST  /api/platform/billing — Upsert billing settings for a tenant
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import { billingSettings } from '@/db/schema/subscriptions';
import { tenants } from '@/db/schema';
import { eq, desc, count, and, or, like } from 'drizzle-orm';
import { recordAuditEvent } from '@/lib/audit-event';

// ---------------------------------------------------------------------------
// GET — List all tenants' billing settings
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.BILLING_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '25', 10);
    const offset = (page - 1) * limit;

    const db = getDb();

    const conditions: ReturnType<typeof and>[] = [];
    if (q) {
      conditions.push(
        or(
          like(tenants.name, `%${q}%`),
          like(billingSettings.billingContactName, `%${q}%`),
          like(billingSettings.billingContactEmail, `%${q}%`),
          like(billingSettings.taxId, `%${q}%`),
        )!,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ count: count() })
      .from(billingSettings)
      .innerJoin(tenants, eq(billingSettings.tenantId, tenants.id))
      .where(whereClause);

    const total = totalResult?.count || 0;

    const settings = await db
      .select({
        id: billingSettings.id,
        tenantId: billingSettings.tenantId,
        tenantName: tenants.name,
        tenantCode: tenants.code,
        billingContactName: billingSettings.billingContactName,
        billingContactEmail: billingSettings.billingContactEmail,
        billingContactPhone: billingSettings.billingContactPhone,
        billingAddressLine1: billingSettings.billingAddressLine1,
        billingCity: billingSettings.billingCity,
        billingRegion: billingSettings.billingRegion,
        billingCountry: billingSettings.billingCountry,
        taxId: billingSettings.taxId,
        taxExempt: billingSettings.taxExempt,
        preferredPaymentMethod: billingSettings.preferredPaymentMethod,
        bankAccountName: billingSettings.bankAccountName,
        bankName: billingSettings.bankName,
        gracePeriodDays: billingSettings.gracePeriodDays,
        createdAt: billingSettings.createdAt,
        updatedAt: billingSettings.updatedAt,
      })
      .from(billingSettings)
      .innerJoin(tenants, eq(billingSettings.tenantId, tenants.id))
      .where(whereClause)
      .orderBy(desc(billingSettings.updatedAt))
      .limit(limit)
      .offset(offset);

    // Compute stats
    const [totalCount] = await db
      .select({ count: count() })
      .from(billingSettings);

    const [taxExemptCount] = await db
      .select({ count: count() })
      .from(billingSettings)
      .where(eq(billingSettings.taxExempt, true));

    const [configuredCount] = await db
      .select({ count: count() })
      .from(billingSettings)
      .where(
        or(
          like(billingSettings.billingContactEmail, '%@%'),
          like(billingSettings.taxId, '%'),
        )!,
      );

    return NextResponse.json({
      success: true,
      data: {
        settings,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        stats: {
          total: totalCount?.count || 0,
          taxExempt: taxExemptCount?.count || 0,
          fullyConfigured: configuredCount?.count || 0,
        },
      },
    });
  } catch (error) {
    console.error('[Platform Billing] GET failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Upsert billing settings for a tenant
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.BILLING_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { tenantId } = body;

    if (!tenantId) {
      return NextResponse.json(
        { error: 'tenantId is required' },
        { status: 400 },
      );
    }

    const db = getDb();

    // Verify tenant exists
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Whitelist updatable fields (mirrors PATCH [tenantId])
    const UPDATABLE_FIELDS: (keyof typeof billingSettings.$inferSelect)[] = [
      'billingContactName',
      'billingContactEmail',
      'billingContactPhone',
      'billingAddressLine1',
      'billingAddressLine2',
      'billingCity',
      'billingRegion',
      'billingPostalCode',
      'billingCountry',
      'taxId',
      'taxExempt',
      'taxExemptCertificateUrl',
      'preferredPaymentMethod',
      'paymentInstructions',
      'bankAccountName',
      'bankName',
      'bankBranchCode',
      'bankAccountNumber',
      'bankSwiftCode',
      'bankReferenceTemplate',
      'mobilePaymentProvider',
      'mobilePaymentNumber',
      'mobilePaymentReferenceTemplate',
      'notifyOnPaymentDue',
      'notifyOnPaymentReceived',
      'notifyOnPaymentOverdue',
      'notifyOnSubscriptionChanges',
      'gracePeriodDays',
    ];

    const settingsData: Partial<typeof billingSettings.$inferInsert> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (body[field] !== undefined) (settingsData as Record<string, unknown>)[field] = body[field];
    }

    // Upsert billing settings
    const [settings] = await db
      .insert(billingSettings)
      .values({
        tenantId,
        ...settingsData,
      })
      .onConflictDoUpdate({
        target: billingSettings.tenantId,
        set: { ...settingsData, updatedAt: new Date() },
      })
      .returning();

    // Audit the change
    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: 'billing_settings.upserted',
      entityType: 'billing_settings',
      entityId: settings.id,
      summary: `Billing settings upserted for tenant ${tenant.name}`,
      after: {
        targetTenantId: tenantId,
        updatedFields: Object.keys(settingsData),
      },
    });

    return NextResponse.json({ success: true, data: settings }, { status: 200 });
  } catch (error) {
    console.error('[Platform Billing] POST failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
