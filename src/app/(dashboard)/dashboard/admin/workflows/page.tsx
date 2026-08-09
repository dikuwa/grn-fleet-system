'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchableEntitySelect } from '@/components/ui/searchable-entity-select';
import { StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';
import { GitBranch, Loader2, RefreshCw, Save } from 'lucide-react';

type Option = { id: string; name: string };
type Person = { userId: string; name: string | null; email: string };
type Step = {
  id: string;
  stepOrder: number;
  label: string;
  requiredPermission: string | null;
  assignedUserId: string | null;
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

export default function WorkflowRoutingPage() {
  const { toast } = useToast();
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [users, setUsers] = useState<Person[]>([]);
  const [eligibleByPermission, setEligibleByPermission] = useState<Record<string, Person[]>>({});
  const [offices, setOffices] = useState<Option[]>([]);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [regions, setRegions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/workflows', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load workflow routing');
      setDefinitions(result.data.definitions || []);
      setUsers(result.data.users || []);
      setEligibleByPermission(result.data.eligibleByPermission || {});
      setOffices(result.data.offices || []);
      setDepartments(result.data.departments || []);
      setRegions(result.data.regions || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load workflow routing';
      setError(message);
      toast({ title: 'Routing unavailable', description: message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateDefinition(id: string, patch: Partial<Definition>) {
    setDefinitions((current) =>
      current.map((definition) => definition.id === id ? { ...definition, ...patch } : definition),
    );
  }

  function updateStep(definitionId: string, stepId: string, assignedUserId: string) {
    setDefinitions((current) =>
      current.map((definition) =>
        definition.id === definitionId
          ? {
              ...definition,
              steps: definition.steps.map((step) =>
                step.id === stepId ? { ...step, assignedUserId: assignedUserId || null } : step,
              ),
            }
          : definition,
      ),
    );
  }

  async function save(definition: Definition) {
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
          steps: definition.steps.map(({ id, assignedUserId }) => ({ id, assignedUserId })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save routing');
      toast({ title: 'Approval routing saved', description: definition.name, variant: 'success' });
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

  return (
    <div className="space-y-5 sm:space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Administration' }, { label: 'Workflow Routing' }]} />
      <PageHeader
        title="Workflow Routing"
        description="Configure tenant approval scope and, where required, assign a specific eligible person"
      >
        <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading} className="w-full sm:w-auto">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </PageHeader>

      {loading ? (
        <div className="text-ink-500 flex items-center justify-center gap-2 py-16 text-sm" role="status">
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
          {definitions.map((definition) => (
            <Card key={definition.id}>
              <CardHeader className="pb-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="flex min-w-0 items-center gap-2">
                    <GitBranch className="text-brand-700 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">{definition.name}</span>
                  </CardTitle>
                  <span className="text-ink-500 text-xs">{definition.tripScope.replace(/_/g, ' ')} · v{definition.version}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <section aria-label={`${definition.name} scope`} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {([
                    ['regionId', 'All regions', regions, 'Region scope'],
                    ['officeId', 'All offices', offices, 'Office scope'],
                    ['departmentId', 'All departments', departments, 'Department scope'],
                  ] as const).map(([field, empty, options, ariaLabel]) => (
                    <StyledSelect
                      key={field}
                      value={definition[field] || ''}
                      aria-label={ariaLabel}
                      onChange={(event) => updateDefinition(definition.id, { [field]: event.target.value || null })}
                    >
                      <option value="">{empty}</option>
                      {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </StyledSelect>
                  ))}
                </section>

                <div className="border-border overflow-hidden rounded-[8px] border">
                  {definition.steps.map((step) => {
                    const eligible = step.requiredPermission
                      ? (eligibleByPermission[step.requiredPermission] || [])
                      : users;
                    const assigned = step.assignedUserId
                      ? users.find((person) => person.userId === step.assignedUserId)
                      : undefined;
                    const options =
                      assigned && !eligible.some((person) => person.userId === assigned.userId)
                        ? [assigned, ...eligible]
                        : eligible;
                    const selected = options.find((person) => person.userId === step.assignedUserId);

                    return (
                      <div key={step.id} className="border-border grid gap-3 border-b p-3 last:border-b-0 sm:p-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(18rem,1.2fr)] lg:items-center">
                        <div className="min-w-0">
                          <p className="text-ink-950 text-sm font-medium">{step.stepOrder}. {step.label}</p>
                          <p className="text-ink-500 mt-1 break-all text-xs">
                            {step.requiredPermission || 'Any active tenant approver'}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <SearchableEntitySelect
                            value={step.assignedUserId || ''}
                            ariaLabel={`Assigned person for ${step.label}`}
                            placeholder={step.requiredPermission ? `Permission-based pool · ${eligible.length} eligible` : 'Permission-based pool'}
                            emptyLabel="No eligible active tenant user matches this search."
                            options={options.map((person) => ({
                              id: person.userId,
                              label: person.name || person.email,
                              description: person.email,
                              searchText: `${person.name || ''} ${person.email}`,
                              status: step.requiredPermission ? 'Eligible' : 'Active tenant user',
                            }))}
                            onChange={(option) => updateStep(definition.id, step.id, option?.id || '')}
                          />
                          <div className="text-ink-500 mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[11px]">
                            <span>{step.requiredPermission ? `${eligible.length} eligible user${eligible.length === 1 ? '' : 's'}` : `${users.length} active tenant users`}</span>
                            <button
                              type="button"
                              onClick={() => updateStep(definition.id, step.id, '')}
                              disabled={!step.assignedUserId}
                              className="focus-ring rounded text-brand-700 disabled:cursor-default disabled:text-ink-300"
                            >
                              {selected ? 'Use permission pool instead' : 'Permission pool active'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mobile-action-bar border-border flex justify-end border-t pt-4">
                  <Button
                    onClick={() => void save(definition)}
                    loading={saving === definition.id}
                    disabled={saving !== null}
                    className="w-full sm:w-auto"
                  >
                    <Save className="h-4 w-4" /> Save Routing
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
