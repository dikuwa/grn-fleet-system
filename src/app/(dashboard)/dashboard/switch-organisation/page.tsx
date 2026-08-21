'use client';

import { useEffect, useState } from 'react';
import { Building2, Check, Loader2 } from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/lib/use-toast';

type TenantChoice = {
  id: string;
  name: string;
  slug: string;
};

export default function SwitchOrganisationPage() {
  const { toast } = useToast();
  const [tenants, setTenants] = useState<TenantChoice[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/auth/tenant-context', { cache: 'no-store' });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || 'Could not load organisations');
        if (cancelled) return;
        setTenants(Array.isArray(json.data?.tenants) ? json.data.tenants : []);
        setActiveTenantId(typeof json.data?.activeTenantId === 'string' ? json.data.activeTenantId : null);
      } catch (error) {
        if (!cancelled) {
          toast({
            title: 'Organisations unavailable',
            description: error instanceof Error ? error.message : 'Please try again.',
            variant: 'error',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const switchOrganisation = async (tenant: TenantChoice) => {
    if (tenant.id === activeTenantId || switchingId) return;
    setSwitchingId(tenant.id);
    try {
      const response = await fetch('/api/auth/tenant-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.id }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error || 'Organisation switch failed');
      window.location.assign('/dashboard');
    } catch (error) {
      toast({
        title: 'Could not switch organisation',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'error',
      });
      setSwitchingId(null);
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Switch Organisation' }]} />
      <PageHeader
        title="Switch Organisation"
        description="Choose which organisation you want to work in. Roles, permissions and data remain separate for each organisation."
      />

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="text-ink-500 flex min-h-40 items-center justify-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Loading organisations…
            </div>
          ) : tenants.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-ink-900 text-sm font-medium">No active organisation access</p>
              <p className="text-ink-500 mt-1 text-sm">Ask an administrator to restore or assign your access.</p>
            </div>
          ) : (
            <div className="divide-border divide-y">
              {tenants.map((tenant) => {
                const active = tenant.id === activeTenantId;
                const switching = tenant.id === switchingId;
                return (
                  <div key={tenant.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="bg-muted text-ink-600 flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]">
                        <Building2 className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="text-ink-950 truncate text-sm font-medium">{tenant.name}</p>
                          {active && (
                            <span className="bg-status-success-bg text-status-success-text inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
                              <Check className="h-3 w-3" aria-hidden="true" /> Active
                            </span>
                          )}
                        </div>
                        <p className="text-ink-500 mt-0.5 truncate text-xs">{tenant.slug}</p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant={active ? 'secondary' : 'primary'}
                      size="sm"
                      disabled={active || Boolean(switchingId)}
                      loading={switching}
                      onClick={() => void switchOrganisation(tenant)}
                      className="w-full sm:w-auto"
                    >
                      {active ? 'Current organisation' : 'Switch organisation'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
