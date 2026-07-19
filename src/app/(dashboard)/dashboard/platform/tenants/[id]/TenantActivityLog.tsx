'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Activity, Loader2, Database, RefreshCw, Clock, User,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface AuditEvent {
  id: string;
  eventType: string;
  action: string;
  entityType: string;
  actorUserId: string;
  summary: string | null;
  reason: string | null;
  createdAt: string;
}

interface ActivityResponse {
  success: boolean;
  data: {
    events: AuditEvent[];
    total: number;
    eventTypes: string[];
  };
}

export function TenantActivityLog({ tenantId }: { tenantId: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');

  const fetchActivity = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (filterType !== 'all') params.set('eventType', filterType);
      const res = await fetch(`/api/platform/tenants/${tenantId}/activity?${params}`);
      const json: ActivityResponse = await res.json();
      if (!json.success) throw new Error('Failed to load activity');
      setEvents(json.data.events);
      setTotal(json.data.total);
      if (json.data.eventTypes.length > 0) setEventTypes(json.data.eventTypes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [tenantId, filterType]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Log ({total} events)</CardTitle>
        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-[8px] border border-border bg-surface px-2 text-xs text-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-200"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="all">All Types</option>
            {eventTypes.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <Button variant="secondary" size="sm" onClick={fetchActivity} loading={loading}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-ink-400" />
          </div>
        ) : error ? (
          <div className="px-5 py-4">
            <EmptyState
              icon={<Database className="h-6 w-6" />}
              title="Failed to Load Activity"
              description={error}
            />
          </div>
        ) : events.length === 0 ? (
          <div className="px-5 pb-4">
            <EmptyState
              icon={<Activity className="h-6 w-6" />}
              title="No Activity Yet"
              description="Audit events will appear here as users interact with the system."
            />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {events.map((event) => (
              <div
                key={event.id}
                className="px-5 py-3 hover:bg-canvas/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="info" size="sm">
                        {event.eventType.replace(/_/g, ' ')}
                      </Badge>
                      <span className="text-sm font-medium text-ink-950">
                        {event.action.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {event.actorUserId}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(event.createdAt)}
                      </span>
                      <span className="capitalize">
                        {event.entityType.replace(/_/g, ' ')}
                      </span>
                    </div>
                    {event.summary && (
                      <p className="mt-1 text-xs text-ink-500">{event.summary}</p>
                    )}
                    {event.reason && (
                      <p className="mt-0.5 text-xs text-ink-400 italic">
                        Reason: {event.reason}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
