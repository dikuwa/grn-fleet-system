import { getDb, isDbConnected } from '@/db';
import { vehicles } from '@/db/schema/fleet';
import { employees, driverProfiles, driverLicences } from '@/db/schema/people';
import { eq, and, asc, lte, or, sql } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Database, CalendarClock, Truck, User, Shield, AlertTriangle, ChevronRight,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import Link from 'next/link';

const today = new Date();
const thirtyDaysFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

function daysUntil(date: string): number {
  const d = new Date(date);
  return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function isExpired(date: string): boolean {
  return new Date(date) < today;
}

async function fetchExpiryAlerts(tenantId: string) {
  const db = getDb();

  const thirtyDaysFromNowStr = thirtyDaysFromNow.toISOString().split('T')[0];

  const [vehicleExpiryRows, driverLicenceRows] = await Promise.all([
    // Vehicle licence & roadworthy expiry
    db
      .select({
        id: vehicles.id,
        licenceNumber: vehicles.licenceNumber,
        make: vehicles.make,
        model: vehicles.model,
        isActive: vehicles.isActive,
        licenceExpiryDate: vehicles.licenceExpiryDate,
        roadworthyTestDate: vehicles.roadworthyTestDate,
      })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.tenantId, tenantId),
          eq(vehicles.isActive, true),
          or(
            lte(vehicles.licenceExpiryDate, thirtyDaysFromNowStr),
            lte(vehicles.roadworthyTestDate, thirtyDaysFromNowStr),
          ),
        ),
      )
      .orderBy(vehicles.licenceExpiryDate),
    // Driver licence expiry
    db
      .select({
        id: driverLicences.id,
        employeeId: employees.id,
        employeeNumber: employees.employeeNumber,
        firstName: employees.firstName,
        lastName: employees.lastName,
        licenceNumber: driverLicences.licenceNumber,
        licenceClass: driverLicences.licenceClass,
        expiryDate: driverLicences.expiryDate,
        verificationStatus: driverLicences.verificationStatus,
      })
      .from(driverLicences)
      .innerJoin(driverProfiles, eq(driverLicences.driverProfileId, driverProfiles.id))
      .innerJoin(employees, eq(driverProfiles.employeeId, employees.id))
      .where(
        and(
          eq(employees.tenantId, tenantId),
          eq(employees.isDriver, true),
          eq(employees.employmentStatus, 'active'),
          lte(driverLicences.expiryDate, thirtyDaysFromNowStr),
        ),
      )
      .orderBy(asc(driverLicences.expiryDate)),
  ]);

  return { vehicleExpiryRows, driverLicenceRows };
}

