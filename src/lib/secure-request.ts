import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/env';
import { getDb } from '@/db';
import { secureRequestSessions, tenants } from '@/db/schema';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { isPublicEmployeeRequestEnabled } from '@/lib/public-request-access';

export const SECURE_REQUEST_COOKIE = 'grn_secure_request';
const secret = () => env.BETTER_AUTH_SECRET || env.SHARE_TOKEN_PEPPER || 'development-only-secret';

export function secureHash(value: string) {
  return createHmac('sha256', secret()).update(value).digest('hex');
}

export function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function generateSecureRequestToken() {
  return randomBytes(32).toString('base64url');
}

export function safeHashEquals(candidate: string, expectedHash: string) {
  const candidateHash = secureHash(candidate);
  return timingSafeEqual(Buffer.from(candidateHash), Buffer.from(expectedHash));
}

export function maskDestination(value: string) {
  const at = value.indexOf('@');
  if (at > 1) return `${value[0]}***${value.slice(at)}`;
  const digits = value.replace(/\D/g, '');
  return digits.length > 4 ? `***${digits.slice(-4)}` : '***';
}

export async function resolveSecureRequestSession(token?: string | null) {
  if (!token) return null;
  const db = getDb();
  const [row] = await db
    .select({ session: secureRequestSessions, tenantMetadata: tenants.metadata })
    .from(secureRequestSessions)
    .innerJoin(tenants, eq(tenants.id, secureRequestSessions.tenantId))
    .where(
      and(
        eq(secureRequestSessions.tokenHash, secureHash(token)),
        gt(secureRequestSessions.expiresAt, new Date()),
        isNull(secureRequestSessions.revokedAt),
      ),
    )
    .limit(1);
  if (!row || !isPublicEmployeeRequestEnabled(row.tenantMetadata)) return null;
  return row.session;
}

export function publicRequestCsrfAllowed(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
