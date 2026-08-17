'use client';

import { useCallback, useEffect, useState } from 'react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchableEntitySelect } from '@/components/ui/searchable-entity-select';
import { StyledSelect } from '@/components/ui/styled-select';
import { Badge } from '@/components/ui/badge';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/lib/use-toast';
import { GitBranch, Loader2, LockKeyhole, Plus, RefreshCw, Save, ShieldCheck } from 'lucide-react';

type Option = { id: string; name: string };
type Person = { userId: string; name: string | null; email: string };
type Step = {
  id: string;
  stepOrder: number;
  label: string;
  actionType: string;
  requiredPermission: string | null;
  assignedUserId: string | null;
  config?: { assignmentStrategy?: string; fallbackStrategies?: string[] };
};
type Definition = {
  id: string;
  name: string;
  tripScope: string;
  version: number;
  regionId: string | null;
  officeId: string | null;
  departmentId: string | null;
  steps: Step[];
};
type Preset = { id: string; label: string; description: string; actions: string[] };
type AssignmentOption = { id: string; label: string };

const SYSTEM_STAGES = new Set(['transport_review', 'acknowledge']);

function routingSnapshot(definition: Definition) {
  return JSON.stringify({
    regionId: definition.regionId,
    officeId: definition.officeId,
    departmentId: definition.departmentId,
    steps: definition.steps.map((step) => ({
      id: step.id,
      assignedUserId: step.assignedUserId,
      assignmentStrategy: step.config?.assignmentStrategy,
      fallbackStrategies: step.config?.fallbackStrategies,
    })),
  });
}

