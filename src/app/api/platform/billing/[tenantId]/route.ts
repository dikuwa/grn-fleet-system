/**
 * Platform Billing Settings Detail API
 *
 * GET    /api/platform/billing/[tenantId] — Get billing settings for a tenant
 * PATCH  /api/platform/billing/[tenantId] — Update billing settings for a tenant
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import { billingSettings } from '@/db/schema/subscriptions';
import { tenants } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { recordAuditEvent } from '@/lib/audit-event';

// ---------------------------------------------------------------------------
// GET — Get billing settings for a tenant
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const auth = await requireRequestAuth(_request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.BILLING_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { tenantId } = await params;
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

    // Fetch billing settings
    const [settings] = await db
      .select()
      .from(billingSettings)
      .where(eq(billingSettings.tenantId, tenantId))
      .limit(1);

    if (!settings) {
      return NextResponse.json({
        success: true,
        data: {
          tenantId: tenant.id,
          tenantName: tenant.name,
          tenantCode: tenant.code,
          billingCountry: 'Namibia',
          taxExempt: false,
          gracePeriodDays: 14,
          notifyOnPaymentDue: true,
          notifyOnPaymentReceived: true,
          notifyOnPaymentOverdue: true,
          notifyOnSubscriptionChanges: true,
        },
        message: 'No billing settings configured for this tenant',
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...settings,
        tenantName: tenant.name,
        tenantCode: tenant.code,
      },
    });
  } catch (error) {
    console.error('[Platform Billing Detail] GET failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — Update billing settings for a tenant
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.BILLING_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { tenantId } = await params;
    const body = await request.json();

    // Whitelist updatable fields so client-supplied joins/read-only fields
    // (id, tenantName, tenantCode, createdAt, updatedAt, metadata) can't leak in.
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

    const updates: Partial<typeof billingSettings.$inferInsert> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (body[field] !== undefined) (updates as Record<string, unknown>)[field] = body[field];
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

    // Check if settings exist
    const [existing] = await db
      .select()
      .from(billingSettings)
      .where(eq(billingSettings.tenantId, tenantId))
      .limit(1);

    let settings;
    if (existing) {
      // Update existing
      [settings] = await db
        .update(billingSettings)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(billingSettings.tenantId, tenantId))
        .returning();
    } else {
      // Create new
      [settings] = await db
        .insert(billingSettings)
        .values({ tenantId, ...updates })
        .returning();
    }

    // Audit the change
    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: existing ? 'billing_settings.updated' : 'billing_settings.created',
      entityType: 'billing_settings',
      entityId: settings.id,
      summary: `Billing settings ${existing ? 'updated' : 'created'} for tenant ${tenant.name}`,
      after: {
        targetTenantId: tenantId,
        updatedFields: Object.keys(updates),
      },
    });

    return NextResponse.json({ success: true, data: settings });
  } catch (error) {
    console.error('[Platform Billing Detail] PATCH failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
