import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { employees, secureRequestSessions, secureRequestVerifications, tenants } from '@/db/schema';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { rateLimit } from '@/lib/rate-limit';
import {
  generateSecureRequestToken,
  publicRequestCsrfAllowed,
  safeHashEquals,
  SECURE_REQUEST_COOKIE,
  secureHash,
} from '@/lib/secure-request';
import { isPublicEmployeeRequestEnabled } from '@/lib/public-request-access';
import { recordAuditEvent } from '@/lib/audit-event';

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantSlug: string }> }) {
  if (!publicRequestCsrfAllowed(request)) return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
  const { tenantSlug } = await params;
  const body = await request.json() as { verificationId?: string; otp?: string };
  if (!body.verificationId || !body.otp || !/^\d{6}$/.test(body.otp)) {
    return NextResponse.json({ error: 'We could not verify the information provided.' }, { status: 400 });
  }
  const limited = await rateLimit(`secure-otp:${body.verificationId}`, 6, 900);
  if (!limited.success) return NextResponse.json({ error: 'Too many attempts. Please request a new code.' }, { status: 429, headers: limited.headers });
  const db = getDb();
  const [verification] = await db.select({
    id: secureRequestVerifications.id,
    tenantId: secureRequestVerifications.tenantId,
    employeeId: secureRequestVerifications.employeeId,
    otpHash: secureRequestVerifications.otpHash,
    attempts: secureRequestVerifications.attempts,
    expiresAt: secureRequestVerifications.expiresAt,
    tenantMetadata: tenants.metadata,
  }).from(secureRequestVerifications)
    .innerJoin(tenants, eq(tenants.id, secureRequestVerifications.tenantId))
    .where(and(
      eq(secureRequestVerifications.id, body.verificationId),
      eq(tenants.slug, tenantSlug),
      gt(secureRequestVerifications.expiresAt, new Date()),
      isNull(secureRequestVerifications.verifiedAt),
    )).limit(1);
  if (
    !verification ||
    !isPublicEmployeeRequestEnabled(verification.tenantMetadata) ||
    !verification.employeeId ||
    verification.attempts >= 5 ||
    !safeHashEquals(body.otp, verification.otpHash)
  ) {
    if (verification) await db.update(secureRequestVerifications)
      .set({ attempts: sql`${secureRequestVerifications.attempts} + 1` })
      .where(eq(secureRequestVerifications.id, verification.id));
    return NextResponse.json({ error: 'We could not verify the information provided.' }, { status: 400 });
  }
  const [employee] = await db.select({
    id: employees.id,
    firstName: employees.firstName,
    lastName: employees.lastName,
    employeeNumber: employees.employeeNumber,
    email: employees.email,
    phone: employees.phone,
    officeId: employees.officeId,
    departmentId: employees.departmentId,
    supervisorEmployeeId: employees.supervisorEmployeeId,
  }).from(employees).where(and(
    eq(employees.id, verification.employeeId),
    eq(employees.tenantId, verification.tenantId),
    eq(employees.employmentStatus, 'active'),
  )).limit(1);
  if (!employee) return NextResponse.json({ error: 'We could not verify the information provided.' }, { status: 400 });

  const token = generateSecureRequestToken();
  const expiresAt = new Date(Date.now() + 60 * 60_000);
  await db.transaction(async (tx) => {
    await tx.update(secureRequestVerifications).set({ verifiedAt: new Date() }).where(eq(secureRequestVerifications.id, verification.id));
    await tx.insert(secureRequestSessions).values({
      tenantId: verification.tenantId,
      employeeId: employee.id,
      verificationId: verification.id,
      tokenHash: secureHash(token),
      expiresAt,
    });
  });
  await recordAuditEvent({
    tenantId: verification.tenantId,
    actorUserId: `secure-request:${employee.id}`,
    actorEmployeeId: employee.id,
    action: 'secure_request.otp_verified',
    entityType: 'secure_request_verification',
    entityId: verification.id,
    sourceChannel: 'secure_staff_link',
  });
  const response = NextResponse.json({
    employee: {
      firstName: employee.firstName,
      lastName: employee.lastName,
      employeeNumber: employee.employeeNumber,
      email: employee.email,
      phone: employee.phone,
    },
    expiresAt,
  });
  response.cookies.set(SECURE_REQUEST_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: `/`,
    maxAge: 3600,
  });
  return response;
}
