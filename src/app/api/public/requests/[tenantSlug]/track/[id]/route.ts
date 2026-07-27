import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { transportRequests, tenants } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { secureHash } from '@/lib/secure-request';

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantSlug: string; id: string }> }) {
  const { tenantSlug, id } = await params;
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Tracking link is invalid or expired.' }, { status: 401 });
  const db = getDb();
  const [record] = await db.select({
    id: transportRequests.id,
    reference: transportRequests.reference,
    status: transportRequests.status,
    submittedAt: transportRequests.submittedAt,
    updatedAt: transportRequests.updatedAt,
    purpose: transportRequests.purpose,
  }).from(transportRequests)
    .innerJoin(tenants, eq(tenants.id, transportRequests.tenantId))
    .where(and(
      eq(transportRequests.id, id),
      eq(tenants.slug, tenantSlug),
      eq(transportRequests.publicTrackingTokenHash, secureHash(token)),
    )).limit(1);
  if (!record) return NextResponse.json({ error: 'Tracking link is invalid or expired.' }, { status: 404 });
  return NextResponse.json({ request: record });
}
