/**
 * POST /api/reports/licence-expiry/run-cron
 *
 * Server-side proxy that triggers the cron licence expiry check.
 * Authenticated users (Transport Admin, Tenant Admin) can trigger this
 * from the report page without exposing CRON_SECRET to the client bundle.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { requireAnyPermission } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    // Check permission - only admins can trigger the cron
    const permCheck = await requireAnyPermission(session, [
      Permissions.STAFF_MANAGE,
      Permissions.LICENCE_VERIFY,
      Permissions.TENANT_MANAGE,
    ]);
    if (permCheck instanceof NextResponse) return permCheck;

    // Call the cron endpoint internally
    const cronUrl = new URL('/api/cron/licence-expiry', request.url);
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      cronUrl.searchParams.set('token', cronSecret);
    }

    const cronRes = await fetch(cronUrl.toString());
    if (!cronRes.ok) {
      const errorText = await cronRes.text().catch(() => 'Unknown error');
      return NextResponse.json(
        { error: `Cron check failed: ${errorText}` },
        { status: 502 },
      );
    }

    const cronData = await cronRes.json();
    return NextResponse.json({
      success: true,
      ...cronData,
    });
  } catch (error: unknown) {
    console.error('[reports/licence-expiry/run-cron] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to run licence expiry check' },
      { status: 500 },
    );
  }
}
