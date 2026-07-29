import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { CheckCircle2, CircleSlash2, Clock3 } from 'lucide-react';
import { getDb } from '@/db';
import { auditEvents } from '@/db/schema/audit';
import { tripAuthorities, tripAuthorisedDrivers, vehicleAllocations } from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { tenants } from '@/db/schema/tenants';
import { vehicles } from '@/db/schema/fleet';
import { PublicThemeToggle } from '@/components/layout/public-theme-toggle';
import { TenantLogo } from '@/components/documents/tenant-logo';
import { resolveTenantBranding, type ResolvedTenantBranding } from '@/lib/tenant-branding';

export const dynamic = 'force-dynamic';

function publicStatus(status: string, validFrom: Date | null, validUntil: Date | null) {
  const now = new Date();
  if (['draft', 'awaiting_approval', 'approved'].includes(status)) {
    return { label: 'Not Yet Issued', valid: false };
  }
  if (status === 'cancelled') return { label: 'Cancelled', valid: false };
  if (status === 'suspended') return { label: 'Suspended', valid: false };
  if (status === 'superseded') return { label: 'Superseded', valid: false };
  if (validUntil && now > validUntil) return { label: 'Expired', valid: false };
  if (validFrom && now < validFrom) return { label: 'Not Yet Valid', valid: false };
  if (['completed', 'closed'].includes(status)) return { label: 'Completed', valid: true };
  return { label: 'Valid', valid: true };
}

export default async function VerifyAuthorityPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const hash = createHash('sha256').update(token).digest('base64url');
  const db = getDb();
  const [authority] = await db
    .select({
      id: tripAuthorities.id,
      tenantId: tripAuthorities.tenantId,
      authorityNumber: tripAuthorities.authorityNumber,
      status: tripAuthorities.status,
      version: tripAuthorities.version,
      validFrom: tripAuthorities.validFrom,
      validUntil: tripAuthorities.validUntil,
      origin: tripAuthorities.origin,
      destination: tripAuthorities.destination,
      issuedAt: tripAuthorities.issuedAt,
      updatedAt: tripAuthorities.updatedAt,
      organisation: tenants.name,
      registration: vehicles.licenceNumber,
      driverFirstName: employees.firstName,
      driverLastName: employees.lastName,
    })
    .from(tripAuthorities)
    .innerJoin(tenants, eq(tenants.id, tripAuthorities.tenantId))
    .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, tripAuthorities.allocationId))
    .innerJoin(vehicles, eq(vehicles.id, vehicleAllocations.vehicleId))
    .leftJoin(
      tripAuthorisedDrivers,
      and(
        eq(tripAuthorisedDrivers.authorityId, tripAuthorities.id),
        eq(tripAuthorisedDrivers.driverType, 'primary'),
      ),
    )
    .leftJoin(employees, eq(employees.id, tripAuthorisedDrivers.employeeId))
    .where(eq(tripAuthorities.verificationTokenHash, hash))
    .limit(1);

  if (!authority) {
    return (
      <VerificationShell>
        <div className="border-status-error-border bg-status-error-bg rounded-xl border p-6 text-center">
          <CircleSlash2 className="text-status-error-text mx-auto h-10 w-10" />
          <h1 className="text-ink-950 mt-3 text-xl font-semibold">Authority Not Found</h1>
          <p className="text-ink-600 mt-2 text-sm">
            This verification code is invalid or no longer recognised.
          </p>
        </div>
      </VerificationShell>
    );
  }

  const verification = publicStatus(authority.status, authority.validFrom, authority.validUntil);
  const branding = await resolveTenantBranding(authority.tenantId!);
  await db
    .insert(auditEvents)
    .values({
      tenantId: authority.tenantId!,
      tenantSequence: 0,
      eventType: 'trip_authority_verified',
      actorUserId: 'public-verifier',
      action: 'verify',
      entityType: 'trip_authority',
      entityId: authority.id,
      summary: `${authority.authorityNumber} public verification returned ${verification.label}`,
      sourceChannel: 'public_qr',
    })
    .catch(() => undefined);

  const rows = [
    ['Trip Authority', authority.authorityNumber ?? 'Pending number'],
    ['Organisation', authority.organisation],
    ['Vehicle', authority.registration],
    [
      'Authorised driver',
      [authority.driverFirstName, authority.driverLastName].filter(Boolean).join(' ') ||
        'Not available',
    ],
    ['Valid from', authority.validFrom?.toLocaleString('en-NA') ?? 'Not set'],
    ['Valid until', authority.validUntil?.toLocaleString('en-NA') ?? 'Not set'],
    [
      'Route',
      [authority.origin, authority.destination].filter(Boolean).join(' → ') ||
        'Approved route on authority',
    ],
    ['Issue date', authority.issuedAt?.toLocaleString('en-NA') ?? 'Not issued'],
    ['Version', `v${authority.version}`],
    ['Last update', authority.updatedAt.toLocaleString('en-NA')],
  ];

  return (
    <VerificationShell branding={branding}>
      <div
        className={`rounded-xl border p-5 ${
          verification.valid
            ? 'border-status-success-border bg-status-success-bg'
            : 'border-status-error-border bg-status-error-bg'
        }`}
      >
        <div className="flex items-center gap-3">
          {verification.valid ? (
            <CheckCircle2 className="text-status-success-text h-9 w-9" />
          ) : (
            <CircleSlash2 className="text-status-error-text h-9 w-9" />
          )}
          <div>
            <p className="text-ink-600 text-xs font-semibold tracking-wider uppercase">
              Verification result
            </p>
            <h1 className="text-ink-950 text-2xl font-bold">{verification.label}</h1>
          </div>
        </div>
      </div>
      <div className="border-border bg-surface mt-4 overflow-hidden rounded-xl border shadow-sm">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="border-border grid grid-cols-[8rem_1fr] gap-3 border-b px-4 py-3 last:border-0"
          >
            <span className="text-ink-500 text-xs font-medium">{label}</span>
            <span className="text-ink-950 text-sm font-medium">{value}</span>
          </div>
        ))}
      </div>
      <p className="text-ink-500 mt-4 flex items-center justify-center gap-2 text-center text-xs">
        <Clock3 className="h-3.5 w-3.5" />
        Live result generated {new Date().toLocaleString('en-NA')}
      </p>
    </VerificationShell>
  );
}

function VerificationShell({
  children,
  branding,
}: {
  children: React.ReactNode;
  branding?: ResolvedTenantBranding | null;
}) {
  return (
    <main className="bg-page min-h-screen px-4 py-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TenantLogo
              src={branding?.logoUrl}
              organisationName={branding?.organisationName || 'GRN Fleet'}
              code={branding?.code}
              className="h-11 w-11"
            />
            <div>
              <p className="text-ink-950 text-sm font-bold">
                {branding?.organisationName || 'GRN Fleet'}
              </p>
              <p className="text-ink-500 text-xs">Official Trip Authority Verification</p>
            </div>
          </div>
          <PublicThemeToggle />
        </div>
        {children}
      </div>
    </main>
  );
}
