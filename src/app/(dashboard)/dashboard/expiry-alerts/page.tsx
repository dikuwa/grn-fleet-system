import { and, eq, lte, or } from 'drizzle-orm';
import { getDb, isDbConnected } from '@/db';
import { vehicles } from '@/db/schema/fleet';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, Truck, Shield, AlertTriangle, ChevronRight } from 'lucide-react';
import { getServerSession } from '@/lib/session';
import Link from 'next/link';
import { getSessionRoleNames } from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { vehicleScopeCondition } from '@/lib/record-scope';

function daysUntil(date: string, now: Date): number {
  const target = new Date(`${date}T23:59:59.999Z`);
  return Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
}

async function fetchExpiryAlerts(
  tenantId: string,
  userId: string,
  recordScope: 'self' | 'assigned' | 'related' | 'tenant' | 'platform',
  now: Date,
) {
  const db = getDb();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 86_400_000);
  const cutoff = thirtyDaysFromNow.toISOString().slice(0, 10);

  return db
    .select({
      id: vehicles.id,
      licenceNumber: vehicles.licenceNumber,
      make: vehicles.make,
      model: vehicles.model,
      licenceExpiryDate: vehicles.licenceExpiryDate,
      roadworthyTestDate: vehicles.roadworthyTestDate,
    })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.isActive, true),
        vehicleScopeCondition({ tenantId, userId, recordScope }),
        or(
          lte(vehicles.licenceExpiryDate, cutoff),
          lte(vehicles.roadworthyTestDate, cutoff),
        ),
      ),
    )
    .orderBy(vehicles.licenceExpiryDate);
}

export default async function ExpiryAlertsPage() {
  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Expiry Alerts' }]} />
        <PageHeader title="Expiry Alerts" description="Compliance expiry monitoring for vehicles in your maintenance scope" />
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

  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/expiry-alerts', roleNames);
  const now = new Date();

  let rows: Awaited<ReturnType<typeof fetchExpiryAlerts>>;
  try {
    rows = await fetchExpiryAlerts(
      session.tenantId,
      session.user.id,
      access.recordScope ?? 'related',
      now,
    );
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

  const expiredVehicles = rows.filter((vehicle) =>
    Boolean(
      (vehicle.licenceExpiryDate && daysUntil(vehicle.licenceExpiryDate, now) < 0) ||
      (vehicle.roadworthyTestDate && daysUntil(vehicle.roadworthyTestDate, now) < 0),
    ),
  );
  const expiredIds = new Set(expiredVehicles.map((vehicle) => vehicle.id));
  const expiringVehicles = rows.filter((vehicle) => !expiredIds.has(vehicle.id));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Expiry Alerts' }]} />
      <PageHeader
        title="Expiry Alerts"
        description={`${expiredVehicles.length} expired, ${expiringVehicles.length} expiring soon within vehicles related to your maintenance work`}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-status-error-text text-2xl font-[650] tabular-nums">{expiredVehicles.length}</p>
            <p className="text-ink-500 text-xs">Vehicles With Expired Compliance</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-status-emergency-text text-2xl font-[650] tabular-nums">{expiringVehicles.length}</p>
            <p className="text-ink-500 text-xs">Vehicles Expiring Soon</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" /> Vehicle Compliance Expiry
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="border-border rounded-[8px] border border-dashed p-6 text-center">
              <Shield className="text-status-success-text mx-auto mb-2 h-5 w-5" />
              <p className="text-ink-500 text-sm">No vehicle compliance expiry requires attention in your current maintenance scope.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {[...expiredVehicles, ...expiringVehicles].map((vehicle) => {
                const expired = expiredIds.has(vehicle.id);
                const licenceDays = vehicle.licenceExpiryDate ? daysUntil(vehicle.licenceExpiryDate, now) : null;
                const roadworthyDays = vehicle.roadworthyTestDate ? daysUntil(vehicle.roadworthyTestDate, now) : null;

                return (
                  <Link
                    key={vehicle.id}
                    href={`/dashboard/fleet/${vehicle.id}`}
                    className="border-border hover:border-brand-100 hover:bg-brand-50/20 focus-ring flex min-w-0 items-center justify-between gap-3 rounded-[8px] border p-3 transition-colors"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] ${expired ? 'bg-status-error-bg text-status-error-text' : 'bg-status-emergency-bg text-status-emergency-text'}`}>
                        <AlertTriangle className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-ink-950 truncate text-sm font-medium">{vehicle.make} {vehicle.model}</p>
                        <p className="text-ink-500 text-xs">{vehicle.licenceNumber}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {licenceDays !== null && licenceDays <= 30 && (
                        <Badge variant={licenceDays < 0 ? 'error' : 'emergency'} size="sm">
                          Licence: {licenceDays < 0 ? `Expired ${Math.abs(licenceDays)}d` : `${licenceDays}d`}
                        </Badge>
                      )}
                      {roadworthyDays !== null && roadworthyDays <= 30 && (
                        <Badge variant={roadworthyDays < 0 ? 'error' : 'emergency'} size="sm">
                          Roadworthy: {roadworthyDays < 0 ? `Expired ${Math.abs(roadworthyDays)}d` : `${roadworthyDays}d`}
                        </Badge>
                      )}
                      <ChevronRight className="text-ink-300 h-4 w-4" />
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
