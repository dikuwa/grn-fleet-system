'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTabs } from '@/components/ui/page-tabs';
import { formatDate } from '@/lib/utils';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  ChevronRight,
  ClipboardCheck,
  Fuel,
  Gauge,
  IdCard,
  Loader2,
  PenSquare,
  RefreshCw,
  Shield,
  User,
  X,
} from 'lucide-react';
import { LicenceUploadPanel } from '@/app/(dashboard)/dashboard/staff/[id]/LicenceUploadPanel';
import { fetchWithRetry } from '@/lib/fetch-with-retry';

interface DriverInfo {
  id: string;
  employeeId: string;
  driverStatus: string;
  internalAuthorisationRef: string | null;
  notes: string | null;
  employee: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    jobTitle: string | null;
    employeeNumber: string;
  };
  licences: Array<{
    id: string;
    licenceNumber: string;
    licenceClass: string;
    issueDate: string;
    expiryDate: string;
    allowedVehicleCategories: string | null;
    verificationStatus: string;
  }>;
}

interface DriverTrip {
  id: string;
  status: string;
  vehicleLicence: string | null;
  startAt: string | null;
  purpose: string | null;
  reference?: string;
  hasDepartureInspection: boolean;
  hasReturnInspection: boolean;
}

interface DriverNotification {
  id: string;
  title: string;
  body: string | null;
  createdAt: string;
  isRead: boolean;
  type: string;
}

type DriverTab = 'overview' | 'licences' | 'trips';

