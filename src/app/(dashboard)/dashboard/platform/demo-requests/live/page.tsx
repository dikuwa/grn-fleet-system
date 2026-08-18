'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock3, ExternalLink, Loader2, MonitorPlay, RefreshCw, ShieldCheck } from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/lib/use-toast';

interface SandboxRow {
  id: string;
  tenantId: string;
  tenantName: string;
  company: string;
  status: string;
  isActive: boolean;
  expiresAt: string;
  lastAccessedAt: string | null;
  demoViews: number | null;
  isPublicLiveDemo: boolean;
}

function dateTime(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-NA', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function PlatformLiveDemoPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<SandboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/platform/demo-requests/live', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not load demo sandboxes');
      setRows(json.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load demo sandboxes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function publish(row: SandboxRow, enabled: boolean) {
    setBusy(row.id);
    try {
      const response = await fetch('/api/platform/demo-requests/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sandboxId: row.id, enabled }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Live demo could not be updated');
      toast({
        title: enabled ? 'Live demo published' : 'Live demo unpublished',
        description: enabled
          ? 'Synthetic demo personas and fleet data are ready at /demo.'
          : 'The sandbox is no longer available from the public live demo.',
        variant: 'success',
      });
      await load();
    } catch (err) {
      toast({
        title: 'Live demo update failed',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  }

  const active = rows.find((row) => row.isPublicLiveDemo);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Platform', href: '/dashboard/platform' },
          { label: 'Demo Requests', href: '/dashboard/platform/demo-requests' },
          { label: 'Live Demo' },
        ]}
      />
      <PageHeader
        title="Live Demo"
        description="Publish one isolated demo sandbox for anonymous product exploration. Public sessions expire automatically and never outlive the sandbox."
      >
        <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <Link href="/demo" target="_blank">
            <ExternalLink className="h-4 w-4" /> Open public demo
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <CardHeader><CardTitle>Public demo status</CardTitle></CardHeader>
        <CardContent>
          {active ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink-950">{active.tenantName}</p>
                  <Badge variant="success">Published</Badge>
                </div>
                <p className="mt-1 text-sm text-ink-500">
                  Expires {dateTime(active.expiresAt)} · {active.demoViews ?? 0} public sessions
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={() => void publish(active, false)}
                disabled={busy !== null}
              >
                {busy === active.id && <Loader2 className="h-4 w-4 animate-spin" />}
                Unpublish
              </Button>
            </div>
          ) : (
            <div className="flex items-start gap-3 text-sm text-ink-500">
              <MonitorPlay className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
              <p>No sandbox is currently public. Select an active, unexpired sandbox below.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="rounded-[10px] border border-border bg-surface p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
          <div>
            <p className="text-sm font-semibold text-ink-950">Safe public access</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-500">
              Publishing creates controlled Transport Officer, Requester, Approver and Driver personas using synthetic data. Tenant Administrator remains available only in private prospect sandboxes.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-40 items-center justify-center text-sm text-ink-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading sandboxes…
        </div>
      ) : error ? (
        <EmptyState
          icon={<MonitorPlay className="h-6 w-6" />}
          title="Could not load sandboxes"
          description={error}
          action={{ label: 'Retry', onClick: load }}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<MonitorPlay className="h-6 w-6" />}
          title="No demo sandboxes yet"
          description="Qualify a demo request and create an isolated sandbox first."
          action={{ label: 'View demo requests', href: '/dashboard/platform/demo-requests' }}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((row) => {
            const expired = new Date(row.expiresAt) <= new Date();
            const eligible = row.status === 'active' && row.isActive && !expired;
            return (
              <Card key={row.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink-950">{row.company}</p>
                      <p className="mt-0.5 truncate text-sm text-ink-500">{row.tenantName}</p>
                    </div>
                    <Badge variant={row.isPublicLiveDemo ? 'success' : eligible ? 'info' : 'default'}>
                      {row.isPublicLiveDemo ? 'Public' : expired ? 'Expired' : row.status}
                    </Badge>
                  </div>
                  <div className="mt-4 space-y-1.5 text-xs text-ink-500">
                    <p className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5" />Expires {dateTime(row.expiresAt)}</p>
                    <p>Last public access: {dateTime(row.lastAccessedAt)}</p>
                    <p>Public sessions: {row.demoViews ?? 0}</p>
                  </div>
                  <Button
                    className="mt-4 w-full"
                    variant={row.isPublicLiveDemo ? 'secondary' : 'default'}
                    disabled={!eligible || busy !== null}
                    onClick={() => void publish(row, !row.isPublicLiveDemo)}
                  >
                    {busy === row.id && <Loader2 className="h-4 w-4 animate-spin" />}
                    {row.isPublicLiveDemo ? 'Unpublish' : eligible ? 'Use as Live Demo' : 'Not eligible'}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
