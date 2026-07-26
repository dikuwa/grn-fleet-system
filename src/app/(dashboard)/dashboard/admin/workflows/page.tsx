'use client';
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/lib/use-toast';
import { StyledSelect } from '@/components/ui/styled-select';
import { GitBranch, Save } from 'lucide-react';

type Option = { id: string; name: string };
type Person = { userId: string; name: string | null; email: string };
type Step = { id: string; stepOrder: number; label: string; requiredPermission: string | null; assignedUserId: string | null };
type Definition = { id: string; name: string; tripScope: string; version: number; regionId: string | null; officeId: string | null; departmentId: string | null; steps: Step[] };

export default function WorkflowRoutingPage() {
  const { toast } = useToast();
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [users, setUsers] = useState<Person[]>([]);
  const [offices, setOffices] = useState<Option[]>([]);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [regions, setRegions] = useState<Option[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    const response = await fetch('/api/admin/workflows');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to load workflow routing');
    setDefinitions(result.data.definitions); setUsers(result.data.users); setOffices(result.data.offices); setDepartments(result.data.departments); setRegions(result.data.regions);
  }
  useEffect(() => { load().catch((error) => toast({ title: 'Routing unavailable', description: error.message, variant: 'error' })); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function updateDefinition(id: string, patch: Partial<Definition>) { setDefinitions((current) => current.map((definition) => definition.id === id ? { ...definition, ...patch } : definition)); }
  function updateStep(definitionId: string, stepId: string, assignedUserId: string) { setDefinitions((current) => current.map((definition) => definition.id === definitionId ? { ...definition, steps: definition.steps.map((step) => step.id === stepId ? { ...step, assignedUserId: assignedUserId || null } : step) } : definition)); }
  async function save(definition: Definition) {
    setSaving(definition.id);
    try {
      const response = await fetch('/api/admin/workflows', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definitionId: definition.id, regionId: definition.regionId, officeId: definition.officeId, departmentId: definition.departmentId, steps: definition.steps.map(({ id, assignedUserId }) => ({ id, assignedUserId })) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Unable to save routing');
      toast({ title: 'Approval routing saved', description: definition.name, variant: 'success' });
    } catch (error) { toast({ title: 'Save failed', description: error instanceof Error ? error.message : 'Unable to save routing', variant: 'error' }); } finally { setSaving(null); }
  }

  return <div className="space-y-6">
    <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Administration' }, { label: 'Workflow Routing' }]} />
    <PageHeader title="Workflow Routing" description="Assign approval paths by request scope, region, office, department, step and responsible person" />
    {definitions.map((definition) => <Card key={definition.id}>
      <CardHeader><CardTitle><GitBranch className="mr-2 inline h-4 w-4" />{definition.name} · v{definition.version}</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-3">
          {([['regionId', 'All regions', regions], ['officeId', 'All offices', offices], ['departmentId', 'All departments', departments]] as const).map(([field, empty, options]) => <StyledSelect key={field} value={definition[field] || ''} onChange={(event) => updateDefinition(definition.id, { [field]: event.target.value || null })}><option value="">{empty}</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</StyledSelect>)}
        </div>
        <div className="divide-y divide-border rounded-[8px] border border-border">{definition.steps.map((step) => <div key={step.id} className="grid gap-3 p-3 md:grid-cols-[1fr_1fr] md:items-center"><div><p className="text-sm font-medium">{step.stepOrder}. {step.label}</p><p className="text-xs text-ink-500">{step.requiredPermission}</p></div><StyledSelect value={step.assignedUserId || ''} onChange={(event) => updateStep(definition.id, step.id, event.target.value)}><option value="">Permission-based pool</option>{users.map((person) => <option key={person.userId} value={person.userId}>{person.name || person.email} — {person.email}</option>)}</StyledSelect></div>)}</div>
        <div className="flex justify-end"><Button onClick={() => save(definition)} loading={saving === definition.id}><Save className="h-4 w-4" /> Save Routing</Button></div>
      </CardContent>
    </Card>)}
  </div>;
}
