import { getDb, isDbConnected } from '@/db';
import {
  employees,
  departments,
  offices,
  driverProfiles,
  driverLicences,
} from '@/db/schema/people';
import { trips, tripLogEntries } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';

import { eq, desc, and, inArray } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Database,
  ChevronLeft,
  Mail,
  Phone,
  Building2,
  Truck,
  User,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { notFound } from 'next/navigation';
import Link from 'next/link';

interface PageProps {
  params: Promise<{ id: string }>;
}

async function fetchDriverDetail(employeeId: string) {
  const db = getDb();

  const employee = await db
    .select({
      id: employees.id,
      employeeNumber: employees.employeeNumber,
      title: employees.title,
      firstName: employees.firstName,
      lastName: employees.lastName,
      jobTitle: employees.jobTitle,
      email: employees.email,
      phone: employees.phone,
      employmentStatus: employees.employmentStatus,
      isDriver: employees.isDriver,
      tenantId: employees.tenantId,
      departmentName: departments.name,
      officeName: offices.name,
    })
    .from(employees)
    .leftJoin(departments, eq(employees.departmentId, departments.id))
    .leftJoin(offices, eq(employees.officeId, offices.id))
    .where(eq(employees.id, employeeId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!employee || !employee.isDriver) return null;

  const profile = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.employeeId, employee.id))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!profile) return null;

  const licences = await db
    .select()
    .from(driverLicences)
    .where(eq(driverLicences.driverProfileId, profile.id))
    .orderBy(desc(driverLicences.issueDate));

  // Assignment history — find trips where this employee was the driver
  // through trip_log_entries which stores driverEmployeeId
  const driverTripIds = await db
    .select({ tripId: tripLogEntries.tripId })
    .from(tripLogEntries)
    .where(eq(tripLogEntries.driverEmployeeId, employee.id))
    .groupBy(tripLogEntries.tripId);

  const assignmentHistory = driverTripIds.length > 0
    ? await db
        .select({
          id: trips.id,
          status: trips.status,
          startedAt: trips.startedAt,
          returnedAt: trips.returnedAt,
          createdAt: trips.createdAt,
          make: vehicles.make,
          model: vehicles.model,
          licenceNumber: vehicles.licenceNumber,
          requestReference: transportRequests.reference,
          requestPurpose: transportRequests.purpose,
        })
        .from(trips)
        .leftJoin(vehicles, eq(trips.vehicleId, vehicles.id))
        .leftJoin(transportRequests, eq(trips.requestId, transportRequests.id))
        .where(
          and(
            inArray(trips.id, driverTripIds.map((d) => d.tripId)),
            eq(trips.tenantId, employee.tenantId),
          ),
        )
        .orderBy(desc(trips.createdAt))
        .limit(20)
    : [];

  return { employee, profile, licences, assignmentHistory };
}

export const dynamic = 'force-dynamic';

