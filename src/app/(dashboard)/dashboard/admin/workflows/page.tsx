'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchableEntitySelect } from '@/components/ui/searchable-entity-select';
import { StyledSelect } from '@/components/ui/styled-select';
import { Badge } from '@/components/ui/badge';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/lib/use-toast';
import {
  ArrowDown,
  ArrowUp,
  GitBranch,
  GripVertical,
  Loader2,
  RefreshCw,
  Save,
  Plus,
} from 'lucide-react';

type Option = { id: string; name: string };
type Person = { userId: string; name: string | null; email: string };
type Step = {
  id: string;
  stepOrder: number;
  label: string;
  actionType: string;
  requiredPermission: string | null;
  assignedUserId: string | null;
  config?: {
    assignmentStrategy?: string;
    fallbackStrategies?: string[];
  };
};
type Preset = { id: string; label: string; description: string; actions: string[] };
type AssignmentOption = { id: string; label: string };

function routingSnapshot(definition: Definition) {
  return JSON.stringify({
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
  });
}
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [presets, setPresets] = useState<Preset[]>([]);
  const [assignmentStrategies, setAssignmentStrategies] = useState<AssignmentOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [publishingStages, setPublishingStages] = useState<string | null>(null);
  const [newRoute, setNewRoute] = useState({
    name: '',
    tripScope: 'regional',
    preset: 'standard',
    regionId: '',
    officeId: '',
    departmentId: '',
    supervisor: true,
    release: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/workflows', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load workflow routing');
      const loadedDefinitions = (result.data.definitions || []) as Definition[];
      setDefinitions(loadedDefinitions);
      setSavedSnapshots(
        Object.fromEntries(
          loadedDefinitions.map((definition) => [definition.id, routingSnapshot(definition)]),
        ),
      );
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function updateDefinition(id: string, patch: Partial<Definition>) {
    setDefinitions((current) =>
      current.map((definition) =>
        definition.id === id ? { ...definition, ...patch } : definition,
      ),
    );
  }

  function updateStep(definitionId: string, stepId: string, assignedUserId: string) {
    setDefinitions((current) =>
      current.map((definition) =>
        definition.id === definitionId
          ? {
              ...definition,
              steps: definition.steps.map((step) =>
                step.id === stepId
                  ? {
                      ...step,
                      assignedUserId: assignedUserId || null,
                      config: {
                        ...step.config,
                        assignmentStrategy: assignedUserId ? 'named_user' : 'permission_pool',
                      },
                    }
                  : step,
              ),
            }
          : definition,
      ),
    );
  }

  function updateStepStrategy(definitionId: string, stepId: string, strategy: string) {
    setDefinitions((current) =>
      current.map((definition) =>
        definition.id === definitionId
          ? {
              ...definition,
              steps: definition.steps.map((step) =>
                step.id === stepId
                  ? {
                      ...step,
                      assignedUserId: strategy === 'named_user' ? step.assignedUserId : null,
                      config: { ...step.config, assignmentStrategy: strategy },
                    }
                  : step,
              ),
            }
          : definition,
      ),
    );
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newRoute, actions }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to create route');
      toast({
        title: 'Approval route published',
        description: 'New requests matching this scope will use the new route.',
        variant: 'success',
      });
      setNewRoute((current) => ({ ...current, name: '' }));
      await load();
    } catch (err) {
      toast({
        title: 'Route not created',
        description: err instanceof Error ? err.message : 'Unable to create route',
        variant: 'error',
      });
    } finally {
      setCreating(false);
    }
  }

  async function toggleOptionalStage(
    definition: Definition,
    actionType: 'supervisor_approve' | 'release',
  ) {
    const currentActions = definition.steps.map((step) => step.actionType);
    const next = currentActions.includes(actionType)
      ? currentActions.filter((action) => action !== actionType)
      : [...currentActions, actionType];
    const governedOrder = [
      'supervisor_approve',
      'transport_review',
      'release',
      'authorise',
      'acknowledge',
    ];
    const actions = governedOrder.filter((action) => next.includes(action));
    setPublishingStages(definition.id);
    try {
      const response = await fetch('/api/admin/workflows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definitionId: definition.id, actions }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to publish workflow stages');
      toast({
        title: 'Workflow stages published',
        description: `Version ${result.data.version} applies to new requests; active requests keep their original route.`,
        variant: 'success',
      });
      await load();
    } catch (err) {
      toast({
        title: 'Stage update failed',
        description: err instanceof Error ? err.message : 'Try again',
        variant: 'error',
      });
    } finally {
      setPublishingStages(null);
    }
  }

  function moveStep(definitionId: string, stepId: string, direction: -1 | 1) {
    setDefinitions((current) =>
      current.map((definition) => {
        if (definition.id !== definitionId) return definition;
        const index = definition.steps.findIndex((step) => step.id === stepId);
        const targetIndex = index + direction;
        if (index < 0 || targetIndex < 0 || targetIndex >= definition.steps.length)
          return definition;
        const moving = definition.steps[index];
        const target = definition.steps[targetIndex];
        if (moving.actionType === 'acknowledge' || target.actionType === 'acknowledge')
          return definition;
        const steps = [...definition.steps];
        [steps[index], steps[targetIndex]] = [steps[targetIndex]!, steps[index]!];
        return {
          ...definition,
          steps: steps.map((step, stepIndex) => ({ ...step, stepOrder: stepIndex + 1 })),
        };
      }),
    );
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
          steps: definition.steps.map(({ id, stepOrder, assignedUserId }) => ({
            id,
            stepOrder,
            assignedUserId,
            assignmentStrategy: definition.steps.find((step) => step.id === id)?.config
              ?.assignmentStrategy,
            fallbackStrategies: definition.steps.find((step) => step.id === id)?.config
              ?.fallbackStrategies,
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save routing');
      toast({
        title: 'Approval routing published',
        description: `${definition.name} is now version ${result.data?.version ?? definition.version + 1}. In-progress requests keep their previous route.`,
        variant: 'success',
      });
      await load();
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Unable to save routing',
        variant: 'error',
      });
    } finally {
      setSaving(null);
    }
  }

  function save(definition: Definition) {
    const phrase = `UPDATE ${definition.tripScope.toUpperCase()} ROUTING`;
    confirm({
      title: `Publish ${definition.name} changes?`,
      description: `This creates version ${definition.version + 1} for new requests. In-progress requests remain on version ${definition.version}. Driver Acknowledgement stays as the final step.`,
      confirmLabel: 'Publish routing',
      variant: 'destructive',
      requireTypedConfirm: phrase,
      onConfirm: () => publish(definition),
    });
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Administration' },
          { label: 'Workflow Routing' },
        ]}
      />
      <PageHeader
        title="Workflow Routing"
        description="Arrange approval steps, configure their scope, and assign a specific eligible person where required"
      >
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void load()}
          loading={loading}
          className="w-full sm:w-auto"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Create an approval route</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-3">
            {presets.map((preset) => (
              <button
                type="button"
                key={preset.id}
                onClick={() =>
                  setNewRoute((current) => ({
                    ...current,
                    preset: preset.id,
                    supervisor: preset.actions.includes('supervisor_approve'),
                    release: preset.actions.includes('release'),
                  }))
                }
                className={`focus-ring rounded-[8px] border p-3 text-left ${newRoute.preset === preset.id ? 'border-brand-600 bg-brand-50' : 'border-border'}`}
              >
                <p className="text-ink-950 text-sm font-semibold">{preset.label}</p>
                <p className="text-ink-500 mt-1 text-xs">{preset.description}</p>
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <input
              value={newRoute.name}
              onChange={(event) =>
                setNewRoute((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Route name"
              className="border-border bg-surface text-ink-950 focus:border-brand-500 h-10 rounded-[8px] border px-3 text-sm outline-none"
            />
            <StyledSelect
              value={newRoute.tripScope}
              aria-label="Trip scope"
              onChange={(event) =>
                setNewRoute((current) => ({ ...current, tripScope: event.target.value }))
              }
            >
              <option value="regional">Regional requests</option>
              <option value="national">National requests</option>
            </StyledSelect>
            <StyledSelect
              value={newRoute.regionId}
              aria-label="Region scope"
              onChange={(event) =>
                setNewRoute((current) => ({ ...current, regionId: event.target.value }))
              }
            >
              <option value="">All regions (fallback)</option>
              {regions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </StyledSelect>
            <StyledSelect
              value={newRoute.officeId}
              aria-label="Office scope"
              onChange={(event) =>
                setNewRoute((current) => ({ ...current, officeId: event.target.value }))
              }
            >
              <option value="">All offices</option>
              {offices.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </StyledSelect>
            <StyledSelect
              value={newRoute.departmentId}
              aria-label="Department scope"
              onChange={(event) =>
                setNewRoute((current) => ({ ...current, departmentId: event.target.value }))
              }
            >
              <option value="">All departments</option>
              {departments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </StyledSelect>
            <label className="border-border flex h-10 items-center gap-2 rounded-[8px] border px-3 text-sm">
              <input
                type="checkbox"
                checked={newRoute.supervisor}
                onChange={(event) =>
                  setNewRoute((current) => ({
                    ...current,
                    preset: 'advanced',
                    supervisor: event.target.checked,
                  }))
                }
              />
              Supervisor Approval
            </label>
            <label className="border-border flex h-10 items-center gap-2 rounded-[8px] border px-3 text-sm">
              <input
                type="checkbox"
                checked={newRoute.release}
                onChange={(event) =>
                  setNewRoute((current) => ({
                    ...current,
                    preset: 'advanced',
                    release: event.target.checked,
                  }))
                }
              />
              Administrative Release
            </label>
            <Button
              onClick={() => void createRoute()}
              loading={creating}
              disabled={newRoute.name.trim().length < 3}
            >
              <Plus className="h-4 w-4" /> Create &amp; publish
            </Button>
          </div>
          <p className="text-ink-500 text-xs">
            Transport Review, Final Authorisation and terminal Driver Acknowledgement are governed
            and cannot be removed. A route with no region, office or department is the fallback.
          </p>
        </CardContent>
      </Card>

      {loading ? (
        <div
          className="text-ink-500 flex items-center justify-center gap-2 py-16 text-sm"
          role="status"
        >
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Loading approval routing…
        </div>
      ) : error ? (
        <EmptyState
          icon={<GitBranch className="h-6 w-6" />}
          title="Workflow routing unavailable"
          description={error}
          action={{ label: 'Retry', onClick: () => void load() }}
        />
      ) : definitions.length === 0 ? (
        <EmptyState
          icon={<GitBranch className="h-6 w-6" />}
          title="No workflow definitions"
          description="Workflow definitions appear here after the tenant approval workflow has been provisioned."
        />
      ) : (
        <div className="space-y-4">
          {definitions.map((definition) => {
            const isDirty = savedSnapshots[definition.id] !== routingSnapshot(definition);
            return (
              <Card key={definition.id}>
                <CardHeader className="pb-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <CardTitle className="flex min-w-0 items-center gap-2">
                      <GitBranch className="text-brand-700 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 truncate">{definition.name}</span>
                    </CardTitle>
                    <span className="text-ink-500 flex items-center gap-2 text-xs">
                      {isDirty && (
                        <Badge variant="warning" size="sm">
                          Unsaved changes
                        </Badge>
                      )}
                      <span>
                        {definition.tripScope.replace(/_/g, ' ')} · v{definition.version}
                      </span>
                      {!definition.regionId && !definition.officeId && !definition.departmentId && (
                        <Badge variant="info" size="sm">
                          Fallback route
                        </Badge>
                      )}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <section className="border-border bg-muted/30 rounded-[8px] border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-ink-950 text-sm font-semibold">
                          Advanced governed stages
                        </p>
                        <p className="text-ink-500 mt-0.5 text-xs">
                          Optional stages can be enabled without changing active request instances.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant={
                            definition.steps.some(
                              (step) => step.actionType === 'supervisor_approve',
                            )
                              ? 'primary'
                              : 'secondary'
                          }
                          size="compact"
                          loading={publishingStages === definition.id}
                          onClick={() => void toggleOptionalStage(definition, 'supervisor_approve')}
                        >
                          Supervisor Approval
                        </Button>
                        <Button
                          type="button"
                          variant={
                            definition.steps.some((step) => step.actionType === 'release')
                              ? 'primary'
                              : 'secondary'
                          }
                          size="compact"
                          loading={publishingStages === definition.id}
                          onClick={() => void toggleOptionalStage(definition, 'release')}
                        >
                          Administrative Release
                        </Button>
                      </div>
                    </div>
                  </section>
                  <section
                    aria-label={`${definition.name} scope`}
                    className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                  >
                    {(
                      [
                        ['regionId', 'All regions', regions, 'Region scope'],
                        ['officeId', 'All offices', offices, 'Office scope'],
                        ['departmentId', 'All departments', departments, 'Department scope'],
                      ] as const
                    ).map(([field, empty, options, ariaLabel]) => (
                      <StyledSelect
                        key={field}
                        value={definition[field] || ''}
                        aria-label={ariaLabel}
                        onChange={(event) =>
                          updateDefinition(definition.id, { [field]: event.target.value || null })
                        }
                      >
                        <option value="">{empty}</option>
                        {options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </StyledSelect>
                    ))}
                  </section>

                  <div className="border-border overflow-hidden rounded-[8px] border">
                    {definition.steps.map((step, stepIndex) => {
                      const eligible = step.requiredPermission
                        ? eligibleByPermission[step.requiredPermission] || []
                        : users;
                      const assigned = step.assignedUserId
                        ? users.find((person) => person.userId === step.assignedUserId)
                        : undefined;
                      const options =
                        assigned && !eligible.some((person) => person.userId === assigned.userId)
                          ? [assigned, ...eligible]
                          : eligible;
                      const selected = options.find(
                        (person) => person.userId === step.assignedUserId,
                      );

                      return (
                        <div
                          key={step.id}
                          className="border-border grid gap-3 border-b p-3 last:border-b-0 sm:p-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(18rem,1.2fr)] lg:items-center"
                        >
                          <div className="flex min-w-0 items-start gap-3">
                            <GripVertical
                              className="text-ink-300 mt-0.5 h-4 w-4 shrink-0"
                              aria-hidden="true"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-ink-950 text-sm font-medium">
                                  {step.stepOrder}. {step.label}
                                </p>
                                {step.actionType === 'acknowledge' && (
                                  <Badge variant="default" size="sm">
                                    Required final step
                                  </Badge>
                                )}
                              </div>
                              <p className="text-ink-500 mt-1 text-xs break-all">
                                {step.requiredPermission || 'Any active tenant approver'}
                              </p>
                              <div className="mt-2 flex gap-1" aria-label={`Reorder ${step.label}`}>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="compact"
                                  onClick={() => moveStep(definition.id, step.id, -1)}
                                  disabled={stepIndex === 0 || step.actionType === 'acknowledge'}
                                  aria-label={`Move ${step.label} up`}
                                >
                                  <ArrowUp className="h-3.5 w-3.5" /> Up
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="compact"
                                  onClick={() => moveStep(definition.id, step.id, 1)}
                                  disabled={
                                    stepIndex >= definition.steps.length - 2 ||
                                    step.actionType === 'acknowledge'
                                  }
                                  aria-label={`Move ${step.label} down`}
                                >
                                  <ArrowDown className="h-3.5 w-3.5" /> Down
                                </Button>
                              </div>
                            </div>
                          </div>
                          <div className="min-w-0">
                            {step.actionType !== 'acknowledge' && (
                              <StyledSelect
                                value={
                                  step.config?.assignmentStrategy ||
                                  (step.assignedUserId ? 'named_user' : 'permission_pool')
                                }
                                aria-label={`Assignment strategy for ${step.label}`}
                                onChange={(event) =>
                                  updateStepStrategy(definition.id, step.id, event.target.value)
                                }
                                className="mb-2"
                              >
                                {assignmentStrategies.map((strategy) => (
                                  <option key={strategy.id} value={strategy.id}>
                                    {strategy.label}
                                  </option>
                                ))}
                              </StyledSelect>
                            )}
                            <SearchableEntitySelect
                              value={step.assignedUserId || ''}
                              ariaLabel={`Assigned person for ${step.label}`}
                              placeholder={
                                step.config?.assignmentStrategy === 'named_user' &&
                                step.requiredPermission
                                  ? `Choose a named person · ${eligible.length} eligible`
                                  : 'Assignment resolved automatically'
                              }
                              emptyLabel="No eligible active tenant user matches this search."
                              options={options.map((person) => ({
                                id: person.userId,
                                label: person.name || person.email,
                                description: person.email,
                                searchText: `${person.name || ''} ${person.email}`,
                                status: step.requiredPermission ? 'Eligible' : 'Active tenant user',
                              }))}
                              onChange={(option) =>
                                updateStep(definition.id, step.id, option?.id || '')
                              }
                              disabled={
                                step.actionType === 'acknowledge' ||
                                step.config?.assignmentStrategy !== 'named_user'
                              }
                            />
                            <div className="text-ink-500 mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[11px]">
                              <span>
                                {step.requiredPermission
                                  ? `${eligible.length} eligible user${eligible.length === 1 ? '' : 's'}`
                                  : `${users.length} active tenant users`}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateStep(definition.id, step.id, '')}
                                disabled={!step.assignedUserId}
                                className="focus-ring text-brand-700 disabled:text-ink-300 rounded disabled:cursor-default"
                              >
                                {selected
                                  ? 'Use permission pool instead'
                                  : 'Permission pool active'}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mobile-action-bar border-border flex justify-end border-t pt-4">
                    <Button
                      onClick={() => save(definition)}
                      loading={saving === definition.id}
                      disabled={saving !== null || !isDirty}
                      className="w-full sm:w-auto"
                    >
                      <Save className="h-4 w-4" /> Save &amp; publish
                    </Button>
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