export default function WorkflowRoutingPage() {
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [savedSnapshots, setSavedSnapshots] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<Person[]>([]);
  const [eligibleByPermission, setEligibleByPermission] = useState<Record<string, Person[]>>({});
  const [offices, setOffices] = useState<Option[]>([]);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [regions, setRegions] = useState<Option[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [assignmentStrategies, setAssignmentStrategies] = useState<AssignmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [publishingStages, setPublishingStages] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [newRoute, setNewRoute] = useState({
    name: '', tripScope: 'regional', preset: 'standard', regionId: '', officeId: '', departmentId: '', supervisor: true, release: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/workflows', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load workflow routing');
      const loaded = (result.data.definitions || []) as Definition[];
      setDefinitions(loaded);
      setSavedSnapshots(Object.fromEntries(loaded.map((definition) => [definition.id, routingSnapshot(definition)])));
      setUsers(result.data.users || []);
      setEligibleByPermission(result.data.eligibleByPermission || {});
      setOffices(result.data.offices || []);
      setDepartments(result.data.departments || []);
      setRegions(result.data.regions || []);
      setPresets(result.data.presets || []);
      setAssignmentStrategies(result.data.assignmentStrategies || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load workflow routing';
      setError(message);
      toast({ title: 'Routing unavailable', description: message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  function updateDefinition(id: string, patch: Partial<Definition>) {
    setDefinitions((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function updateStepStrategy(definitionId: string, stepId: string, strategy: string) {
    setDefinitions((current) => current.map((definition) => definition.id !== definitionId ? definition : {
      ...definition,
      steps: definition.steps.map((step) => step.id !== stepId ? step : {
        ...step,
        assignedUserId: strategy === 'named_user' ? step.assignedUserId : null,
        config: { ...step.config, assignmentStrategy: strategy },
      }),
    }));
  }

  function updateStepAssignee(definitionId: string, stepId: string, assignedUserId: string) {
    setDefinitions((current) => current.map((definition) => definition.id !== definitionId ? definition : {
      ...definition,
      steps: definition.steps.map((step) => step.id !== stepId ? step : {
        ...step,
        assignedUserId: assignedUserId || null,
        config: { ...step.config, assignmentStrategy: assignedUserId ? 'named_user' : 'permission_pool' },
      }),
    }));
  }

  async function createRoute() {
    setCreating(true);
    try {
      const actions = [
        ...(newRoute.supervisor ? ['supervisor_approve'] : []),
        'transport_review',
        ...(newRoute.release ? ['release'] : []),
        'authorise',
        'acknowledge',
      ];
      const response = await fetch('/api/admin/workflows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newRoute, actions }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to create route');
      toast({ title: 'Approval route published', description: 'New matching requests will use this route.', variant: 'success' });
      setNewRoute((current) => ({ ...current, name: '' }));
      await load();
    } catch (err) {
      toast({ title: 'Route not created', description: err instanceof Error ? err.message : 'Unable to create route', variant: 'error' });
    } finally { setCreating(false); }
  }

  async function toggleOptionalStage(definition: Definition, actionType: 'supervisor_approve' | 'release') {
    const current = definition.steps.map((step) => step.actionType);
    const next = current.includes(actionType) ? current.filter((action) => action !== actionType) : [...current, actionType];
    const order = ['supervisor_approve', 'transport_review', 'release', 'authorise', 'acknowledge'];
    const actions = order.filter((action) => next.includes(action));
    setPublishingStages(definition.id);
    try {
      const response = await fetch('/api/admin/workflows', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definitionId: definition.id, actions }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to publish workflow stages');
      toast({ title: 'Approval gates published', description: `Version ${result.data.version} applies to new requests; active requests keep their original route.`, variant: 'success' });
      await load();
    } catch (err) {
      toast({ title: 'Stage update failed', description: err instanceof Error ? err.message : 'Try again', variant: 'error' });
    } finally { setPublishingStages(null); }
  }

  async function publish(definition: Definition) {
    setSaving(definition.id);
    try {
      const response = await fetch('/api/admin/workflows', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          definitionId: definition.id,
          regionId: definition.regionId,
          officeId: definition.officeId,
          departmentId: definition.departmentId,
          steps: definition.steps.map((step) => ({
            id: step.id,
            stepOrder: step.stepOrder,
            assignedUserId: step.assignedUserId,
            assignmentStrategy: step.config?.assignmentStrategy,
            fallbackStrategies: step.config?.fallbackStrategies,
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save routing');
      toast({ title: 'Approval routing published', description: `${definition.name} is now version ${result.data?.version ?? definition.version + 1}. Active requests keep their frozen route.`, variant: 'success' });
      await load();
    } catch (err) {
      toast({ title: 'Save failed', description: err instanceof Error ? err.message : 'Unable to save routing', variant: 'error' });
    } finally { setSaving(null); }
  }

  function save(definition: Definition) {
    confirm({
      title: `Publish ${definition.name} changes?`,
      description: `This creates version ${definition.version + 1} for future requests. Existing active requests stay on version ${definition.version}. System lifecycle stages remain protected.`,
      confirmLabel: 'Publish routing',
      variant: 'destructive',
      requireTypedConfirm: `UPDATE ${definition.tripScope.toUpperCase()} ROUTING`,
      onConfirm: () => publish(definition),
    });
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Administration' }, { label: 'Approval Workflows' }]} />
      <PageHeader
        title="Approval Workflows"
        description="Configure who approves tenant requests while GRN Fleet protects the operational transport lifecycle."
      >
        <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading} className="w-full sm:w-auto">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </PageHeader>

      <section className="border-status-info-text/20 bg-status-info-bg/20 rounded-[10px] border p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="text-status-info-text mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-ink-950 text-sm font-semibold">Tenant approval rules, protected transport lifecycle</p>
            <p className="text-ink-600 mt-1 text-sm leading-relaxed">
              Tenant Administration chooses optional organisational gates, scope and responsible approvers. Transport Review and Driver Acknowledgement are system lifecycle stages and cannot be removed or reordered. Workflow versions are frozen for requests already in progress.
            </p>
          </div>
        </div>
      </section>

      <Card>
        <CardHeader><CardTitle>Create an approval route</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-3">
            {presets.map((preset) => (
              <button
                type="button" key={preset.id}
                onClick={() => setNewRoute((current) => ({ ...current, preset: preset.id, supervisor: preset.actions.includes('supervisor_approve'), release: preset.actions.includes('release') }))}
                className={`focus-ring rounded-[8px] border p-3 text-left ${newRoute.preset === preset.id ? 'border-brand-600 bg-brand-50' : 'border-border'}`}
              >
                <p className="text-ink-950 text-sm font-semibold">{preset.label}</p>
                <p className="text-ink-500 mt-1 text-xs">{preset.description}</p>
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <input value={newRoute.name} onChange={(event) => setNewRoute((current) => ({ ...current, name: event.target.value }))} placeholder="Route name" className="border-border bg-surface text-ink-950 focus:border-brand-500 h-10 rounded-[8px] border px-3 text-sm outline-none" />
            <StyledSelect value={newRoute.tripScope} aria-label="Trip scope" onChange={(event) => setNewRoute((current) => ({ ...current, tripScope: event.target.value }))}>
              <option value="regional">Regional requests</option><option value="national">National requests</option>
            </StyledSelect>
            <StyledSelect value={newRoute.regionId} aria-label="Region scope" onChange={(event) => setNewRoute((current) => ({ ...current, regionId: event.target.value }))}>
              <option value="">All regions (fallback)</option>{regions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </StyledSelect>
            <StyledSelect value={newRoute.officeId} aria-label="Office scope" onChange={(event) => setNewRoute((current) => ({ ...current, officeId: event.target.value }))}>
              <option value="">All offices</option>{offices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </StyledSelect>
            <StyledSelect value={newRoute.departmentId} aria-label="Department scope" onChange={(event) => setNewRoute((current) => ({ ...current, departmentId: event.target.value }))}>
              <option value="">All departments</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </StyledSelect>
            <label className="border-border flex h-10 items-center gap-2 rounded-[8px] border px-3 text-sm"><input type="checkbox" checked={newRoute.supervisor} onChange={(event) => setNewRoute((current) => ({ ...current, preset: 'advanced', supervisor: event.target.checked }))} />Department supervisor</label>
            <label className="border-border flex h-10 items-center gap-2 rounded-[8px] border px-3 text-sm"><input type="checkbox" checked={newRoute.release} onChange={(event) => setNewRoute((current) => ({ ...current, preset: 'advanced', release: event.target.checked }))} />Administrative release</label>
            <Button onClick={() => void createRoute()} loading={creating} disabled={newRoute.name.trim().length < 3}><Plus className="h-4 w-4" /> Create &amp; publish</Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-ink-500 flex items-center justify-center gap-2 py-16 text-sm" role="status"><Loader2 className="h-5 w-5 animate-spin" /> Loading approval routing…</div>
      ) : error ? (
        <EmptyState icon={<GitBranch className="h-6 w-6" />} title="Workflow routing unavailable" description={error} action={{ label: 'Retry', onClick: () => void load() }} />
      ) : definitions.length === 0 ? (
        <EmptyState icon={<GitBranch className="h-6 w-6" />} title="No workflow definitions" description="Create a default approval route before new requests can be submitted." />
      ) : (
        <div className="space-y-4">
          {definitions.map((definition) => {
            const isDirty = savedSnapshots[definition.id] !== routingSnapshot(definition);
            return (
              <Card key={definition.id}>
                <CardHeader className="pb-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <CardTitle className="flex min-w-0 items-center gap-2"><GitBranch className="text-brand-700 h-4 w-4" /><span className="truncate">{definition.name}</span></CardTitle>
                    <div className="text-ink-500 flex flex-wrap items-center gap-2 text-xs">
                      {isDirty && <Badge variant="warning" size="sm">Draft changes</Badge>}
                      <span>{definition.tripScope.replace(/_/g, ' ')} · v{definition.version}</span>
                      {!definition.regionId && !definition.officeId && !definition.departmentId && <Badge variant="info" size="sm">Fallback route</Badge>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <section className="border-border bg-muted/30 rounded-[8px] border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div><p className="text-ink-950 text-sm font-semibold">Tenant approval gates</p><p className="text-ink-500 mt-0.5 text-xs">Enable only the organisational controls this tenant actually requires.</p></div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant={definition.steps.some((step) => step.actionType === 'supervisor_approve') ? 'primary' : 'secondary'} size="compact" loading={publishingStages === definition.id} onClick={() => void toggleOptionalStage(definition, 'supervisor_approve')}>Supervisor Approval</Button>
                        <Button type="button" variant={definition.steps.some((step) => step.actionType === 'release') ? 'primary' : 'secondary'} size="compact" loading={publishingStages === definition.id} onClick={() => void toggleOptionalStage(definition, 'release')}>Administrative Release</Button>
                      </div>
                    </div>
                  </section>

                  <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={`${definition.name} scope`}>
                    <StyledSelect value={definition.regionId || ''} aria-label="Region scope" onChange={(event) => updateDefinition(definition.id, { regionId: event.target.value || null })}><option value="">All regions</option>{regions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</StyledSelect>
                    <StyledSelect value={definition.officeId || ''} aria-label="Office scope" onChange={(event) => updateDefinition(definition.id, { officeId: event.target.value || null })}><option value="">All offices</option>{offices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</StyledSelect>
                    <StyledSelect value={definition.departmentId || ''} aria-label="Department scope" onChange={(event) => updateDefinition(definition.id, { departmentId: event.target.value || null })}><option value="">All departments</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</StyledSelect>
                  </section>

                  <div className="border-border overflow-hidden rounded-[8px] border">
                    {definition.steps.map((step) => {
                      const systemStage = SYSTEM_STAGES.has(step.actionType);
                      const eligible = step.requiredPermission ? eligibleByPermission[step.requiredPermission] || [] : users;
                      const assigned = step.assignedUserId ? users.find((person) => person.userId === step.assignedUserId) : undefined;
                      const options = assigned && !eligible.some((person) => person.userId === assigned.userId) ? [assigned, ...eligible] : eligible;
                      return (
                        <div key={step.id} className="border-border grid gap-3 border-b p-3 last:border-b-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(18rem,1.1fr)] lg:items-center">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-ink-950 text-sm font-medium">{step.stepOrder}. {step.label}</p>
                              {systemStage && <Badge variant="default" size="sm"><LockKeyhole className="mr-1 h-3 w-3" />System lifecycle</Badge>}
                              {step.actionType === 'authorise' && <Badge variant="info" size="sm">Governed authority</Badge>}
                            </div>
                            <p className="text-ink-500 mt-1 text-xs">{systemStage ? 'Protected operational stage; lifecycle order is fixed.' : 'Tenant routing gate; responsible approver may be configured.'}</p>
                          </div>
                          <div className="min-w-0">
                            {systemStage ? (
                              <div className="bg-muted/50 text-ink-600 rounded-[8px] px-3 py-2 text-xs">
                                {step.actionType === 'transport_review' ? 'Resolved from Transport Review permission and operational responsibility.' : 'Resolved dynamically from the allocated driver in Driver Console.'}
                              </div>
                            ) : (
                              <>
                                <StyledSelect value={step.config?.assignmentStrategy || (step.assignedUserId ? 'named_user' : 'permission_pool')} aria-label={`Assignment strategy for ${step.label}`} onChange={(event) => updateStepStrategy(definition.id, step.id, event.target.value)} className="mb-2">
                                  {assignmentStrategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.label}</option>)}
                                </StyledSelect>
                                <SearchableEntitySelect
                                  value={step.assignedUserId || ''}
                                  ariaLabel={`Assigned person for ${step.label}`}
                                  placeholder={step.config?.assignmentStrategy === 'named_user' ? `Choose a person · ${eligible.length} eligible` : 'Assignment resolved automatically'}
                                  emptyLabel="No eligible active tenant user matches this search."
                                  options={options.map((person) => ({ id: person.userId, label: person.name || person.email, description: person.email, searchText: `${person.name || ''} ${person.email}`, status: 'Eligible' }))}
                                  onChange={(option) => updateStepAssignee(definition.id, step.id, option?.id || '')}
                                  disabled={step.config?.assignmentStrategy !== 'named_user'}
                                />
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mobile-action-bar border-border flex justify-end border-t pt-4">
                    <Button onClick={() => save(definition)} loading={saving === definition.id} disabled={saving !== null || !isDirty} className="w-full sm:w-auto"><Save className="h-4 w-4" /> Save &amp; publish</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