export default async function DriverDetailPage({ params }: PageProps) {
  const { id } = await params;

  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <PageHeader title="Driver Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <PageHeader title="Driver Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof fetchDriverDetail>>;
  try {
    data = await fetchDriverDetail(id);
  } catch (error) {
    console.error('Driver detail query failed:', error);
    return (
      <div className="space-y-6">
        <PageHeader title="Driver Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Driver" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Driver Detail" />
        <EmptyState icon={<User className="h-8 w-8" />} title="Driver Not Found" description="The requested driver record could not be found or the employee is not registered as a driver." />
      </div>
    );
  }

  const { employee, profile, licences, assignmentHistory } = data;

  const activeLicences = licences.filter(
    (l) => l.verificationStatus === 'verified' && l.expiryDate && new Date(l.expiryDate) > new Date(),
  );
  const expiringLicences = licences.filter(
    (l) => l.expiryDate && new Date(l.expiryDate) > new Date() && new Date(l.expiryDate) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  );
  const expiredLicences = licences.filter(
    (l) => l.expiryDate && new Date(l.expiryDate) <= new Date(),
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Drivers', href: '/dashboard/drivers' },
          { label: `${employee.firstName} ${employee.lastName}` },
        ]}
      />
      <PageHeader title="Driver Detail" description="Driver profile, licences, and assignment history">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/dashboard/staff/${id}`}><User className="h-4 w-4" /> Full Profile</Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/drivers"><ChevronLeft className="h-4 w-4" /> Back to Drivers</Link>
          </Button>
        </div>
      </PageHeader>

      {/* Profile Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-brand-50 text-2xl font-bold text-brand-800">
              {employee.firstName.charAt(0)}{employee.lastName.charAt(0)}
            </div>
            <div className="flex-1 text-center sm:text-left">
              <h2 className="text-lg font-semibold text-ink-950">
                {employee.title && `${employee.title} `}{employee.firstName} {employee.lastName}
              </h2>
              <p className="mt-1 text-sm text-ink-500">{employee.jobTitle}</p>
              <div className="mt-3 flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <Badge variant={profile.driverStatus === 'authorised' ? 'success' : 'error'} size="sm">
                  {profile.driverStatus === 'authorised' ? 'Authorised' : 'Suspended'}
                </Badge>
                <StatusBadge status={employee.employmentStatus === 'active' ? 'success' : 'pending'} label={employee.employmentStatus} />
                <Badge variant="info" size="sm">Emp #{employee.employeeNumber}</Badge>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-1 text-xs text-ink-500">
                {employee.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{employee.email}</span>}
                {employee.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{employee.phone}</span>}
                {employee.departmentName && <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{employee.departmentName}</span>}
                {employee.officeName && <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{employee.officeName}</span>}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{licences.length}</p><p className="text-xs text-ink-500">Total Licences</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-success-text">{activeLicences.length}</p><p className="text-xs text-ink-500">Active</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-pending-text">{expiringLicences.length}</p><p className="text-xs text-ink-500">Expiring ≤30d</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-error-text">{expiredLicences.length}</p><p className="text-xs text-ink-500">Expired</p></CardContent></Card>
      </div>

      {/* Driver Profile */}
      <Card>
        <CardHeader><CardTitle>Driver Status</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-ink-500">Authorisation Status</p>
              <StatusBadge status={profile.driverStatus === 'authorised' ? 'success' : 'error'} label={profile.driverStatus} />
            </div>
            <div>
              <p className="text-xs text-ink-500">Internal Auth Ref</p>
              <p className="text-sm text-ink-700">{profile.internalAuthorisationRef || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Internal Notes</p>
              <p className="text-sm text-ink-700">{profile.notes || '—'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Driver Licences */}
      <Card>
        <CardHeader>
          <CardTitle>Driver Licences</CardTitle>
          <Badge variant="info">{licences.length} record{licences.length !== 1 ? 's' : ''}</Badge>
        </CardHeader>
        <CardContent>
          {licences.length === 0 ? (
            <p className="text-sm text-ink-500">No licence records found for this driver.</p>
          ) : (
            <div className="divide-y divide-border">
              {licences.map((licence) => {
                const isExpired = licence.expiryDate && new Date(licence.expiryDate) <= new Date();
                const isExpiring = licence.expiryDate && new Date(licence.expiryDate) > new Date() && new Date(licence.expiryDate) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                const status = isExpired ? 'error' : isExpiring ? 'pending' : licence.verificationStatus === 'verified' ? 'success' : 'pending';
                const statusLabel = isExpired ? 'Expired' : isExpiring ? 'Expiring Soon' : licence.verificationStatus.charAt(0).toUpperCase() + licence.verificationStatus.slice(1);
                return (
                  <div key={licence.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-ink-950">Class {licence.licenceClass} — {licence.licenceNumber}</p>
                      <p className="text-xs text-ink-500">
                        Issued {formatDate(licence.issueDate)} · Expires {formatDate(licence.expiryDate)}
                        {licence.allowedVehicleCategories && ` · ${licence.allowedVehicleCategories}`}
                      </p>
                    </div>
                    <StatusBadge status={status} label={statusLabel} />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assignment History */}
      <Card>
        <CardHeader>
          <CardTitle>Assignment History</CardTitle>
          <Badge variant="default">{assignmentHistory.length} trip{assignmentHistory.length !== 1 ? 's' : ''}</Badge>
        </CardHeader>
        <CardContent>
          {assignmentHistory.length === 0 ? (
            <p className="text-sm text-ink-500">No trip assignments found for this driver.</p>
          ) : (
            <div className="divide-y divide-border">
              {assignmentHistory.map((trip) => {
                const tripStatusLabel = trip.status?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                return (
                  <Link key={trip.id} href={`/dashboard/trips/${trip.id}`} className="flex items-center justify-between py-3 first:pt-0 last:pb-0 hover:bg-muted/50 -mx-4 px-4 rounded-[8px] transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-brand-50 text-brand-700">
                        <Truck className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-ink-950">
                          {trip.make} {trip.model} <span className="font-normal text-ink-500">({trip.licenceNumber})</span>
                        </p>
                        <p className="text-xs text-ink-500">
                          {trip.requestReference && <>{trip.requestReference} · </>}
                          {trip.startedAt ? formatDate(trip.startedAt) : formatDate(trip.createdAt)}
                          {trip.requestPurpose && <> · {trip.requestPurpose}</>}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <Badge variant={trip.status === 'closed' ? 'success' : trip.status === 'in_progress' ? 'info' : 'pending'} size="sm">{tripStatusLabel}</Badge>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
