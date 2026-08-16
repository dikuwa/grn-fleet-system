'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { AlertTriangle, FileText, Gauge, History, Loader2, Wrench } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type VehicleDetailTabKey = 'documents' | 'defects' | 'maintenance' | 'odometer' | 'status';

interface TabsShellProps {
  children: React.ReactNode;
  visibleTabs?: VehicleDetailTabKey[];
}

const TABS: Array<{
  key: VehicleDetailTabKey;
  label: string;
  icon: typeof FileText;
}> = [
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'defects', label: 'Defects', icon: AlertTriangle },
  { key: 'maintenance', label: 'Maintenance', icon: Wrench },
  { key: 'odometer', label: 'Odometer', icon: Gauge },
  { key: 'status', label: 'Status', icon: History },
];

const DEFAULT_VISIBLE_TABS = TABS.map((tab) => tab.key);

type OdometerEvent = {
  id: string;
  odometerValue: number;
  source: string;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  notes: string | null;
  createdAt: string;
};

function OdometerTimeline({ vehicleId }: { vehicleId: string }) {
  const [currentOdometer, setCurrentOdometer] = useState<number | null>(null);
  const [events, setEvents] = useState<OdometerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`/api/fleet/${vehicleId}/odometer`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || 'Could not load odometer history');
        setCurrentOdometer(Number(json.data?.currentOdometer ?? 0));
        setEvents(Array.isArray(json.data?.events) ? json.data.events : []);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load odometer history');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [vehicleId]);

  if (loading) {
    return <div className="text-ink-500 flex items-center justify-center gap-2 px-5 py-12 text-sm"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />Loading odometer history…</div>;
  }
  if (error) return <div className="text-status-error-text px-5 py-8 text-sm" role="alert">{error}</div>;

  return (
    <div>
      <div className="border-border bg-muted/30 border-b px-5 py-4">
        <p className="text-ink-500 text-xs">Current recorded odometer</p>
        <p className="text-ink-950 mt-1 text-2xl font-semibold tabular-nums">{(currentOdometer ?? 0).toLocaleString()} km</p>
      </div>
      {events.length === 0 ? (
        <p className="text-ink-500 px-5 py-8 text-sm">No immutable odometer events have been recorded for this vehicle yet.</p>
      ) : (
        <div className="divide-border divide-y">
          {events.map((event, index) => {
            const nextOlder = events[index + 1];
            const delta = nextOlder ? event.odometerValue - nextOlder.odometerValue : null;
            return (
              <div key={event.id} className="px-5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-ink-950 text-sm font-semibold tabular-nums">{event.odometerValue.toLocaleString()} km</p>
                    <p className="text-ink-500 mt-1 text-xs capitalize">{event.source.replaceAll('_', ' ')}{event.sourceEntityType ? ` · ${event.sourceEntityType.replaceAll('_', ' ')}` : ''}</p>
                    {event.notes && <p className="text-ink-600 mt-1 text-xs">{event.notes}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-ink-500 text-xs tabular-nums">{new Date(event.createdAt).toLocaleString('en-NA')}</p>
                    {delta !== null && delta >= 0 && <p className="text-status-info-text mt-1 text-xs font-medium tabular-nums">+{delta.toLocaleString()} km</p>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TabsShell({ children, visibleTabs = DEFAULT_VISIBLE_TABS }: TabsShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab') as VehicleDetailTabKey | null;
  const tabs = useMemo(
    () => TABS.filter((tab) => visibleTabs.includes(tab.key)),
    [visibleTabs],
  );
  const firstTabKey = tabs[0]?.key ?? 'odometer';
  const requestedTabIsVisible = requestedTab ? tabs.some((tab) => tab.key === requestedTab) : false;
  const [activeTab, setActiveTab] = useState<VehicleDetailTabKey>(
    requestedTabIsVisible && requestedTab ? requestedTab : firstTabKey,
  );
  const childrenArray = useMemo(() => (Array.isArray(children) ? children : [children]), [children]);
  const vehicleId = pathname.split('/').filter(Boolean).at(-1) || '';

  useEffect(() => {
    if (requestedTab && tabs.some((tab) => tab.key === requestedTab)) {
      setActiveTab(requestedTab);
      return;
    }
    if (!tabs.some((tab) => tab.key === activeTab)) setActiveTab(firstTabKey);
  }, [activeTab, firstTabKey, requestedTab, tabs]);

  const contentByKey: Partial<Record<VehicleDetailTabKey, React.ReactNode>> = {
    documents: childrenArray[0],
    defects: childrenArray[1],
    maintenance: childrenArray[2],
    status: childrenArray[3],
  };
  const content = activeTab === 'odometer'
    ? <OdometerTimeline vehicleId={vehicleId} />
    : contentByKey[activeTab];

  return (
    <Card>
      <div className="border-border overflow-x-auto border-b">
        <div className="flex min-w-max" role="tablist" aria-label="Vehicle record sections">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'focus-ring -mb-px flex min-h-11 cursor-pointer items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-colors motion-reduce:transition-none',
                  activeTab === tab.key ? 'border-brand-800 text-ink-950' : 'border-transparent text-ink-500 hover:bg-muted/40 hover:text-ink-700',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      <div role="tabpanel">
        {content ?? <div className="text-ink-500 px-5 py-8 text-center text-sm">No content available.</div>}
      </div>
    </Card>
  );
}