export default async function ExpiryAlertsPage() {
  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Expiry Alerts' }]} />
        <PageHeader title="Expiry Alerts" description="Vehicle and driver licence expiry monitoring" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Expiry Alerts' }]} />
        <PageHeader title="Expiry Alerts" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof fetchExpiryAlerts>>;
  try {
    data = await fetchExpiryAlerts(session.tenantId);
  } catch (error) {
    console.error('Expiry alerts query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Expiry Alerts' }]} />
        <PageHeader title="Expiry Alerts" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Expiry Data" />
      </div>
    );
  }

  const expiredVehicles = data.vehicleExpiryRows.filter((v) =>
    (v.licenceExpiryDate && isExpired(v.licenceExpiryDate)) ||
    (v.roadworthyTestDate && isExpired(v.roadworthyTestDate)),
  );
  const expiringVehicles = data.vehicleExpiryRows.filter((v) => !expiredVehicles.find((e) => e.id === v.id));

  const expiredDriverLicences = data.driverLicenceRows.filter((l) => isExpired(l.expiryDate));
  const expiringDriverLicences = data.driverLicenceRows.filter((l) => !expiredDriverLicences.find((e) => e.id === l.id));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Expiry Alerts' }]} />
      <PageHeader
        title="Expiry Alerts"
        description={`${expiredVehicles.length + expiredDriverLicences.length} expired, ${expiringVehicles.length + expiringDriverLicences.length} expiring soon`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/fleet/compliance"><Shield className="h-4 w-4" /> Vehicle Compliance</Link>
        </Button>
      </PageHeader>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-error-text">{expiredVehicles.length}</p>
            <p className="text-xs text-ink-500">Vehicle Expired</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-emergency-text">{expiringVehicles.length}</p>
            <p className="text-xs text-ink-500">Vehicle Expiring Soon</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-error-text">{expiredDriverLicences.length}</p>
            <p className="text-xs text-ink-500">Driver Licences Expired</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-emergency-text">{expiringDriverLicences.length}</p>
            <p className="text-xs text-ink-500">Driver Licences Expiring</p>
          </CardContent>
        </Card>
      </div>

      {/* Vehicle Expiry Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" /> Vehicle Compliance Expiry
          </CardTitle>
        </CardHeader>
        <CardContent>
          {expiredVehicles.length === 0 && expiringVehicles.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-border p-6 text-center">
              <Shield className="mx-auto mb-2 h-5 w-5 text-status-success-text" />
              <p className="text-sm text-ink-500">All vehicle licences and roadworthy certificates are up to date.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {[...expiredVehicles, ...expiringVehicles].map((v) => {
                const isExp = expiredVehicles.find((e) => e.id === v.id);
                const licenceDays = v.licenceExpiryDate ? daysUntil(v.licenceExpiryDate) : null;
                const roadworthyDays = v.roadworthyTestDate ? daysUntil(v.roadworthyTestDate) : null;
                return (
                  <Link
                    key={v.id}
                    href={`/dashboard/fleet/${v.id}`}
                    className="flex items-center justify-between rounded-[8px] border border-border p-3 transition-colors hover:border-brand-100 hover:bg-brand-50/20"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] ${isExp ? 'bg-status-error-bg text-status-error-text' : 'bg-status-emergency-bg text-status-emergency-text'}`}>
                        <AlertTriangle className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-950">{v.make} {v.model}</p>
                        <p className="text-xs text-ink-500">{v.licenceNumber}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {licenceDays != null && (
                        <Badge variant={isExp ? 'error' : (licenceDays <= 0 ? 'error' : 'emergency')} size="sm">
                          Licence: {isExp ? 'Expired' : `${licenceDays}d`}
                        </Badge>
                      )}
                      {roadworthyDays != null && (
                        <Badge variant={isExp ? 'error' : (roadworthyDays <= 0 ? 'error' : 'emergency')} size="sm">
                          Roadworthy: {isExp ? 'Expired' : `${roadworthyDays}d`}
                        </Badge>
                      )}
                      <ChevronRight className="h-4 w-4 text-ink-300" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Driver Licence Expiry Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" /> Driver Licence Expiry
          </CardTitle>
        </CardHeader>
        <CardContent>
          {expiredDriverLicences.length === 0 && expiringDriverLicences.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-border p-6 text-center">
              <Shield className="mx-auto mb-2 h-5 w-5 text-status-success-text" />
              <p className="text-sm text-ink-500">All driver licences are up to date.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {[...expiredDriverLicences, ...expiringDriverLicences].map((l) => {
                const isExp = expiredDriverLicences.find((e) => e.id === l.id);
                const days = daysUntil(l.expiryDate);
                return (
                  <Link
                    key={l.id}
                    href={`/dashboard/drivers/${l.employeeId}`}
                    className="flex items-center justify-between rounded-[8px] border border-border p-3 transition-colors hover:border-brand-100 hover:bg-brand-50/20"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] ${isExp ? 'bg-status-error-bg text-status-error-text' : 'bg-status-emergency-bg text-status-emergency-text'}`}>
                        <User className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-950">{l.firstName} {l.lastName}</p>
                        <p className="text-xs text-ink-500">{l.licenceNumber} · Class {l.licenceClass}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant={isExp ? 'error' : 'emergency'} size="sm">
                        {isExp ? `Expired ${Math.abs(days)}d ago` : `${days}d remaining`}
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-ink-300" />
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
