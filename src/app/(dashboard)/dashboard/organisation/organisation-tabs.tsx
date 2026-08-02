'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/lib/use-toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { suggestOrganisationCode } from '@/lib/organisation-codes';
import {
  Building2,
  Layers,
  Plus,
  Pencil,
  Archive,
  CheckCircle2,
  Users,
  MapPin,
  GitBranch,
  Trash2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrganisationOffice {
  id: string;
  name: string;
  type: string;
  code: string | null;
  address: string | null;
  parentId: string | null;
  isActive: boolean;
  parentName: string | null;
  employeeCount: number;
  deptCount: number;
}

export interface OrganisationDepartment {
  id: string;
  name: string;
  code: string | null;
  type: string;
  parentId: string | null;
  parentName: string | null;
  headEmployeeId: string | null;
  isActive: boolean;
  headName: string | null;
  staffCount: number;
  officeCount: number;
  officeNames: string | null;
  officeIds: string[];
}

interface OrganisationTabsProps {
  offices: OrganisationOffice[];
  departments: OrganisationDepartment[];
}

const OFFICE_TYPES: Record<string, string> = {
  head_office: 'Head Office',
  regional_office: 'Regional Office',
  constituency_office: 'Constituency Office',
  settlement_office: 'Settlement Office',
  satellite_office: 'Satellite Office',
  depot: 'Depot',
  workshop: 'Workshop',
  other: 'Other',
};

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        active
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
          : 'bg-muted text-ink-500 dark:text-ink-400 dark:bg-white/[0.06]',
      )}
    >
      {active ? <CheckCircle2 className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
      {active ? 'Active' : 'Archived'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Create / Edit dialogs (reuse the offices/departments APIs)
// ---------------------------------------------------------------------------

function OfficeFormDialog({
  open,
  onOpenChange,
  offices,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  offices: OrganisationOffice[];
  editing?: OrganisationOffice | null;
  onSaved: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(editing?.name ?? '');
  const [code, setCode] = useState(editing?.code ?? '');
  const [codeTouched, setCodeTouched] = useState(Boolean(editing?.code));
  const [type, setType] = useState(editing?.type ?? 'constituency_office');
  const [address, setAddress] = useState(editing?.address ?? '');
  const [parentId, setParentId] = useState(editing?.parentId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim()) return;
      setSaving(true);
      setError('');
      try {
        const body: Record<string, unknown> = {
          name: name.trim(),
          code: code.trim() || undefined,
          type,
          address: address.trim() || undefined,
          parentId: parentId || undefined,
        };
        const res = await fetch('/api/offices', {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editing ? { id: editing.id, ...body } : body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save office');
        onOpenChange(false);
        router.refresh();
        onSaved();
        toast({
          title: editing ? 'Office Updated' : 'Office Created',
          description: `${name.trim()} has been saved.`,
          variant: 'success',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to save office';
        setError(msg);
        toast({ title: 'Save Failed', description: msg, variant: 'error' });
      } finally {
        setSaving(false);
      }
    },
    [name, code, type, address, parentId, editing, onOpenChange, onSaved, router, toast],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Office' : 'Add Office'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label required>Office Name</Label>
            <Input
              placeholder="e.g. Rundu Urban Constituency Office"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!codeTouched) setCode(suggestOrganisationCode(e.target.value, 'office'));
              }}
              required
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input
                placeholder="e.g. RUO"
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeTouched(true); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label required>Type</Label>
              <StyledSelect value={type} onChange={(e) => setType(e.target.value)}>
                {Object.entries(OFFICE_TYPES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </StyledSelect>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Parent Office</Label>
            <StyledSelect value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— None —</option>
              {offices
                .filter((o) => o.id !== editing?.id && o.isActive)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </StyledSelect>
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input
              placeholder="Physical address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          {error && <p className="text-status-error-text text-xs">{error}</p>}
          <div className="mobile-action-bar flex gap-2">
            <Button variant="primary" size="sm" type="submit" loading={saving}>
              {editing ? 'Save Changes' : 'Create Office'}
            </Button>
            <Button variant="secondary" size="sm" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DepartmentFormDialog({
  open,
  onOpenChange,
  editing,
  offices,
  departments,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing?: OrganisationDepartment | null;
  offices: OrganisationOffice[];
  departments: OrganisationDepartment[];
  onSaved: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(editing?.name ?? '');
  const [code, setCode] = useState(editing?.code ?? '');
  const [codeTouched, setCodeTouched] = useState(Boolean(editing?.code));
  const [type, setType] = useState(editing?.type ?? 'department');
  const [parentId, setParentId] = useState(editing?.parentId ?? '');
  const [officeIds, setOfficeIds] = useState<string[]>(editing?.officeIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim()) return;
      setSaving(true);
      setError('');
      try {
        const body: Record<string, unknown> = { name: name.trim(), code: code.trim() || undefined, type, parentId: parentId || null, officeIds };
        const res = await fetch('/api/departments', {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editing ? { id: editing.id, ...body } : body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save department');
        onOpenChange(false);
        router.refresh();
        onSaved();
        toast({
          title: editing ? 'Department Updated' : 'Department Created',
          description: `${name.trim()} has been saved.`,
          variant: 'success',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to save department';
        setError(msg);
        toast({ title: 'Save Failed', description: msg, variant: 'error' });
      } finally {
        setSaving(false);
      }
    },
    [name, code, type, parentId, officeIds, editing, onOpenChange, onSaved, router, toast],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Organisation Unit' : 'Add Organisation Unit'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label required>Organisation Unit Name</Label>
            <Input
              placeholder="e.g. Transport and Fleet Management"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!codeTouched) setCode(suggestOrganisationCode(e.target.value, 'department'));
              }}
              required
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input placeholder="e.g. TFM" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeTouched(true); }} />
            </div>
            <div className="space-y-1.5">
              <Label required>Type</Label>
              <StyledSelect value={type} onChange={(e) => setType(e.target.value)}>
                <option value="directorate">Directorate</option>
                <option value="department">Department</option>
                <option value="unit">Unit</option>
              </StyledSelect>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Parent Unit</Label>
            <StyledSelect value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— None —</option>
              {departments.filter((item) => item.id !== editing?.id && item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </StyledSelect>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-ink-700 text-sm font-medium">Linked Offices</legend>
            <div className="border-border max-h-36 space-y-1 overflow-y-auto rounded-[8px] border p-2">
              {offices.filter((office) => office.isActive).map((office) => (
                <label key={office.id} className="hover:bg-muted flex min-h-9 cursor-pointer items-center gap-2 rounded-[6px] px-2 text-sm">
                  <input type="checkbox" checked={officeIds.includes(office.id)} onChange={(event) => setOfficeIds((current) => event.target.checked ? [...current, office.id] : current.filter((id) => id !== office.id))} />
                  <span className="min-w-0 break-words">{office.name}</span>
                </label>
              ))}
              {offices.every((office) => !office.isActive) && <p className="text-ink-500 p-2 text-xs">No active offices are available.</p>}
            </div>
          </fieldset>
          {error && <p className="text-status-error-text text-xs">{error}</p>}
          <div className="mobile-action-bar flex gap-2">
            <Button variant="primary" size="sm" type="submit" loading={saving}>
              {editing ? 'Save Changes' : 'Create Department'}
            </Button>
            <Button variant="secondary" size="sm" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OrganisationTabs({ offices, departments }: OrganisationTabsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [tab, setTab] = useState<'offices' | 'departments'>('offices');
  const [officeDialog, setOfficeDialog] = useState<{
    open: boolean;
    editing: OrganisationOffice | null;
  }>({
    open: false,
    editing: null,
  });
  const [deptDialog, setDeptDialog] = useState<{
    open: boolean;
    editing: OrganisationDepartment | null;
  }>({
    open: false,
    editing: null,
  });

  const archiveOffice = useCallback(
    async (office: OrganisationOffice) => {
      try {
        const res = await fetch('/api/offices', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: office.id, isActive: !office.isActive }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update office');
        router.refresh();
        toast({
          title: office.isActive ? 'Office Archived' : 'Office Restored',
          description: `${office.name} is now ${office.isActive ? 'archived' : 'active'}.`,
          variant: 'success',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to update office';
        toast({ title: 'Update Failed', description: msg, variant: 'error' });
      }
    },
    [router, toast],
  );

  const archiveDepartment = useCallback(
    async (dept: OrganisationDepartment) => {
      try {
        const res = await fetch('/api/departments', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: dept.id, isActive: !dept.isActive }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update department');
        router.refresh();
        toast({
          title: dept.isActive ? 'Department Archived' : 'Department Restored',
          description: `${dept.name} is now ${dept.isActive ? 'archived' : 'active'}.`,
          variant: 'success',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to update department';
        toast({ title: 'Update Failed', description: msg, variant: 'error' });
      }
    },
    [router, toast],
  );

  const deleteRecord = useCallback(async (kind: 'office' | 'department', id: string, name: string) => {
    const res = await fetch(`/api/${kind === 'office' ? 'offices' : 'departments'}/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Failed to delete ${kind}`);
    router.refresh();
    toast({
      title: data.archived ? `${kind === 'office' ? 'Office' : 'Organisation Unit'} Archived` : `${kind === 'office' ? 'Office' : 'Organisation Unit'} Deleted`,
      description: data.message || `${name} was permanently deleted because it had no references.`,
      variant: 'success',
    });
  }, [router, toast]);

  return (
    <>
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'offices' | 'departments')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="offices" className="gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> Offices
            </TabsTrigger>
            <TabsTrigger value="departments" className="gap-1.5">
              <Layers className="h-3.5 w-3.5" /> Departments &amp; Directorates
            </TabsTrigger>
          </TabsList>
          <div className="hidden items-center gap-2 md:flex">
            {tab === 'offices' ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setOfficeDialog({ open: true, editing: null })}
              >
                <Plus className="h-4 w-4" /> Add Office
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setDeptDialog({ open: true, editing: null })}
              >
                <Plus className="h-4 w-4" /> Add Department
              </Button>
            )}
          </div>
        </div>

        {/* ── Offices tab ── */}
        <TabsContent value="offices" className="mt-4">
          <div className="mb-3 flex items-center justify-start md:hidden">
            <Button
              variant="primary"
              size="sm"
              onClick={() => setOfficeDialog({ open: true, editing: null })}
            >
              <Plus className="h-4 w-4" /> Add Office
            </Button>
          </div>

          {offices.length === 0 ? (
            <div className="border-border rounded-[10px] border border-dashed p-10 text-center">
              <Building2 className="text-ink-300 mx-auto mb-2 h-8 w-8" />
              <p className="text-sm font-medium">No offices yet</p>
              <p className="text-ink-400 text-xs">
                Add your first office to begin building the structure.
              </p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="border-border bg-surface overflow-hidden rounded-[10px] border dark:bg-transparent">
                <table className="hidden w-full text-left text-sm md:table">
                  <thead className="border-border bg-muted/60 dark:bg-white/[0.04]">
                    <tr className="text-ink-500 text-xs tracking-wide uppercase">
                      <th className="px-4 py-2.5 font-medium">Office</th>
                      <th className="px-4 py-2.5 font-medium">Type</th>
                      <th className="px-4 py-2.5 font-medium">Code</th>
                      <th className="px-4 py-2.5 font-medium">Location</th>
                      <th className="px-4 py-2.5 font-medium">Parent</th>
                      <th className="px-4 py-2.5 text-center font-medium">Staff</th>
                      <th className="px-4 py-2.5 text-center font-medium">Depts</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y dark:divide-white/[0.06]">
                    {offices.map((office) => (
                      <tr key={office.id} className="hover:bg-muted/40 dark:hover:bg-white/[0.03]">
                        <td className="px-4 py-3">
                          <p className="text-ink-950 dark:text-ink-100 font-medium">
                            {office.name}
                          </p>
                          {office.address && (
                            <p className="text-ink-400 flex items-center gap-1 text-xs">
                              <MapPin className="h-3 w-3" /> {office.address}
                            </p>
                          )}
                        </td>
                        <td className="text-ink-600 dark:text-ink-300 px-4 py-3">
                          {OFFICE_TYPES[office.type] ?? office.type}
                        </td>
                        <td className="text-ink-500 px-4 py-3">{office.code ?? '—'}</td>
                        <td className="text-ink-500 px-4 py-3">{office.address ?? '—'}</td>
                        <td className="text-ink-500 px-4 py-3">{office.parentName ?? '—'}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-ink-950 dark:text-ink-100 font-semibold">
                            {office.employeeCount}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-ink-950 dark:text-ink-100 font-semibold">
                            {office.deptCount}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill active={office.isActive} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setOfficeDialog({ open: true, editing: office })}
                              className="text-ink-500 hover:bg-muted hover:text-ink-900 dark:hover:text-ink-100 flex h-8 w-8 items-center justify-center rounded-[6px] transition-colors"
                              aria-label={`Edit ${office.name}`}
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => confirm({ title: office.isActive ? 'Archive Office' : 'Restore Office', description: `${office.name} will ${office.isActive ? 'remain in historical records and be unavailable for new assignments' : 'become available for new assignments'}.`, confirmLabel: office.isActive ? 'Archive' : 'Restore', variant: office.isActive ? 'destructive' : 'default', onConfirm: () => archiveOffice(office) })}
                              className={cn(
                                'flex h-8 w-8 items-center justify-center rounded-[6px] transition-colors',
                                office.isActive
                                  ? 'text-ink-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400'
                                  : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10',
                              )}
                              aria-label={
                                office.isActive
                                  ? `Archive ${office.name}`
                                  : `Restore ${office.name}`
                              }
                              title={office.isActive ? 'Archive' : 'Restore'}
                            >
                              <Archive className="h-4 w-4" />
                            </button>
                            <button onClick={() => confirm({ title: 'Delete Office', description: `Permanently delete ${office.name} if it is unused? Referenced offices will be archived instead to preserve history.`, confirmLabel: 'Delete or Archive', variant: 'destructive', onConfirm: () => deleteRecord('office', office.id, office.name) })} className="text-ink-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400 flex h-8 w-8 items-center justify-center rounded-[6px]" aria-label={`Delete ${office.name}`} title="Delete if unused"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Mobile cards */}
                <div className="divide-border divide-y md:hidden dark:divide-white/[0.06]">
                  {offices.map((office) => (
                    <div key={office.id} className="space-y-2 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-ink-950 dark:text-ink-100 font-medium">
                            {office.name}
                          </p>
                          <p className="text-ink-400 text-xs">
                            {OFFICE_TYPES[office.type] ?? office.type}
                            {office.code ? ` · ${office.code}` : ''}
                          </p>
                        </div>
                        <StatusPill active={office.isActive} />
                      </div>
                      {office.address && (
                        <p className="text-ink-400 flex items-center gap-1 text-xs">
                          <MapPin className="h-3 w-3" /> {office.address}
                        </p>
                      )}
                      <div className="text-ink-500 flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" /> {office.employeeCount} staff
                        </span>
                        <span className="flex items-center gap-1">
                          <GitBranch className="h-3 w-3" /> {office.deptCount} depts
                        </span>
                        {office.parentName && <span>Parent: {office.parentName}</span>}
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setOfficeDialog({ open: true, editing: office })}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => confirm({ title: office.isActive ? 'Archive Office' : 'Restore Office', description: `${office.name} will ${office.isActive ? 'remain in historical records and be unavailable for new assignments' : 'become available for new assignments'}.`, confirmLabel: office.isActive ? 'Archive' : 'Restore', variant: office.isActive ? 'destructive' : 'default', onConfirm: () => archiveOffice(office) })}>
                          <Archive className="h-3.5 w-3.5" />{' '}
                          {office.isActive ? 'Archive' : 'Restore'}
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => confirm({ title: 'Delete Office', description: `Permanently delete ${office.name} if it is unused? Referenced offices will be archived instead to preserve history.`, confirmLabel: 'Delete or Archive', variant: 'destructive', onConfirm: () => deleteRecord('office', office.id, office.name) })}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── Departments tab ── */}
        <TabsContent value="departments" className="mt-4">
          <div className="mb-3 flex items-center justify-start md:hidden">
            <Button
              variant="primary"
              size="sm"
              onClick={() => setDeptDialog({ open: true, editing: null })}
            >
              <Plus className="h-4 w-4" /> Add Department
            </Button>
          </div>

          {departments.length === 0 ? (
            <div className="border-border rounded-[10px] border border-dashed p-10 text-center">
              <Layers className="text-ink-300 mx-auto mb-2 h-8 w-8" />
              <p className="text-sm font-medium">No departments yet</p>
              <p className="text-ink-400 text-xs">Add your first department or directorate.</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="border-border bg-surface overflow-hidden rounded-[10px] border dark:bg-transparent">
                <table className="hidden w-full text-left text-sm md:table">
                  <thead className="border-border bg-muted/60 dark:bg-white/[0.04]">
                    <tr className="text-ink-500 text-xs tracking-wide uppercase">
                      <th className="px-4 py-2.5 font-medium">Department / Directorate</th>
                      <th className="px-4 py-2.5 font-medium">Code</th>
                      <th className="px-4 py-2.5 font-medium">Head</th>
                      <th className="px-4 py-2.5 text-center font-medium">Staff</th>
                      <th className="px-4 py-2.5 font-medium">Offices</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y dark:divide-white/[0.06]">
                    {departments.map((dept) => (
                      <tr key={dept.id} className="hover:bg-muted/40 dark:hover:bg-white/[0.03]">
                        <td className="text-ink-950 dark:text-ink-100 px-4 py-3 font-medium">
                          <span className="block">{dept.name}</span><span className="text-ink-400 text-xs font-normal capitalize">{dept.type}{dept.parentName ? ` · ${dept.parentName}` : ''}</span>
                        </td>
                        <td className="text-ink-500 px-4 py-3">{dept.code ?? '—'}</td>
                        <td className="text-ink-600 dark:text-ink-300 px-4 py-3">
                          {dept.headName ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-ink-950 dark:text-ink-100 font-semibold">
                            {dept.staffCount}
                          </span>
                        </td>
                        <td className="text-ink-500 px-4 py-3">
                          {dept.officeCount > 0
                            ? `${dept.officeCount} office${dept.officeCount > 1 ? 's' : ''}`
                            : '—'}
                          {dept.officeNames && (
                            <span
                              className="text-ink-400 block max-w-[240px] truncate text-xs"
                              title={dept.officeNames}
                            >
                              {dept.officeNames}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill active={dept.isActive} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setDeptDialog({ open: true, editing: dept })}
                              className="text-ink-500 hover:bg-muted hover:text-ink-900 dark:hover:text-ink-100 flex h-8 w-8 items-center justify-center rounded-[6px] transition-colors"
                              aria-label={`Edit ${dept.name}`}
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => confirm({ title: dept.isActive ? 'Archive Organisation Unit' : 'Restore Organisation Unit', description: `${dept.name} will ${dept.isActive ? 'remain in historical records and be unavailable for new assignments' : 'become available for new assignments'}.`, confirmLabel: dept.isActive ? 'Archive' : 'Restore', variant: dept.isActive ? 'destructive' : 'default', onConfirm: () => archiveDepartment(dept) })}
                              className={cn(
                                'flex h-8 w-8 items-center justify-center rounded-[6px] transition-colors',
                                dept.isActive
                                  ? 'text-ink-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400'
                                  : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10',
                              )}
                              aria-label={
                                dept.isActive ? `Archive ${dept.name}` : `Restore ${dept.name}`
                              }
                              title={dept.isActive ? 'Archive' : 'Restore'}
                            >
                              <Archive className="h-4 w-4" />
                            </button>
                            <button onClick={() => confirm({ title: 'Delete Organisation Unit', description: `Permanently delete ${dept.name} if it is unused? Referenced units will be archived instead to preserve history.`, confirmLabel: 'Delete or Archive', variant: 'destructive', onConfirm: () => deleteRecord('department', dept.id, dept.name) })} className="text-ink-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400 flex h-8 w-8 items-center justify-center rounded-[6px]" aria-label={`Delete ${dept.name}`} title="Delete if unused"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Mobile cards */}
                <div className="divide-border divide-y md:hidden dark:divide-white/[0.06]">
                  {departments.map((dept) => (
                    <div key={dept.id} className="space-y-2 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-ink-950 dark:text-ink-100 font-medium">{dept.name}</p>
                          <p className="text-ink-400 text-xs capitalize">{dept.type}{dept.code ? ` · ${dept.code}` : ''}{dept.parentName ? ` · Parent: ${dept.parentName}` : ''}</p>
                        </div>
                        <StatusPill active={dept.isActive} />
                      </div>
                      <div className="text-ink-500 flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" /> {dept.staffCount} staff
                        </span>
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" /> {dept.officeCount} offices
                        </span>
                      </div>
                      {dept.headName && (
                        <p className="text-ink-500 text-xs">Head: {dept.headName}</p>
                      )}
                      {dept.officeNames && (
                        <p className="text-ink-400 text-xs">{dept.officeNames}</p>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setDeptDialog({ open: true, editing: dept })}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => confirm({ title: 'Delete Organisation Unit', description: `Permanently delete ${dept.name} if it is unused? Referenced units will be archived instead to preserve history.`, confirmLabel: 'Delete or Archive', variant: 'destructive', onConfirm: () => deleteRecord('department', dept.id, dept.name) })}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => confirm({ title: dept.isActive ? 'Archive Organisation Unit' : 'Restore Organisation Unit', description: `${dept.name} will ${dept.isActive ? 'remain in historical records and be unavailable for new assignments' : 'become available for new assignments'}.`, confirmLabel: dept.isActive ? 'Archive' : 'Restore', variant: dept.isActive ? 'destructive' : 'default', onConfirm: () => archiveDepartment(dept) })}
                        >
                          <Archive className="h-3.5 w-3.5" />{' '}
                          {dept.isActive ? 'Archive' : 'Restore'}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <OfficeFormDialog
        key={`${officeDialog.editing?.id ?? 'new-office'}-${officeDialog.open ? 'open' : 'closed'}`}
        open={officeDialog.open}
        onOpenChange={(v) => setOfficeDialog((s) => ({ ...s, open: v }))}
        offices={offices}
        editing={officeDialog.editing}
        onSaved={() => setOfficeDialog({ open: false, editing: null })}
      />
      <DepartmentFormDialog
        key={`${deptDialog.editing?.id ?? 'new-department'}-${deptDialog.open ? 'open' : 'closed'}`}
        open={deptDialog.open}
        onOpenChange={(v) => setDeptDialog((s) => ({ ...s, open: v }))}
        editing={deptDialog.editing}
        offices={offices}
        departments={departments}
        onSaved={() => setDeptDialog({ open: false, editing: null })}
      />
      {confirmDialog}
    </>
  );
}
