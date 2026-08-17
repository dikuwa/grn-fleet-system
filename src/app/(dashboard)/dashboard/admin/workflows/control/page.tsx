'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Label } from '@/components/ui/input';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { useToast } from '@/lib/use-toast';
import { CheckCircle2, GitBranch, Loader2, Play, RefreshCw, ShieldCheck } from 'lucide-react';

type Definition = {
  id: string;
  name: string;
  tripScope: string;
  version: number;
  isActive: boolean;
  lifecycleStatus: string;
  config?: { validationWarnings?: string[] } | null;
};

type PreviewStep = {
  stepOrder: number;
  label: string;
  actionType: string;
  resolvedStrategy: string | null;
  assignmentStrategy: string | null;
  assignee: { name: string; email: string | null; jobTitle: string | null; availabilityStatus: string | null } | null;
  isActing: boolean;
  warning: string | null;
};

type Preview = {
  request: { reference: string; scope: string; status: string };
  workflow: { definitionVersion: number; currentStepOrder: number; status: string; isComplete: boolean };
  steps: PreviewStep[];
  warnings: string[];
};

function lifecycleVariant(status: string): 'success' | 'warning' | 'info' | 'default' {
  if (status === 'published') return 'success';
  if (status === 'validated') return 'info';
  if (status === 'draft') return 'warning';
  return 'default';
}

