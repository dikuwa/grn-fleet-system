import QRCode from 'qrcode';
import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import {
  tripAuthorities,
  tripAuthorityPassengers,
  tripAuthorisedDrivers,
  vehicleAllocations,
} from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { vehicles } from '@/db/schema/fleet';
import { tenants, tenantBranding } from '@/db/schema/tenants';
import { requestRoutes } from '@/db/schema/requests';
import { requireAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { Card, CardContent } from '@/components/ui/card';
import { AuthorityActions } from './AuthorityActions';
import { TenantLogo } from '@/components/documents/tenant-logo';
import { RouteMapWrapper } from '@/app/(dashboard)/dashboard/requests/[id]/route-map-wrapper';

export default async function AuthorityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAuth();
  const permission = await requirePermission(session, Permissions.TRIP_VIEW);
  if (permission !== true) notFound();
  const db = getDb();
  const [authority] = await db
    .select({
      id: tripAuthorities.id,
      number: tripAuthorities.authorityNumber,
      status: tripAuthorities.status,
      version: tripAuthorities.version,
      validFrom: tripAuthorities.validFrom,
      validUntil: tripAuthorities.validUntil,
      purpose: tripAuthorities.purpose,
      origin: tripAuthorities.origin,
      destination: tripAuthorities.destination,
      route: tripAuthorities.approvedRoute,
      specialConditions: tripAuthorities.specialConditions,
      beginningOdometer: tripAuthorities.beginningOdometer,
      endingOdometer: tripAuthorities.endingOdometer,
      issuedAt: tripAuthorities.issuedAt,
      authorisedAt: tripAuthorities.authorisedAt,
      authoriserSnapshot: tripAuthorities.authoriserSnapshot,
      data: tripAuthorities.data,
      organisation: tenants.name,
      organisationCode: tenants.code,
      address: tenantBranding.address,
      contactPhone: tenantBranding.contactPhone,
      logoUrl: tenantBranding.logoUrl,
      registration: vehicles.licenceNumber,
      registerNumber: vehicles.vehicleRegisterNumber,
      make: vehicles.make,
      model: vehicles.model,
      colour: vehicles.colour,
      fuelType: vehicles.fuelType,
      capacity: vehicles.seatedCapacity,
      licenceExpiry: vehicles.licenceExpiryDate,
      requestId: tripAuthorities.requestId,
    })
    .from(tripAuthorities)
    .innerJoin(tenants, eq(tenants.id, tripAuthorities.tenantId))
    .leftJoin(tenantBranding, eq(tenantBranding.tenantId, tenants.id))
    .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, tripAuthorities.allocationId))
    .innerJoin(vehicles, eq(vehicles.id, vehicleAllocations.vehicleId))
    .where(and(eq(tripAuthorities.tripId, id), eq(tripAuthorities.tenantId, session.tenantId)))
    .limit(1);
  if (!authority) notFound();

  const [passengers, drivers, routes] = await Promise.all([
    db
      .select()
      .from(tripAuthorityPassengers)
      .where(eq(tripAuthorityPassengers.authorityId, authority.id)),
    db
      .select({
        id: tripAuthorisedDrivers.id,
        driverType: tripAuthorisedDrivers.driverType,
        employeeNumber: tripAuthorisedDrivers.employeeNumber,
        licenceNumber: tripAuthorisedDrivers.licenceNumberMasked,
        licenceClass: tripAuthorisedDrivers.licenceClass,
        licenceExpiry: tripAuthorisedDrivers.licenceExpiry,
        firstName: employees.firstName,
        lastName: employees.lastName,
        jobTitle: employees.jobTitle,
      })
      .from(tripAuthorisedDrivers)
      .innerJoin(employees, eq(employees.id, tripAuthorisedDrivers.employeeId))
      .where(eq(tripAuthorisedDrivers.authorityId, authority.id)),
    db
      .select()
      .from(requestRoutes)
      .where(eq(requestRoutes.requestId, authority.requestId))
      .orderBy(requestRoutes.createdAt),
  ]);

  const token = (authority.data as { verificationToken?: string } | null)?.verificationToken;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const verificationUrl = token
    ? `${baseUrl}/verify/authority/${encodeURIComponent(token)}`
    : undefined;
  const qr = verificationUrl
    ? await QRCode.toDataURL(verificationUrl, { width: 260, margin: 1 })
    : null;
  const primaryDriver = drivers.find((driver) => driver.driverType === 'primary');
  const distance =
    authority.beginningOdometer !== null && authority.endingOdometer !== null
      ? authority.endingOdometer - authority.beginningOdometer
      : null;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <p className="text-brand-700 text-xs font-semibold tracking-wider uppercase">
            Present Authority
          </p>
          <h1 className="text-ink-950 text-2xl font-bold">{authority.number}</h1>
        </div>
        <AuthorityActions tripId={id} verificationUrl={verificationUrl} />
      </div>

      <Card className="border-brand-800 overflow-hidden border-2 bg-white text-slate-950 dark:bg-white dark:text-slate-950">
        <CardContent className="p-0">
          <header className="border-brand-800 border-b-4 px-5 py-5 text-center sm:px-8">
            <div className="flex items-start justify-between gap-4">
              <TenantLogo
                src={authority.logoUrl}
                organisationName={authority.organisation}
                code={authority.organisationCode}
                className="h-14 w-14"
              />
              <div>
                <p className="text-sm font-bold tracking-widest uppercase">Republic of Namibia</p>
                <h2 className="mt-1 text-xl font-bold">{authority.organisation}</h2>
                <p className="text-brand-900 mt-2 text-lg font-black uppercase">
                  Official Vehicle Trip Authority
                </p>
              </div>
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt="Secure authority verification QR code" className="h-24 w-24" />
              ) : (
                <div className="h-20 w-20 rounded border border-slate-300" />
              )}
            </div>
          </header>

          <div className="grid gap-0 border-b border-slate-300 sm:grid-cols-3">
            <OfficialField label="Authority number" value={authority.number || 'Pending'} strong />
            <OfficialField label="Status" value={authority.status.replaceAll('_', ' ')} />
            <OfficialField
              label="Version / issued"
              value={`v${authority.version} · ${authority.issuedAt?.toLocaleDateString('en-NA') ?? 'Pending'}`}
            />
          </div>

          <section className="p-5 sm:p-8">
            <SectionTitle>Authority and route</SectionTitle>
            <div className="grid border border-slate-300 sm:grid-cols-2">
              <OfficialField
                label="Valid from"
                value={authority.validFrom?.toLocaleString('en-NA') ?? 'Not set'}
              />
              <OfficialField
                label="Valid until"
                value={authority.validUntil?.toLocaleString('en-NA') ?? 'Not set'}
              />
              <OfficialField label="Origin" value={authority.origin || 'Not set'} />
              <OfficialField label="Destination" value={authority.destination || 'Not set'} />
              <OfficialField
                label="Purpose of official duty"
                value={authority.purpose || 'Not set'}
                wide
              />
              <OfficialField label="Approved route" value={authority.route || 'Not set'} wide />
            </div>

            <SectionTitle>Official vehicle</SectionTitle>
            <div className="grid border border-slate-300 sm:grid-cols-3">
              <OfficialField label="Registration" value={authority.registration} strong />
              <OfficialField label="Register number" value={authority.registerNumber || '—'} />
              <OfficialField label="Make / model" value={`${authority.make} ${authority.model}`} />
              <OfficialField
                label="Colour / fuel"
                value={`${authority.colour || '—'} · ${authority.fuelType}`}
              />
              <OfficialField label="Usable seating" value={String(authority.capacity ?? '—')} />
              <OfficialField label="Licence expiry" value={authority.licenceExpiry || '—'} />
            </div>

            <SectionTitle>Authorised driver</SectionTitle>
            <div className="grid border border-slate-300 sm:grid-cols-3">
              <OfficialField
                label="Full name"
                value={
                  primaryDriver
                    ? `${primaryDriver.firstName} ${primaryDriver.lastName}`
                    : 'Not assigned'
                }
                strong
              />
              <OfficialField label="Employee number" value={primaryDriver?.employeeNumber || '—'} />
              <OfficialField label="Designation" value={primaryDriver?.jobTitle || '—'} />
              <OfficialField
                label="Licence"
                value={
                  primaryDriver
                    ? `${primaryDriver.licenceNumber} · ${primaryDriver.licenceClass}`
                    : '—'
                }
              />
              <OfficialField
                label="Licence expiry"
                value={primaryDriver?.licenceExpiry?.toLocaleDateString('en-NA') || '—'}
              />
              <OfficialField
                label="Acceptance"
                value={
                  authority.status === 'awaiting_driver_acceptance'
                    ? 'Awaiting driver'
                    : 'Digitally recorded'
                }
              />
            </div>

            {/* Route map — surfaced from the mapped routes on the approved request */}
            {routes.length > 0 && (
              <>
                <SectionTitle>Route map</SectionTitle>
                <div className="overflow-hidden rounded-[8px] border border-slate-300 print:hidden">
                  <RouteMapWrapper routes={routes.map((r) => ({
                    id: r.id,
                    originName: r.originName,
                    destinationName: r.destinationName,
                    originCoordinates: r.originCoordinates as { lat: number; lng: number } | null,
                    destinationCoordinates: r.destinationCoordinates as { lat: number; lng: number } | null,
                    routePolyline: r.routePolyline,
                    mappedDistanceKm: r.mappedDistanceKm,
                    mappedDurationMinutes: r.mappedDurationMinutes,
                    totalKilometres: r.totalKilometres,
                  }))} />
                </div>
                <div className="grid border border-slate-300 sm:grid-cols-3 print:hidden">
                  {routes.map((route, index) => (
                    <OfficialField
                      key={route.id}
                      label={`Route ${index + 1}`}
                      value={`${route.originName || 'Origin'} → ${route.destinationName || 'Destination'}`}
                      strong={index === 0}
                      wide
                    />
                  ))}
                  <OfficialField
                    label="Approved route distance"
                    value={formatRouteDistance(routes)}
                    wide
                  />
                </div>
              </>
            )}

            <SectionTitle>Odometer and conditions</SectionTitle>
            <div className="grid border border-slate-300 sm:grid-cols-3">
              <OfficialField
                label="Beginning odometer"
                value={authority.beginningOdometer?.toLocaleString() ?? 'Pending'}
              />
              <OfficialField
                label="Ending odometer"
                value={authority.endingOdometer?.toLocaleString() ?? 'Pending'}
              />
              <OfficialField
                label="Calculated distance"
                value={distance === null ? 'Pending' : `${distance.toLocaleString()} km`}
              />
              <OfficialField
                label="Special conditions"
                value={authority.specialConditions || 'None recorded'}
                wide
              />
            </div>

            <SectionTitle>Approved passenger manifest ({passengers.length})</SectionTitle>
            <div className="overflow-hidden border border-slate-300">
              {passengers.length ? (
                passengers.map((passenger, index) => (
                  <div
                    key={passenger.id}
                    className="grid grid-cols-[2rem_1fr_8rem] border-b border-slate-200 px-3 py-2 text-sm last:border-0"
                  >
                    <span>{index + 1}.</span>
                    <span className="font-medium">{passenger.fullName}</span>
                    <span className="capitalize">
                      {passenger.passengerType.replaceAll('_', ' ')}
                    </span>
                  </div>
                ))
              ) : (
                <p className="p-3 text-sm">No passengers authorised.</p>
              )}
            </div>

            <div className="mt-6 grid gap-4 border-t-2 border-slate-800 pt-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-slate-500 uppercase">Authorising officer</p>
                <p className="mt-1 text-sm font-semibold">
                  {authority.authorisedAt
                    ? 'Digitally authorised'
                    : 'Approval captured in workflow'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase">Verification</p>
                <p className="mt-1 text-xs break-all">
                  {verificationUrl || 'Secure verification unavailable for migrated record'}
                </p>
              </div>
            </div>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}

function formatRouteDistance(
  routes: Array<{ totalKilometres: number | null; mappedDistanceKm: number | null }>,
): string {
  const total = routes.reduce((sum, r) => sum + (r.totalKilometres || r.mappedDistanceKm || 0), 0);
  if (total <= 0) return 'Not calculated';
  return `${total.toLocaleString()} km`;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="border-brand-800 text-brand-900 mt-6 mb-2 border-b-2 pb-1 text-sm font-bold tracking-wide uppercase first:mt-0">
      {children}
    </h3>
  );
}

function OfficialField({
  label,
  value,
  strong,
  wide,
}: {
  label: string;
  value: string;
  strong?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={`border-r border-b border-slate-300 px-3 py-2 ${wide ? 'sm:col-span-full' : ''}`}
    >
      <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">{label}</p>
      <p className={`mt-1 text-sm capitalize ${strong ? 'font-bold' : 'font-medium'}`}>{value}</p>
    </div>
  );
}
