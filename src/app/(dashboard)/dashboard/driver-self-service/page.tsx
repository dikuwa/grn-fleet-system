'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDate } from '@/lib/utils';
import {
  User, Car, ClipboardCheck, Gauge, FileText,
  AlertTriangle, Loader2, RefreshCw, ChevronRight,
  Clock, MapPin, CheckCircle2, XCircle, Shield,
  IdCard, CalendarClock, Bell, PenSquare,
} from 'lucide-react';
import Link from 'next/link';

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

export default function DriverSelfServicePage() {
  const [driverInfo, setDriverInfo] = useState<DriverInfo | null>(null);
  const [trips, setTrips] = useState<DriverTrip[]>([]);
  const [notifications, setNotifications] = useState<DriverNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'licences' | 'trips'>('overview');
  const fetched = useRef(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [driverRes, tripsRes, notifRes] = await Promise.all([
        fetch('/api/drivers/me').catch(() => null),
        fetch('/api/trips?driver_assigned=true&limit=10'),
        fetch('/api/notifications?limit=5'),
      ]);

      if (driverRes?.ok) {
        const driverJson = await driverRes.json();
        setDriverInfo(driverJson.driver || driverJson.data || null);
      }

      if (tripsRes.ok) {
        const tripsJson = await tripsRes.json();
        const tripsList = tripsJson.trips || tripsJson.data?.trips || tripsJson.rows || tripsJson.data || [];
        setTrips(Array.isArray(tripsList) ? tripsList : []);
      }

      if (notifRes.ok) {
        const notifJson = await notifRes.json();
        const notifList = notifJson.notifications || notifJson.data?.notifications || notifJson.rows || [];
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
    fetchData();
  }, [fetchData]);

  const statusVariant = (s: string): 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency' => {
    switch (s) {
      case 'in_progress': return 'success';
      case 'pending': case 'issued': return 'pending';
      case 'returned': return 'info';
      case 'closed': case 'completed': return 'success';
      case 'cancelled': return 'cancelled';
      default: return 'pending';
    }
  };

  const statusLabel = (s: string): string => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const activeTrips = trips.filter((t) => ['pending', 'in_progress', 'issued'].includes(t.status));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Driver Self-Service' },
      ]} />
      <PageHeader
        title="Driver Self-Service"
        description="Manage your profile, licences, trips and notifications"
      >
        <Button variant="secondary" size="sm" onClick={fetchData} loading={loading}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </PageHeader>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-ink-400" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <AlertTriangle className="h-8 w-8 text-status-error-text" />
          <p className="text-sm text-ink-500">{error}</p>
          <Button variant="secondary" size="sm" onClick={fetchData}>Retry</Button>
        </div>
      ) : !driverInfo ? (
        <EmptyState icon={<User className="h-8 w-8" />} title="No driver profile found" description="Your employee account may not have a driver profile assigned. Contact your Transport Administrator." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column - Profile */}
          <div className="space-y-6 lg:col-span-1">
            {/* Profile Card */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-50 text-3xl font-bold text-brand-700">
                    {driverInfo.employee.firstName[0]}{driverInfo.employee.lastName[0]}
                  </div>
                  <h2 className="mt-4 text-lg font-semibold text-ink-950">
                    {driverInfo.employee.firstName} {driverInfo.employee.lastName}
                  </h2>
                  <p className="text-sm text-ink-500">{driverInfo.employee.jobTitle || 'Driver'}</p>
                  <div className="mt-3">
                    <StatusBadge
                      status={driverInfo.driverStatus === 'authorised' ? 'success' : driverInfo.driverStatus === 'suspended' ? 'error' : 'pending'}
                      label={driverInfo.driverStatus}
                    />
                  </div>
                  <div className="mt-4 w-full space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-ink-500">Employee #</span>
                      <span className="font-medium text-ink-950">{driverInfo.employee.employeeNumber}</span>
                    </div>
                    {driverInfo.employee.email && (
                      <div className="flex items-center justify-between">
                        <span className="text-ink-500">Email</span>
                        <span className="text-ink-950">{driverInfo.employee.email}</span>
                      </div>
                    )}
                    {driverInfo.employee.phone && (
                      <div className="flex items-center justify-between">
                        <span className="text-ink-500">Phone</span>
                        <span className="text-ink-950">{driverInfo.employee.phone}</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  <Link href="/dashboard/inspections/departure" className="flex flex-col items-center gap-1.5 rounded-[8px] border border-border bg-canvas p-3 hover:border-brand-200 transition-colors">
                    <ClipboardCheck className="h-5 w-5 text-brand-600" />
                    <span className="text-xs font-medium text-ink-700">Departure</span>
                  </Link>
                  <Link href="/dashboard/inspections/return" className="flex flex-col items-center gap-1.5 rounded-[8px] border border-border bg-canvas p-3 hover:border-brand-200 transition-colors">
                    <ClipboardCheck className="h-5 w-5 text-green-600" />
                    <span className="text-xs font-medium text-ink-700">Return</span>
                  </Link>
                  <Link href="/dashboard/logs" className="flex flex-col items-center gap-1.5 rounded-[8px] border border-border bg-canvas p-3 hover:border-brand-200 transition-colors">
                    <PenSquare className="h-5 w-5 text-amber-600" />
                    <span className="text-xs font-medium text-ink-700">Daily Log</span>
                  </Link>
                  <Link href="/dashboard/fuel/new" className="flex flex-col items-center gap-1.5 rounded-[8px] border border-border bg-canvas p-3 hover:border-brand-200 transition-colors">
                    <Gauge className="h-5 w-5 text-purple-600" />
                    <span className="text-xs font-medium text-ink-700">Fuel Entry</span>
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* Recent Notifications */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-4 w-4" />
                  Recent Alerts
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {notifications.length === 0 ? (
                  <div className="px-5 pb-4 text-sm text-ink-500">No notifications</div>
                ) : (
                  <div className="divide-y divide-border">
                    {notifications.slice(0, 3).map((n) => (
                      <div key={n.id} className={`px-5 py-2.5 ${!n.isRead ? 'bg-brand-50/50' : ''}`}>
                        <p className="text-xs font-medium text-ink-950">{n.title}</p>
                        {n.body && <p className="text-xs text-ink-500 mt-0.5">{n.body}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Content */}
          <div className="space-y-6 lg:col-span-2">
            {/* Tabs */}
            <Card>
              <div className="border-b border-border">
                <div className="flex">
                  {(['overview', 'licences', 'trips'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${
                        activeTab === tab ? 'border-brand-800 text-ink-950' : 'border-transparent text-ink-500 hover:text-ink-700'
                      }`}
                    >
                      <span className="capitalize">{tab}</span>
                    </button>
                  ))}
                </div>
              </div>

              <CardContent className="p-0">
                {activeTab === 'overview' && (
                  <div className="p-5 space-y-4">
                    {/* Active Trips */}
                    <div>
                      <h3 className="text-sm font-semibold text-ink-950 mb-3">
                        Active Trips ({activeTrips.length})
                      </h3>
                      {activeTrips.length === 0 ? (
                        <p className="text-sm text-ink-500">No active trips assigned.</p>
                      ) : (
                        <div className="space-y-2">
                          {activeTrips.map((t) => (
                            <Link key={t.id} href={`/dashboard/trips/${t.id}`} className="flex items-center justify-between rounded-[8px] border border-border bg-canvas p-3 hover:border-brand-200 transition-colors">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-ink-950">{t.reference || t.id.slice(0, 8)}</span>
                                  <StatusBadge status={statusVariant(t.status)} label={statusLabel(t.status)} />
                                </div>
                                {t.vehicleLicence && <p className="text-xs text-ink-500 mt-0.5">{t.vehicleLicence}</p>}
                              </div>
                              <ChevronRight className="h-4 w-4 text-ink-300" />
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Driver Status */}
                    <Card className="border-brand-200 bg-brand-50/30">
                      <CardContent className="pt-3">
                        <div className="flex items-center gap-3">
                          <Shield className="h-8 w-8 text-brand-600" />
                          <div>
                            <p className="text-sm font-medium text-ink-950">Authorisation</p>
                            <p className="text-xs text-ink-500">
                              {driverInfo.internalAuthorisationRef
                                ? `Ref: ${driverInfo.internalAuthorisationRef}`
                                : 'Standard driver authorisation'}
                            </p>
                          </div>
                        </div>
                        {driverInfo.notes && (
                          <p className="mt-2 text-xs text-ink-500 border-t border-brand-100 pt-2">{driverInfo.notes}</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                )}

                {activeTab === 'licences' && (
                  <div className="p-5">
                    {driverInfo.licences.length === 0 ? (
                      <p className="text-sm text-ink-500">No licences recorded.</p>
                    ) : (
                      <div className="space-y-3">
                        {driverInfo.licences.map((lic) => {
                          const expired = new Date(lic.expiryDate) < new Date();
                          const expiringSoon = !expired && new Date(lic.expiryDate).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
                          return (
                            <div key={lic.id} className="flex items-center justify-between rounded-[8px] border border-border p-3">
                              <div className="flex items-center gap-3">
                                <IdCard className="h-8 w-8 text-brand-600" />
                                <div>
                                  <p className="text-sm font-medium text-ink-950">
                                    {lic.licenceClass} — {lic.licenceNumber}
                                  </p>
                                  <div className="flex items-center gap-2 mt-0.5 text-xs text-ink-500">
                                    <span>Issued: {formatDate(lic.issueDate)}</span>
                                    <span>Expires: {formatDate(lic.expiryDate)}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {expired ? (
                                  <Badge variant="emergency" size="sm">Expired</Badge>
                                ) : expiringSoon ? (
                                  <Badge variant="pending" size="sm">Expiring</Badge>
                                ) : (
                                  <Badge variant="success" size="sm">Valid</Badge>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'trips' && (
                  <div className="p-5">
                    {trips.length === 0 ? (
                      <p className="text-sm text-ink-500">No trips assigned to you.</p>
                    ) : (
                      <div className="space-y-2">
                        {trips.map((t) => (
                          <Link key={t.id} href={`/dashboard/trips/${t.id}`} className="flex items-center justify-between rounded-[8px] border border-border bg-canvas p-3 hover:border-brand-200 transition-colors">
                            <div className="flex items-center gap-3">
                              <Gauge className={`h-8 w-8 p-1.5 rounded-[6px] ${
                                t.status === 'in_progress' ? 'bg-green-50 text-green-600' :
                                t.status === 'closed' ? 'bg-gray-50 text-gray-500' :
                                'bg-blue-50 text-blue-600'
                              }`} />
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-ink-950">{t.reference || t.id.slice(0, 8)}</span>
                                  <StatusBadge status={statusVariant(t.status)} label={statusLabel(t.status)} />
                                </div>
                                <div className="flex items-center gap-3 text-xs text-ink-500 mt-0.5">
                                  {t.vehicleLicence && <span>{t.vehicleLicence}</span>}
                                  {t.startAt && <span>{formatDate(t.startAt)}</span>}
                                </div>
                              </div>
                            </div>
                            <ChevronRight className="h-4 w-4 text-ink-300" />
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