export default function WorkflowControlPage() {
  const { toast } = useToast();
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [exampleRequest, setExampleRequest] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/workflows/drafts', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load workflow versions');
      setDefinitions(result.data || []);
    } catch (error) {
      toast({
        title: 'Workflow versions unavailable',
        description: error instanceof Error ? error.message : 'Load failed',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createDraft(sourceDefinitionId: string) {
    setBusy(sourceDefinitionId);
    try {
      const response = await fetch('/api/admin/workflows/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceDefinitionId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to create workflow draft');
      toast({
        title: 'Workflow draft created',
        description: 'The inactive version can be validated without changing active requests.',
        variant: 'success',
      });
      await load();
    } catch (error) {
      toast({
        title: 'Draft not created',
        description: error instanceof Error ? error.message : 'Try again',
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  }

  async function lifecycleAction(definitionId: string, action: 'validate' | 'publish') {
    setBusy(definitionId);
    try {
      const response = await fetch('/api/admin/workflows/drafts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definitionId, action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Unable to ${action} workflow`);
      const warnings = result.data?.warnings as string[] | undefined;
      toast({
        title: action === 'validate' ? 'Workflow validated' : 'Workflow published',
        description:
          warnings?.length
            ? warnings.join(' ')
            : action === 'validate'
              ? 'Validation passed. Use Runtime Preview with a real submitted request before publishing.'
              : 'New matching submissions now use this version. Existing request instances are unchanged.',
        variant: warnings?.length ? 'warning' : 'success',
      });
      await load();
    } catch (error) {
      toast({
        title: action === 'validate' ? 'Validation failed' : 'Publish failed',
        description: error instanceof Error ? error.message : 'Try again',
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  }

  async function runPreview() {
    if (!exampleRequest.trim()) return;
    setPreviewing(true);
    setPreview(null);
    try {
      const response = await fetch(
        `/api/admin/workflows/preview?request=${encodeURIComponent(exampleRequest.trim())}`,
        { cache: 'no-store' },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to preview runtime routing');
      setPreview(result.data);
    } catch (error) {
      toast({
        title: 'Preview unavailable',
        description: error instanceof Error ? error.message : 'Try another submitted request',
        variant: 'error',
      });
    } finally {
      setPreviewing(false);
    }
  }

  const active = definitions.filter((definition) => definition.isActive);
  const inactive = definitions.filter((definition) => !definition.isActive);

  return (
    <div className="space-y-5 sm:space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Workflow Routing', href: '/dashboard/admin/workflows' },
          { label: 'Drafts & Preview' },
        ]}
      />
      <PageHeader
        title="Workflow Governance"
        description="Validate workflow versions and simulate the actual runtime approver resolution before activating a new route."
      >
        <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Runtime route preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-2xl space-y-1.5">
            <Label htmlFor="workflow-example">Submitted request ID or reference</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="workflow-example"
                value={exampleRequest}
                onChange={(event) => setExampleRequest(event.target.value)}
                placeholder="e.g. TR-2026-0042"
              />
              <Button
                type="button"
                onClick={() => void runPreview()}
                loading={previewing}
                disabled={!exampleRequest.trim()}
                className="sm:w-auto"
              >
                <Play className="h-4 w-4" /> Preview runtime route
              </Button>
            </div>
            <p className="text-ink-500 text-xs">
              This uses the same WorkflowEngine resolver as the live approval queue, including
              supervisors, permission pools, named people, fallbacks and acting/delegated roles.
            </p>
          </div>

          {preview && (
            <div className="space-y-3">
              <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-[8px] p-3 text-xs">
                <Badge variant="info">{preview.request.reference}</Badge>
                <span className="text-ink-600">{preview.request.scope}</span>
                <span className="text-ink-600">workflow v{preview.workflow.definitionVersion}</span>
                <span className="text-ink-600">current step {preview.workflow.currentStepOrder}</span>
              </div>
              <div className="border-border overflow-hidden rounded-[8px] border">
                {preview.steps.map((step) => (
                  <div
                    key={`${step.stepOrder}-${step.actionType}`}
                    className="border-border grid gap-2 border-b p-3 last:border-b-0 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:p-4"
                  >
                    <div>
                      <p className="text-ink-950 text-sm font-semibold">
                        {step.stepOrder}. {step.label}
                      </p>
                      <p className="text-ink-500 mt-1 text-xs">
                        {(step.resolvedStrategy || step.assignmentStrategy || 'permission pool').replaceAll('_', ' ')}
                        {step.isActing ? ' · acting/delegated' : ''}
                      </p>
                    </div>
                    <div>
                      {step.assignee ? (
                        <>
                          <p className="text-ink-900 text-sm font-medium">{step.assignee.name}</p>
                          <p className="text-ink-500 text-xs">
                            {[step.assignee.jobTitle, step.assignee.email].filter(Boolean).join(' · ')}
                          </p>
                        </>
                      ) : (
                        <p className="text-ink-600 text-sm">Resolved at runtime from the eligible pool</p>
                      )}
                      {step.warning && <p className="text-status-warning-text mt-1 text-xs">{step.warning}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workflow versions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <div className="text-ink-500 flex min-h-32 items-center justify-center gap-2 text-sm">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading workflow versions…
            </div>
          ) : definitions.length === 0 ? (
            <EmptyState
              icon={<GitBranch className="h-6 w-6" />}
              title="No workflow versions"
              description="Create the first routing definition from the Routing tab."
            />
          ) : (
            <>
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="text-status-success-text h-4 w-4" />
                  <h2 className="text-ink-950 text-sm font-semibold">Active routes</h2>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {active.map((definition) => (
                    <div key={definition.id} className="border-border rounded-[8px] border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-ink-950 text-sm font-semibold">{definition.name}</p>
                          <p className="text-ink-500 mt-1 text-xs">
                            {definition.tripScope.replaceAll('_', ' ')} · v{definition.version}
                          </p>
                        </div>
                        <Badge variant="success">Active</Badge>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="mt-3 w-full sm:w-auto"
                        onClick={() => void createDraft(definition.id)}
                        loading={busy === definition.id}
                      >
                        Create draft from this route
                      </Button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="text-brand-700 h-4 w-4" />
                  <h2 className="text-ink-950 text-sm font-semibold">Draft & historical versions</h2>
                </div>
                {inactive.length === 0 ? (
                  <p className="text-ink-500 rounded-[8px] border border-dashed p-4 text-sm">
                    No inactive versions yet. Create a draft from an active route to establish a review checkpoint before the next publication.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {inactive.map((definition) => (
                      <div
                        key={definition.id}
                        className="border-border flex flex-col gap-3 rounded-[8px] border p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-ink-950 text-sm font-semibold">{definition.name}</p>
                            <Badge variant={lifecycleVariant(definition.lifecycleStatus)}>
                              {definition.lifecycleStatus.replaceAll('_', ' ')}
                            </Badge>
                          </div>
                          <p className="text-ink-500 mt-1 text-xs">
                            {definition.tripScope.replaceAll('_', ' ')} · v{definition.version}
                          </p>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          {definition.lifecycleStatus === 'draft' && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => void lifecycleAction(definition.id, 'validate')}
                              loading={busy === definition.id}
                            >
                              Validate
                            </Button>
                          )}
                          {definition.lifecycleStatus === 'validated' && (
                            <Button
                              size="sm"
                              onClick={() => void lifecycleAction(definition.id, 'publish')}
                              loading={busy === definition.id}
                            >
                              Publish version
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
