import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { employees, secureRequestVerifications, tenants } from '@/db/schema';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { rateLimit } from '@/lib/rate-limit';
import { generateOtp, maskDestination, publicRequestCsrfAllowed, secureHash } from '@/lib/secure-request';
import { sendPlainEmail } from '@/lib/email';
import { recordAuditEvent } from '@/lib/audit-event';

const genericMessage = 'If the information matches an active employee record, a verification code will be sent.';

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantSlug: string }> }) {
  if (!publicRequestCsrfAllowed(request)) return NextResponse.json({ error: 'Request could not be verified' }, { status: 403 });
  const { tenantSlug } = await params;
  const body = await request.json() as { employeeNumber?: string; verifier?: string };
  const employeeNumber = body.employeeNumber?.trim();
  const verifier = body.verifier?.trim();
  if (!employeeNumber || !verifier) return NextResponse.json({ message: genericMessage });
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const identityHash = secureHash(`${tenantSlug}:${employeeNumber.toLowerCase()}:${verifier.toLowerCase()}`);
  const limited = await rateLimit(`secure-request:${secureHash(ip)}:${identityHash}`, 5, 900);
  if (!limited.success) return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429, headers: limited.headers });

  const db = getDb();
  const [match] = await db.select({
    tenantId: tenants.id,
    tenantName: tenants.name,
    employeeId: employees.id,
    firstName: employees.firstName,
    lastName: employees.lastName,
    email: employees.email,
    phone: employees.phone,
  }).from(tenants)
    .innerJoin(employees, eq(employees.tenantId, tenants.id))
    .where(and(
      eq(tenants.slug, tenantSlug),
      sql`lower(${tenants.status}) = 'active'`,
      eq(employees.employeeNumber, employeeNumber),
      eq(employees.employmentStatus, 'active'),
      or(
        ilike(employees.lastName, verifier),
        ilike(employees.email, verifier),
        eq(employees.phone, verifier),
      ),
    )).limit(1);

  if (!match?.email) {
    return NextResponse.json({ message: genericMessage });
  }
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const [verification] = await db.insert(secureRequestVerifications).values({
    tenantId: match.tenantId,
    employeeId: match.employeeId,
    identityHash,
    otpHash: secureHash(otp),
    channel: 'email',
    destinationMasked: maskDestination(match.email),
    expiresAt,
    requestIpHash: secureHash(ip),
  }).returning();
  const sent = await sendPlainEmail(
    match.email,
    `${match.tenantName} transport request verification code`,
    `Hello ${match.firstName},\n\nYour GRN Fleet transport request verification code is ${otp}.\n\nIt expires in 10 minutes. Do not share this code.`,
  );
  if (!sent.success && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Verification service is temporarily unavailable. Please use the assisted request option.' }, { status: 503 });
  }
  await recordAuditEvent({
    tenantId: match.tenantId,
    actorUserId: `secure-request:${match.employeeId}`,
    actorEmployeeId: match.employeeId,
    action: 'secure_request.otp_sent',
    entityType: 'secure_request_verification',
    entityId: verification.id,
    sourceChannel: 'secure_staff_link',
    after: { channel: 'email', destination: maskDestination(match.email), expiresAt },
  });
  return NextResponse.json({
    message: genericMessage,
    verificationId: verification.id,
    destination: maskDestination(match.email),
    ...(process.env.NODE_ENV !== 'production' && !sent.success ? { developmentOtp: otp } : {}),
  });
}
