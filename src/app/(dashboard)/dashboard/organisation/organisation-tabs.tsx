'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/lib/use-toast';
import { cn } from '@/lib/utils';
import { Building2, Layers, Plus, Pencil, Archive, CheckCircle2, Users, MapPin, GitBranch } from 'lucide-react';

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
  headEmployeeId: string | null;
  isActive: boolean;
  headName: string | null;
  staffCount: number;
  officeCount: number;
  officeNames: string | null;
}

interface OrganisationTabsProps {
  offices: OrganisationOffice[];
  departments: OrganisationDepartment[];
}

const OFFICE_TYPES: Record<string, string> = {
  head_office: 'Head Office',
  constituency_office: 'Constituency Office',
  settlement_office: 'Settlement Office',
  directorate: 'Directorate',
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
          : 'bg-muted text-ink-500 dark:bg-white/[0.06] dark:text-ink-400',
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
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input placeholder="e.g. RUO" value={code} onChange={(e) => setCode(e.target.value)} />
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
            <Input placeholder="Physical address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          {error && <p className="text-xs text-status-error-text">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" loading={saving}>
              {editing ? 'Save Changes' : 'Create Office'}
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
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing?: OrganisationDepartment | null;
  onSaved: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(editing?.name ?? '');
  const [code, setCode] = useState(editing?.code ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim()) return;
      setSaving(true);
      setError('');
      try {
        const body: Record<string, unknown> = { name: name.trim(), code: code.trim() || undefined };
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
    [name, code, editing, onOpenChange, onSaved, router, toast],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Department' : 'Add Department'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label required>Department / Directorate Name</Label>
            <Input
              placeholder="e.g. Transport and Fleet Management"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Code</Label>
            <Input placeholder="e.g. TFM" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          {error && <p className="text-xs text-status-error-text">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" loading={saving}>
              {editing ? 'Save Changes' : 'Create Department'}
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
  const [tab, setTab] = useState<'offices' | 'departments'>('offices');
  const [officeDialog, setOfficeDialog] = useState<{ open: boolean; editing: OrganisationOffice | null }>({
    open: false,
    editing: null,
  });
  const [deptDialog, setDeptDialog] = useState<{ open: boolean; editing: OrganisationDepartment | null }>({
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
              <Button variant="primary" size="sm" onClick={() => setOfficeDialog({ open: true, editing: null })}>
                <Plus className="h-4 w-4" /> Add Office
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => setDeptDialog({ open: true, editing: null })}>
                <Plus className="h-4 w-4" /> Add Department
              </Button>
            )}
          </div>
        </div>

        {/* ── Offices tab ── */}
        <TabsContent value="offices" className="mt-4">
          <div className="mb-3 flex items-center justify-end md:hidden">
            <Button variant="primary" size="sm" onClick={() => setOfficeDialog({ open: true, editing: null })}>
              <Plus className="h-4 w-4" /> Add Office
            </Button>
          </div>

          {offices.length === 0 ? (
            <div className="border-border rounded-[10px] border border-dashed p-10 text-center">
              <Building2 className="text-ink-300 mx-auto mb-2 h-8 w-8" />
              <p className="text-sm font-medium">No offices yet</p>
              <p className="text-ink-400 text-xs">Add your first office to begin building the structure.</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="border-border overflow-hidden rounded-[10px] border bg-surface dark:bg-transparent">
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
                          <p className="text-ink-950 dark:text-ink-100 font-medium">{office.name}</p>
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
                          <span className="text-ink-950 dark:text-ink-100 font-semibold">{office.employeeCount}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-ink-950 dark:text-ink-100 font-semibold">{office.deptCount}</span>
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
                              onClick={() => archiveOffice(office)}
                              className={cn(
                                'flex h-8 w-8 items-center justify-center rounded-[6px] transition-colors',
                                office.isActive
                                  ? 'text-ink-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400'
                                  : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10',
                              )}
                              aria-label={office.isActive ? `Archive ${office.name}` : `Restore ${office.name}`}
                              title={office.isActive ? 'Archive' : 'Restore'}
                            >
                              <Archive className="h-4 w-4" />
                            </button>
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
                          <p className="text-ink-950 dark:text-ink-100 font-medium">{office.name}</p>
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
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => archiveOffice(office)}
                        >
                          <Archive className="h-3.5 w-3.5" /> {office.isActive ? 'Archive' : 'Restore'}
                        </Button>
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
          <div className="mb-3 flex items-center justify-end md:hidden">
            <Button variant="primary" size="sm" onClick={() => setDeptDialog({ open: true, editing: null })}>
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
              <div className="border-border overflow-hidden rounded-[10px] border bg-surface dark:bg-transparent">
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
                        <td className="text-ink-950 dark:text-ink-100 px-4 py-3 font-medium">{dept.name}</td>
                        <td className="text-ink-500 px-4 py-3">{dept.code ?? '—'}</td>
                        <td className="text-ink-600 dark:text-ink-300 px-4 py-3">{dept.headName ?? '—'}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-ink-950 dark:text-ink-100 font-semibold">{dept.staffCount}</span>
                        </td>
                        <td className="text-ink-500 px-4 py-3">
                          {dept.officeCount > 0 ? `${dept.officeCount} office${dept.officeCount > 1 ? 's' : ''}` : '—'}
                          {dept.officeNames && (
                            <span className="text-ink-400 block max-w-[240px] truncate text-xs" title={dept.officeNames}>
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
                              onClick={() => archiveDepartment(dept)}
                              className={cn(
                                'flex h-8 w-8 items-center justify-center rounded-[6px] transition-colors',
                                dept.isActive
                                  ? 'text-ink-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400'
                                  : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10',
                              )}
                              aria-label={dept.isActive ? `Archive ${dept.name}` : `Restore ${dept.name}`}
                              title={dept.isActive ? 'Archive' : 'Restore'}
                            >
                              <Archive className="h-4 w-4" />
                            </button>
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
                          {dept.code && <p className="text-ink-400 text-xs">{dept.code}</p>}
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
                      {dept.headName && <p className="text-ink-500 text-xs">Head: {dept.headName}</p>}
                      {dept.officeNames && <p className="text-ink-400 text-xs">{dept.officeNames}</p>}
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setDeptDialog({ open: true, editing: dept })}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => archiveDepartment(dept)}>
                          <Archive className="h-3.5 w-3.5" /> {dept.isActive ? 'Archive' : 'Restore'}
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
        onSaved={() => setDeptDialog({ open: false, editing: null })}
      />
    </>
  );
}
