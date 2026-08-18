import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  employees,
  secureRequestSessions,
  secureRequestVerifications,
  tenants,
} from '@/db/schema';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { rateLimit } from '@/lib/rate-limit';
import {
  generateOtp,
  generateSecureRequestToken,
  maskDestination,
  publicRequestCsrfAllowed,
  SECURE_REQUEST_COOKIE,
  secureHash,
} from '@/lib/secure-request';
import { sendPlainEmail } from '@/lib/email';
import { recordAuditEvent } from '@/lib/audit-event';

const genericMessage =
  'If the information matches an active employee record, verification will continue.';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string }> },
) {
  if (!publicRequestCsrfAllowed(request)) {
    return NextResponse.json({ error: 'Request could not be verified' }, { status: 403 });
  }

  const { tenantSlug } = await params;
  const body = (await request.json()) as {
    employeeNumber?: string;
    surname?: string;
    verifier?: string;
  };
  const employeeNumber = body.employeeNumber?.trim();
  const surname = body.surname?.trim();
  const verifier = body.verifier?.trim();

  if (!employeeNumber || !surname || !verifier) {
    return NextResponse.json({ message: genericMessage });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const identityHash = secureHash(
    `${tenantSlug}:${employeeNumber.toLowerCase()}:${surname.toLowerCase()}:${verifier.toLowerCase()}`,
  );
  const limited = await rateLimit(`secure-request:${secureHash(ip)}:${identityHash}`, 5, 900);
  if (!limited.success) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.' },
      { status: 429, headers: limited.headers },
    );
  }

  const db = getDb();
  const [match] = await db
    .select({
      tenantId: tenants.id,
      tenantName: tenants.name,
      employeeId: employees.id,
      employeeNumber: employees.employeeNumber,
      firstName: employees.firstName,
      lastName: employees.lastName,
      email: employees.email,
      phone: employees.phone,
    })
    .from(tenants)
    .innerJoin(employees, eq(employees.tenantId, tenants.id))
    .where(
      and(
        eq(tenants.slug, tenantSlug),
        sql`lower(${tenants.status}) = 'active'`,
        eq(employees.employeeNumber, employeeNumber),
        eq(employees.employmentStatus, 'active'),
        ilike(employees.lastName, surname),
        or(ilike(employees.email, verifier), eq(employees.phone, verifier)),
      ),
    )
    .limit(1);

  // Deliberately keep the public failure generic so staff-directory membership
  // cannot be enumerated by anonymous callers.
  if (!match) {
    return NextResponse.json({ message: genericMessage });
  }

  const otp = generateOtp();
  const verificationExpiresAt = new Date(Date.now() + 10 * 60_000);
  const [verification] = await db
    .insert(secureRequestVerifications)
    .values({
      tenantId: match.tenantId,
      employeeId: match.employeeId,
      identityHash,
      otpHash: secureHash(otp),
      channel: 'email',
      destinationMasked: match.email ? maskDestination(match.email) : 'staff directory',
      expiresAt: verificationExpiresAt,
      requestIpHash: secureHash(ip),
    })
    .returning();

  // Email is the preferred free/low-cost possession check whenever a sender is
  // configured. No SMS dependency is required. If email delivery is not
  // configured yet, fall back to a stronger three-field staff-directory match
  // (employee number + surname + registered email/mobile) and issue a short
  // request-only session. This fallback can later be disabled tenant-by-tenant
  // when an email/SMS provider is available, without changing the request flow.
  let sent = { success: false as boolean };
  if (match.email) {
    sent = await sendPlainEmail(
      match.email,
      `${match.tenantName} transport request verification code`,
      `Hello ${match.firstName},\n\nYour GRN Fleet transport request verification code is ${otp}.\n\nIt expires in 10 minutes. Do not share this code.`,
    );
  }

  if (sent.success) {
    await recordAuditEvent({
      tenantId: match.tenantId,
      actorUserId: `secure-request:${match.employeeId}`,
      actorEmployeeId: match.employeeId,
      action: 'secure_request.otp_sent',
      entityType: 'secure_request_verification',
      entityId: verification.id,
      sourceChannel: 'secure_staff_link',
      after: {
        channel: 'email',
        destination: maskDestination(match.email!),
        expiresAt: verificationExpiresAt,
      },
    });

    return NextResponse.json({
      message: genericMessage,
      mode: 'otp',
      verificationId: verification.id,
      destination: maskDestination(match.email!),
    });
  }

  const token = generateSecureRequestToken();
  const sessionExpiresAt = new Date(Date.now() + 60 * 60_000);
  await db.transaction(async (tx) => {
    await tx
      .update(secureRequestVerifications)
      .set({ channel: 'directory', verifiedAt: new Date() })
      .where(eq(secureRequestVerifications.id, verification.id));
    await tx.insert(secureRequestSessions).values({
      tenantId: match.tenantId,
      employeeId: match.employeeId,
      verificationId: verification.id,
      tokenHash: secureHash(token),
      expiresAt: sessionExpiresAt,
    });
  });

  await recordAuditEvent({
    tenantId: match.tenantId,
    actorUserId: `secure-request:${match.employeeId}`,
    actorEmployeeId: match.employeeId,
    action: 'secure_request.directory_verified',
    entityType: 'secure_request_verification',
    entityId: verification.id,
    sourceChannel: 'secure_staff_link',
    after: { channel: 'directory', expiresAt: sessionExpiresAt },
  });

  const response = NextResponse.json({
    message: genericMessage,
    mode: 'directory',
    employee: {
      firstName: match.firstName,
      lastName: match.lastName,
      employeeNumber: match.employeeNumber,
      email: match.email,
      phone: match.phone,
    },
    expiresAt: sessionExpiresAt,
  });
  response.cookies.set(SECURE_REQUEST_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 3600,
  });
  return response;
}
