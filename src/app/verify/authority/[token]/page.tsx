import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { CheckCircle2, CircleSlash2, Clock3, ShieldCheck } from 'lucide-react';
import { getDb } from '@/db';
import { auditEvents } from '@/db/schema/audit';
import { tripAuthorities, tripAuthorisedDrivers, vehicleAllocations } from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { tenants } from '@/db/schema/tenants';
import { vehicles } from '@/db/schema/fleet';
import { PublicThemeToggle } from '@/components/layout/public-theme-toggle';

export const dynamic = 'force-dynamic';

function publicStatus(status: string, validFrom: Date | null, validUntil: Date | null) {
  const now = new Date();
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
        <div className="rounded-xl border border-status-error-border bg-status-error-bg p-6 text-center">
          <CircleSlash2 className="mx-auto h-10 w-10 text-status-error-text" />
          <h1 className="mt-3 text-xl font-semibold text-ink-950">Authority Not Found</h1>
          <p className="mt-2 text-sm text-ink-600">This verification code is invalid or no longer recognised.</p>
        </div>
      </VerificationShell>
    );
  }

  const verification = publicStatus(authority.status, authority.validFrom, authority.validUntil);
  await db.insert(auditEvents).values({
    tenantId: authority.tenantId!,
    tenantSequence: 0,
    eventType: 'trip_authority_verified',
    actorUserId: 'public-verifier',
    action: 'verify',
    entityType: 'trip_authority',
    entityId: authority.id,
    summary: `${authority.authorityNumber} public verification returned ${verification.label}`,
    sourceChannel: 'public_qr',
  }).catch(() => undefined);

  const rows = [
    ['Trip Authority', authority.authorityNumber ?? 'Pending number'],
    ['Organisation', authority.organisation],
    ['Vehicle', authority.registration],
    ['Authorised driver', [authority.driverFirstName, authority.driverLastName].filter(Boolean).join(' ') || 'Not available'],
    ['Valid from', authority.validFrom?.toLocaleString('en-NA') ?? 'Not set'],
    ['Valid until', authority.validUntil?.toLocaleString('en-NA') ?? 'Not set'],
    ['Route', [authority.origin, authority.destination].filter(Boolean).join(' → ') || 'Approved route on authority'],
    ['Issue date', authority.issuedAt?.toLocaleString('en-NA') ?? 'Not issued'],
    ['Version', `v${authority.version}`],
    ['Last update', authority.updatedAt.toLocaleString('en-NA')],
  ];

  return (
    <VerificationShell>
      <div className={`rounded-xl border p-5 ${verification.valid
        ? 'border-status-success-border bg-status-success-bg'
        : 'border-status-error-border bg-status-error-bg'}`}>
        <div className="flex items-center gap-3">
          {verification.valid
            ? <CheckCircle2 className="h-9 w-9 text-status-success-text" />
            : <CircleSlash2 className="h-9 w-9 text-status-error-text" />}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-600">Verification result</p>
            <h1 className="text-2xl font-bold text-ink-950">{verification.label}</h1>
          </div>
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[8rem_1fr] gap-3 border-b border-border px-4 py-3 last:border-0">
            <span className="text-xs font-medium text-ink-500">{label}</span>
            <span className="text-sm font-medium text-ink-950">{value}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-ink-500">
        <Clock3 className="h-3.5 w-3.5" />
        Live result generated {new Date().toLocaleString('en-NA')}
      </p>
    </VerificationShell>
  );
}

function VerificationShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-page px-4 py-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-700 text-white">
              <ShieldCheck className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-bold text-ink-950">GRN Fleet</p>
              <p className="text-xs text-ink-500">Official Trip Authority Verification</p>
            </div>
          </div>
          <PublicThemeToggle />
        </div>
        {children}
      </div>
    </main>
  );
}