function titleCase(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function DriverSelfServicePage() {
  const [licenceClock] = useState(() => Date.now());
  const [driverInfo, setDriverInfo] = useState<DriverInfo | null>(null);
  const [trips, setTrips] = useState<DriverTrip[]>([]);
  const [notifications, setNotifications] = useState<DriverNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DriverTab>('overview');
  const [expiryAlerts, setExpiryAlerts] = useState<string[]>([]);
  const fetched = useRef(false);
  const expiryCheckDone = useRef(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [driverRes, tripsRes, notifRes] = await Promise.all([
        fetchWithRetry('/api/drivers/me').catch(() => null),
        fetchWithRetry('/api/trips?driver_assigned=true&limit=10'),
        fetchWithRetry('/api/notifications?limit=5'),
      ]);

      if (driverRes?.ok) {
        const driverJson = await driverRes.json();
        setDriverInfo(driverJson.driver || driverJson.data || null);
      }

      if (tripsRes.ok) {
        const tripsJson = await tripsRes.json();
        const tripsList =
          tripsJson.trips || tripsJson.data?.trips || tripsJson.rows || tripsJson.data || [];
        setTrips(Array.isArray(tripsList) ? tripsList : []);
      }

      if (notifRes.ok) {
        const notifJson = await notifRes.json();
        const notifList =
          notifJson.notifications || notifJson.data?.notifications || notifJson.rows || [];
        setNotifications(Array.isArray(notifList) ? notifList : []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!driverInfo || expiryCheckDone.current) return;
    expiryCheckDone.current = true;
    const now = new Date();
    const alerts: string[] = [];
    for (const licence of driverInfo.licences) {
      const expiry = new Date(licence.expiryDate);
      const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysLeft <= 0) {
        alerts.push(
          `Licence ${licence.licenceClass} (${licence.licenceNumber.slice(-4)}) expired on ${formatDate(licence.expiryDate)}`,
        );
      } else if (daysLeft <= 30) {
        alerts.push(
          `Licence ${licence.licenceClass} (${licence.licenceNumber.slice(-4)}) expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${formatDate(licence.expiryDate)})`,
        );
      }
    }
    setExpiryAlerts(alerts);
  }, [driverInfo]);

  const statusVariant = useCallback(
    (status: string): 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency' => {
      switch (status) {
        case 'in_progress':
        case 'closed':
        case 'completed':
          return 'success';
        case 'returned':
          return 'info';
        case 'cancelled':
          return 'cancelled';
        case 'pending':
        case 'issued':
        default:
          return 'pending';
      }
    },
    [],
  );

  const activeTrips = useMemo(
    () => trips.filter((trip) => ['pending', 'in_progress', 'issued'].includes(trip.status)),
    [trips],
  );

  const hasExpiredLicence = expiryAlerts.some((alert) => alert.includes('expired'));
  const tabs: Array<{ id: DriverTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'licences', label: 'Licences' },
    { id: 'trips', label: 'Trips' },
  ];
  const quickActions = [
    {
      href: '/dashboard/logs',
      label: 'Daily Log',
      detail: 'Odometer and trip activity',
      icon: PenSquare,
    },
    {
      href: '/dashboard/fuel/new',
      label: 'Fuel Entry',
      detail: 'Record an assigned-trip fuel stop',
      icon: Fuel,
    },
    {
      href: '/dashboard/trips',
      label: 'Assigned Trips',
      detail: 'Open your current journeys',
      icon: Gauge,
    },
    {
      href: '/dashboard/inspections',
      label: 'Inspection History',
      detail: 'View official inspection records',
      icon: ClipboardCheck,
    },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Driver Self-Service' }]}
      />
      <PageHeader
        title="Driver Self-Service"
        description="Your driver profile, licence renewals, assigned trips and alerts"
      >
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void fetchData()}
          loading={loading}
          aria-label="Refresh driver self-service"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      </PageHeader>

      {loading ? (
        <div
          className="text-ink-500 flex items-center justify-center gap-2 py-16 text-sm"
          role="status"
        >
          <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Loading driver information…
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-16" role="alert">
          <AlertTriangle className="text-status-error-text h-8 w-8" aria-hidden="true" />
          <p className="text-ink-500 text-sm">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => void fetchData()}>
            Retry
          </Button>
        </div>
      ) : !driverInfo ? (
        <EmptyState
          icon={<User className="h-8 w-8" />}
          title="No driver profile found"
          description="Your employee account may not have a driver profile assigned. Contact your Transport Administrator."
        />
      ) : (
        <>
          {expiryAlerts.length > 0 && (
            <div
              className={`rounded-[8px] border p-4 ${hasExpiredLicence ? 'border-status-error-border bg-status-error-bg' : 'border-status-warning-text/20 bg-status-warning-bg'}`}
              role="alert"
            >
              <div className="flex items-start gap-3">
                <AlertCircle
                  className={`mt-0.5 h-5 w-5 shrink-0 ${hasExpiredLicence ? 'text-status-error-text' : 'text-status-warning-text'}`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-medium ${hasExpiredLicence ? 'text-status-error-text' : 'text-status-warning-text'}`}
                  >
                    Driving licence{expiryAlerts.length > 1 ? 's' : ''} need attention
                  </p>
                  <ul
                    className={`mt-1 space-y-1 text-xs ${hasExpiredLicence ? 'text-status-error-text' : 'text-status-warning-text'}`}
                  >
                    {expiryAlerts.map((alert) => (
                      <li key={alert}>{alert}</li>
                    ))}
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => setExpiryAlerts([])}
                  className="focus-ring text-ink-400 hover:bg-muted hover:text-ink-700 flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] transition-colors motion-reduce:transition-none"
                  aria-label="Dismiss licence alert"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(250px,0.8fr)_minmax(0,2fr)]">
            <aside className="space-y-5">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center">
                    <div className="bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300 mx-auto flex h-16 w-16 items-center justify-center rounded-[12px] text-xl font-semibold">
                      {driverInfo.employee.firstName[0]}
                      {driverInfo.employee.lastName[0]}
                    </div>
                    <h2 className="text-ink-950 mt-3 text-base font-semibold">
                      {driverInfo.employee.firstName} {driverInfo.employee.lastName}
                    </h2>
                    <p className="text-ink-500 text-sm">
                      {driverInfo.employee.jobTitle || 'Driver'}
                    </p>
                    <div className="mt-3">
                      <StatusBadge
                        status={
                          driverInfo.driverStatus === 'authorised'
                            ? 'success'
                            : driverInfo.driverStatus === 'suspended'
                              ? 'error'
                              : 'pending'
                        }
                        label={titleCase(driverInfo.driverStatus)}
                      />
                    </div>
                  </div>
                  <dl className="border-border mt-5 space-y-2 border-t pt-4 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-ink-500">Employee #</dt>
                      <dd className="text-ink-950 font-medium tabular-nums">
                        {driverInfo.employee.employeeNumber}
                      </dd>
                    </div>
                    {driverInfo.employee.email && (
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-ink-500">Email</dt>
                        <dd className="text-ink-950 overflow-wrap-anywhere text-xs">
                          {driverInfo.employee.email}
                        </dd>
                      </div>
                    )}
                    {driverInfo.employee.phone && (
                      <div className="flex items-start justify-between gap-3">
                        <dt className="text-ink-500">Phone</dt>
                        <dd className="text-ink-950">{driverInfo.employee.phone}</dd>
                      </div>
                    )}
                  </dl>
                </CardContent>
              </Card>

              <section aria-labelledby="driver-quick-actions">
                <h2 id="driver-quick-actions" className="text-ink-950 mb-2 text-sm font-semibold">
                  Driver actions
                </h2>
                <div className="border-border overflow-hidden rounded-[10px] border">
                  {quickActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <Link
                        key={action.href}
                        href={action.href}
                        prefetch
                        className="focus-ring border-border bg-surface hover:bg-muted/40 group flex items-center gap-3 border-b p-3.5 transition-colors last:border-b-0 motion-reduce:transition-none"
                      >
                        <Icon className="text-brand-700 h-5 w-5 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="text-ink-900 block text-sm font-medium">
                            {action.label}
                          </span>
                          <span className="text-ink-500 block text-xs">{action.detail}</span>
                        </span>
                        <ChevronRight
                          className="text-ink-300 group-hover:text-brand-700 h-4 w-4"
                          aria-hidden="true"
                        />
                      </Link>
                    );
                  })}
                </div>
                <p className="text-ink-400 mt-2 text-xs">
                  Official departure and return inspections are performed by authorised inspection
                  or transport staff. Drivers can view completed inspection records here.
                </p>
              </section>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="h-4 w-4" aria-hidden="true" />
                    Recent Alerts
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {notifications.length === 0 ? (
                    <div className="text-ink-500 px-5 pb-4 text-sm">No notifications</div>
                  ) : (
                    <div className="divide-border divide-y">
                      {notifications.slice(0, 3).map((notification) => (
                        <div
                          key={notification.id}
                          className={`px-5 py-3 ${!notification.isRead ? 'bg-brand-50/40 dark:bg-brand-950/20' : ''}`}
                        >
                          <p className="text-ink-950 text-xs font-medium">{notification.title}</p>
                          {notification.body && (
                            <p className="text-ink-500 mt-0.5 text-xs">{notification.body}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </aside>

            <section className="min-w-0">
              <Card>
                <PageTabs
                  items={tabs.map((tab) => ({ value: tab.id, label: tab.label }))}
                  value={activeTab}
                  onValueChange={setActiveTab}
                  label="Driver self-service sections"
                  panelId={(value) => `driver-panel-${value}`}
                />

                <CardContent className="p-0">
                  {activeTab === 'overview' && (
                    <div
                      id="driver-panel-overview"
                      role="tabpanel"
                      className="space-y-5 p-4 sm:p-5"
                    >
                      <div>
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <h3 className="text-ink-950 text-sm font-semibold">
                            Active Trips ({activeTrips.length})
                          </h3>
                          <Link
                            href="/dashboard/trips"
                            className="text-brand-700 focus-ring rounded text-xs font-medium hover:underline"
                          >
                            View all
                          </Link>
                        </div>
                        {activeTrips.length === 0 ? (
                          <p className="text-ink-500 text-sm">No active trips assigned.</p>
                        ) : (
                          <div className="border-border overflow-hidden rounded-[8px] border">
                            {activeTrips.map((trip) => (
                              <Link
                                key={trip.id}
                                href={`/dashboard/trips/${trip.id}`}
                                prefetch
                                className="focus-ring border-border hover:bg-muted/40 flex items-center justify-between gap-3 border-b p-3 last:border-b-0"
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-ink-950 text-sm font-medium">
                                      {trip.reference || trip.id.slice(0, 8)}
                                    </span>
                                    <StatusBadge
                                      status={statusVariant(trip.status)}
                                      label={titleCase(trip.status)}
                                    />
                                  </div>
                                  {trip.vehicleLicence && (
                                    <p className="text-ink-500 mt-1 text-xs">
                                      {trip.vehicleLicence}
                                    </p>
                                  )}
                                </div>
                                <ChevronRight
                                  className="text-ink-300 h-4 w-4 shrink-0"
                                  aria-hidden="true"
                                />
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="border-brand-200 bg-brand-50/30 dark:border-brand-800/50 dark:bg-brand-950/20 rounded-[8px] border p-4">
                        <div className="flex items-start gap-3">
                          <Shield className="text-brand-700 h-5 w-5 shrink-0" aria-hidden="true" />
                          <div>
                            <p className="text-ink-950 text-sm font-medium">Driver authorisation</p>
                            <p className="text-ink-500 mt-0.5 text-xs">
                              {driverInfo.internalAuthorisationRef
                                ? `Reference: ${driverInfo.internalAuthorisationRef}`
                                : 'Standard driver authorisation'}
                            </p>
                            {driverInfo.notes && (
                              <p className="text-ink-500 border-brand-100 mt-2 border-t pt-2 text-xs">
                                {driverInfo.notes}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'licences' && (
                    <div
                      id="driver-panel-licences"
                      role="tabpanel"
                      className="space-y-4 p-4 sm:p-5"
                    >
                      {driverInfo.licences.length === 0 ? (
                        <p className="text-ink-500 text-sm">
                          No licences recorded. Upload your Namibian driving licence below.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {driverInfo.licences.map((licence) => {
                            const expired = new Date(licence.expiryDate) < new Date();
                            const expiringSoon =
                              !expired &&
                              new Date(licence.expiryDate).getTime() - licenceClock <
                                30 * 24 * 60 * 60 * 1000;
                            return (
                              <div
                                key={licence.id}
                                className="border-border flex flex-col gap-3 rounded-[8px] border p-3 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="flex min-w-0 items-start gap-3">
                                  <IdCard
                                    className="text-brand-700 mt-0.5 h-5 w-5 shrink-0"
                                    aria-hidden="true"
                                  />
                                  <div className="min-w-0">
                                    <p className="text-ink-950 text-sm font-medium">
                                      {licence.licenceClass} — {licence.licenceNumber}
                                    </p>
                                    <div className="text-ink-500 mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                                      <span>Issued {formatDate(licence.issueDate)}</span>
                                      <span>Expires {formatDate(licence.expiryDate)}</span>
                                    </div>
                                    <div className="mt-2">
                                      <StatusBadge
                                        status={
                                          licence.verificationStatus === 'verified'
                                            ? 'success'
                                            : licence.verificationStatus === 'rejected'
                                              ? 'error'
                                              : 'pending'
                                        }
                                        label={titleCase(licence.verificationStatus)}
                                      />
                                    </div>
                                  </div>
                                </div>
                                <Badge
                                  variant={
                                    expired ? 'emergency' : expiringSoon ? 'warning' : 'success'
                                  }
                                  size="sm"
                                >
                                  {expired ? 'Expired' : expiringSoon ? 'Expiring' : 'Valid'}
                                </Badge>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="border-border border-t pt-4">
                        <LicenceUploadPanel employeeId={driverInfo.employeeId} />
                      </div>
                    </div>
                  )}

                  {activeTab === 'trips' && (
                    <div id="driver-panel-trips" role="tabpanel" className="p-4 sm:p-5">
                      {trips.length === 0 ? (
                        <p className="text-ink-500 text-sm">No trips assigned to you.</p>
                      ) : (
                        <div className="border-border overflow-hidden rounded-[8px] border">
                          {trips.map((trip) => (
                            <Link
                              key={trip.id}
                              href={`/dashboard/trips/${trip.id}`}
                              prefetch
                              className="focus-ring border-border hover:bg-muted/40 flex items-start justify-between gap-3 border-b p-3 last:border-b-0"
                            >
                              <div className="flex min-w-0 items-start gap-3">
                                <Gauge
                                  className="text-brand-700 mt-0.5 h-5 w-5 shrink-0"
                                  aria-hidden="true"
                                />
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-ink-950 text-sm font-medium">
                                      {trip.reference || trip.id.slice(0, 8)}
                                    </span>
                                    <StatusBadge
                                      status={statusVariant(trip.status)}
                                      label={titleCase(trip.status)}
                                    />
                                  </div>
                                  <div className="text-ink-500 mt-1 flex flex-wrap gap-x-3 text-xs">
                                    {trip.vehicleLicence && <span>{trip.vehicleLicence}</span>}
                                    {trip.startAt && <span>{formatDate(trip.startAt)}</span>}
                                  </div>
                                </div>
                              </div>
                              <ChevronRight
                                className="text-ink-300 mt-1 h-4 w-4 shrink-0"
                                aria-hidden="true"
                              />
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
