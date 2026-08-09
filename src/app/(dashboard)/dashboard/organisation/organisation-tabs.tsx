'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusBadge } from '@/components/ui/badge';
import { StyledSelect } from '@/components/ui/styled-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/lib/use-toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { suggestOrganisationCode } from '@/lib/organisation-codes';
import {
  Archive,
  Building2,
  GitBranch,
  Layers,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';

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
  activeCount: number;
  inactiveCount: number;
  archivedCount: number;
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
  activeCount: number;
  inactiveCount: number;
  archivedCount: number;
  officeCount: number;
  officeNames: string | null;
  officeIds: string[];
}

export function StaffStatusBreakdown({
  active = 0,
  inactive = 0,
  archived = 0,
}: {
  active?: number;
  inactive?: number;
  archived?: number;
}) {
  const parts: Array<{ label: string; count: number; className: string }> = [
    { label: 'active', count: active, className: 'text-status-success-text' },
    { label: 'inactive', count: inactive, className: 'text-status-warning-text' },
    { label: 'archived', count: archived, className: 'text-ink-400' },
  ];
  const shown = parts.filter((part) => part.count > 0);
  if (shown.length === 0) return <span className="text-ink-400 text-xs">0 active</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
      {shown.map((part, index) => (
        <span key={part.label} className="flex items-center gap-1">
          {index > 0 && <span className="text-ink-300">·</span>}
          <span className={`tabular-nums font-semibold ${part.className}`}>{part.count}</span>
          <span className="text-ink-500">{part.label}</span>
        </span>
      ))}
    </span>
  );
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

function StatusPill({ active }: { active: boolean }) {
  return (
    <StatusBadge
      status={active ? 'success' : 'cancelled'}
      label={active ? 'Active' : 'Archived'}
    />
  );
}

function OfficeFormDialog({
  open,
  onOpenChange,
  offices,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
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
    async (event: React.FormEvent) => {
      event.preventDefault();
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
        const response = await fetch('/api/offices', {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editing ? { id: editing.id, ...body } : body),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to save office');
        onOpenChange(false);
        router.refresh();
        onSaved();
        toast({
          title: editing ? 'Office updated' : 'Office created',
          description: `${name.trim()} has been saved${data?.data?.code ? ` as ${data.data.code}` : ''}.`,
          variant: 'success',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save office';
        setError(message);
        toast({ title: 'Save failed', description: message, variant: 'error' });
      } finally {
        setSaving(false);
      }
    },
    [name, code, type, address, parentId, editing, onOpenChange, onSaved, router, toast],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Office' : 'Add Office'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label required>Office Name</Label>
            <Input
              placeholder="e.g. Rundu Urban Constituency Office"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!codeTouched) {
                  setCode(suggestOrganisationCode(event.target.value, 'office'));
                }
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
                onChange={(event) => {
                  setCode(event.target.value.toUpperCase());
                  setCodeTouched(true);
                }}
              />
              <p className="text-ink-500 text-[11px] leading-4">
                Generated from the name by default. New-code collisions are resolved automatically.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label required>Type</Label>
              <StyledSelect value={type} onChange={(event) => setType(event.target.value)} aria-label="Office type">
                {Object.entries(OFFICE_TYPES).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </StyledSelect>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Parent Office</Label>
            <StyledSelect value={parentId} onChange={(event) => setParentId(event.target.value)} aria-label="Parent office">
              <option value="">— None —</option>
              {offices
                .filter((office) => office.id !== editing?.id && office.isActive)
                .map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
            </StyledSelect>
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input placeholder="Physical address" value={address} onChange={(event) => setAddress(event.target.value)} />
          </div>
          {error && <p className="text-status-error-text text-xs" role="alert">{error}</p>}
          <div className="mobile-action-bar border-border flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button variant="secondary" size="sm" type="button" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">Cancel</Button>
            <Button variant="primary" size="sm" type="submit" loading={saving} className="w-full sm:w-auto">{editing ? 'Save Changes' : 'Create Office'}</Button>
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
  onOpenChange: (value: boolean) => void;
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
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!name.trim()) return;
      setSaving(true);
      setError('');
      try {
        const body: Record<string, unknown> = {
          name: name.trim(),
          code: code.trim() || undefined,
          type,
          parentId: parentId || null,
          officeIds,
        };
        const response = await fetch('/api/departments', {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editing ? { id: editing.id, ...body } : body),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to save department');
        onOpenChange(false);
        router.refresh();
        onSaved();
        toast({
          title: editing ? 'Organisation unit updated' : 'Organisation unit created',
          description: `${name.trim()} has been saved${data?.data?.code ? ` as ${data.data.code}` : ''}.`,
          variant: 'success',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save organisation unit';
        setError(message);
        toast({ title: 'Save failed', description: message, variant: 'error' });
      } finally {
        setSaving(false);
      }
    },
    [name, code, type, parentId, officeIds, editing, onOpenChange, onSaved, router, toast],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Organisation Unit' : 'Add Organisation Unit'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label required>Organisation Unit Name</Label>
            <Input
              placeholder="e.g. Transport and Fleet Management"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!codeTouched) {
                  setCode(suggestOrganisationCode(event.target.value, 'department'));
                }
              }}
              required
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input
                placeholder="e.g. TFM"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.toUpperCase());
                  setCodeTouched(true);
                }}
              />
              <p className="text-ink-500 text-[11px] leading-4">
                Generated from the name by default. New-code collisions are resolved automatically.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label required>Type</Label>
              <StyledSelect value={type} onChange={(event) => setType(event.target.value)} aria-label="Organisation unit type">
                <option value="directorate">Directorate</option>
                <option value="department">Department</option>
                <option value="unit">Unit</option>
              </StyledSelect>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Parent Unit</Label>
            <StyledSelect value={parentId} onChange={(event) => setParentId(event.target.value)} aria-label="Parent organisation unit">
              <option value="">— None —</option>
              {departments
                .filter((item) => item.id !== editing?.id && item.isActive)
                .map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </StyledSelect>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-ink-700 text-sm font-medium">Linked Offices</legend>
            <div className="border-border max-h-48 space-y-1 overflow-y-auto rounded-[8px] border p-2">
              {offices.filter((office) => office.isActive).map((office) => (
                <label key={office.id} className="hover:bg-muted flex min-h-11 cursor-pointer items-center gap-3 rounded-[6px] px-2 py-1.5 transition-colors motion-reduce:transition-none">
                  <Checkbox
                    checked={officeIds.includes(office.id)}
                    onCheckedChange={(checked) =>
                      setOfficeIds((current) =>
                        checked === true
                          ? current.includes(office.id) ? current : [...current, office.id]
                          : current.filter((id) => id !== office.id),
                      )
                    }
                    aria-label={`Link ${office.name}`}
                  />
                  <span className="text-ink-800 min-w-0 break-words text-sm">{office.name}</span>
                </label>
              ))}
              {offices.every((office) => !office.isActive) && (
                <p className="text-ink-500 p-2 text-xs">No active offices are available.</p>
              )}
            </div>
          </fieldset>
          {error && <p className="text-status-error-text text-xs" role="alert">{error}</p>}
          <div className="mobile-action-bar border-border flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button variant="secondary" size="sm" type="button" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">Cancel</Button>
            <Button variant="primary" size="sm" type="submit" loading={saving} className="w-full sm:w-auto">{editing ? 'Save Changes' : 'Create Organisation Unit'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OrganisationTabs({ offices, departments }: OrganisationTabsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [tab, setTab] = useState<'offices' | 'departments'>('offices');
  const [officeDialog, setOfficeDialog] = useState<{
    open: boolean;
    editing: OrganisationOffice | null;
  }>({ open: false, editing: null });
  const [deptDialog, setDeptDialog] = useState<{
    open: boolean;
    editing: OrganisationDepartment | null;
  }>({ open: false, editing: null });

  const archiveOffice = useCallback(
    async (office: OrganisationOffice) => {
      try {
        const response = await fetch('/api/offices', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: office.id, isActive: !office.isActive }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to update office');
        router.refresh();
        toast({
          title: office.isActive ? 'Office archived' : 'Office restored',
          description: `${office.name} is now ${office.isActive ? 'archived' : 'active'}.`,
          variant: 'success',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update office';
        toast({ title: 'Update failed', description: message, variant: 'error' });
      }
    },
    [router, toast],
  );

  const archiveDepartment = useCallback(
    async (department: OrganisationDepartment) => {
      try {
        const response = await fetch('/api/departments', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: department.id, isActive: !department.isActive }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to update organisation unit');
        router.refresh();
        toast({
          title: department.isActive ? 'Organisation unit archived' : 'Organisation unit restored',
          description: `${department.name} is now ${department.isActive ? 'archived' : 'active'}.`,
          variant: 'success',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update organisation unit';
        toast({ title: 'Update failed', description: message, variant: 'error' });
      }
    },
    [router, toast],
  );

  const deleteRecord = useCallback(
    async (kind: 'office' | 'department', id: string, name: string) => {
      const response = await fetch(`/api/${kind === 'office' ? 'offices' : 'departments'}/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Failed to delete ${kind}`);
      router.refresh();
      toast({
        title: data.archived
          ? `${kind === 'office' ? 'Office' : 'Organisation Unit'} archived`
          : `${kind === 'office' ? 'Office' : 'Organisation Unit'} deleted`,
        description: data.message || `${name} was permanently deleted because it had no references.`,
        variant: 'success',
      });
    },
    [router, toast],
  );

  const officeActionButtons = (office: OrganisationOffice, compact = false) => (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOfficeDialog({ open: true, editing: office })}
        className={compact ? 'w-full' : undefined}
      >
        <Pencil className="h-3.5 w-3.5" /> Edit
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => confirm({
          title: office.isActive ? 'Archive Office' : 'Restore Office',
          description: `${office.name} will ${office.isActive ? 'remain in historical records and be unavailable for new assignments' : 'become available for new assignments'}.`,
          confirmLabel: office.isActive ? 'Archive' : 'Restore',
          variant: office.isActive ? 'destructive' : 'default',
          onConfirm: () => archiveOffice(office),
        })}
        className={compact ? 'w-full' : undefined}
      >
        <Archive className="h-3.5 w-3.5" /> {office.isActive ? 'Archive' : 'Restore'}
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => confirm({
          title: 'Delete Office',
          description: `Permanently delete ${office.name} if it is unused? Referenced offices will be archived instead to preserve history.`,
          confirmLabel: 'Delete or Archive',
          variant: 'destructive',
          onConfirm: () => deleteRecord('office', office.id, office.name),
        })}
        className={compact ? 'col-span-2 w-full' : undefined}
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </Button>
    </>
  );

  const departmentActionButtons = (department: OrganisationDepartment, compact = false) => (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setDeptDialog({ open: true, editing: department })}
        className={compact ? 'w-full' : undefined}
      >
        <Pencil className="h-3.5 w-3.5" /> Edit
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => confirm({
          title: department.isActive ? 'Archive Organisation Unit' : 'Restore Organisation Unit',
          description: `${department.name} will ${department.isActive ? 'remain in historical records and be unavailable for new assignments' : 'become available for new assignments'}.`,
          confirmLabel: department.isActive ? 'Archive' : 'Restore',
          variant: department.isActive ? 'destructive' : 'default',
          onConfirm: () => archiveDepartment(department),
        })}
        className={compact ? 'w-full' : undefined}
      >
        <Archive className="h-3.5 w-3.5" /> {department.isActive ? 'Archive' : 'Restore'}
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => confirm({
          title: 'Delete Organisation Unit',
          description: `Permanently delete ${department.name} if it is unused? Referenced units will be archived instead to preserve history.`,
          confirmLabel: 'Delete or Archive',
          variant: 'destructive',
          onConfirm: () => deleteRecord('department', department.id, department.name),
        })}
        className={compact ? 'col-span-2 w-full' : undefined}
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </Button>
    </>
  );

  return (
    <>
      <Tabs value={tab} onValueChange={(value) => setTab(value as 'offices' | 'departments')}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <TabsList className="min-w-max">
              <TabsTrigger value="offices" className="gap-1.5">
                <Building2 className="h-3.5 w-3.5" /> Offices
              </TabsTrigger>
              <TabsTrigger value="departments" className="gap-1.5">
                <Layers className="h-3.5 w-3.5" /> Departments &amp; Directorates
              </TabsTrigger>
            </TabsList>
          </div>
          {tab === 'offices' ? (
            <Button variant="primary" size="sm" onClick={() => setOfficeDialog({ open: true, editing: null })} className="w-full sm:w-auto">
              <Plus className="h-4 w-4" /> Add Office
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setDeptDialog({ open: true, editing: null })} className="w-full sm:w-auto">
              <Plus className="h-4 w-4" /> Add Organisation Unit
            </Button>
          )}
        </div>

        <TabsContent value="offices" className="mt-4">
          {offices.length === 0 ? (
            <div className="border-border rounded-[10px] border border-dashed p-8 text-center sm:p-10">
              <Building2 className="text-ink-300 mx-auto mb-2 h-8 w-8" />
              <p className="text-ink-800 text-sm font-medium">No offices yet</p>
              <p className="text-ink-500 mt-1 text-xs">Add your first office to begin building the organisation structure.</p>
            </div>
          ) : (
            <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
              <table className="hidden w-full text-left text-sm lg:table">
                <thead className="border-border bg-muted/60 border-b">
                  <tr className="text-ink-500 text-xs tracking-wide uppercase">
                    <th className="px-4 py-2.5 font-medium">Office</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Code</th>
                    <th className="px-4 py-2.5 font-medium">Parent</th>
                    <th className="px-4 py-2.5 text-center font-medium">Staff</th>
                    <th className="px-4 py-2.5 text-center font-medium">Departments</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {offices.map((office) => (
                    <tr key={office.id} className="hover:bg-muted/30 transition-colors motion-reduce:transition-none">
                      <td className="px-4 py-3">
                        <p className="text-ink-950 font-medium">{office.name}</p>
                        {office.address && <p className="text-ink-500 mt-0.5 flex max-w-64 items-start gap-1 text-xs"><MapPin className="mt-0.5 h-3 w-3 shrink-0" /> <span className="min-w-0 break-words">{office.address}</span></p>}
                      </td>
                      <td className="text-ink-600 px-4 py-3">{OFFICE_TYPES[office.type] ?? office.type}</td>
                      <td className="text-ink-500 px-4 py-3 font-mono text-xs">{office.code ?? '—'}</td>
                      <td className="text-ink-500 px-4 py-3">{office.parentName ?? '—'}</td>
                      <td className="px-4 py-3 text-center"><div className="flex flex-col items-center gap-0.5"><span className="text-ink-950 font-semibold tabular-nums">{office.employeeCount}</span><StaffStatusBreakdown active={office.activeCount} inactive={office.inactiveCount} archived={office.archivedCount} /></div></td>
                      <td className="text-ink-950 px-4 py-3 text-center font-semibold tabular-nums">{office.deptCount}</td>
                      <td className="px-4 py-3"><StatusPill active={office.isActive} /></td>
                      <td className="px-4 py-3"><div className="flex items-center justify-end gap-1">{officeActionButtons(office)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="divide-border divide-y lg:hidden">
                {offices.map((office) => (
                  <article key={office.id} className="space-y-3 p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-ink-950 break-words font-medium">{office.name}</p>
                        <p className="text-ink-500 mt-0.5 text-xs">{OFFICE_TYPES[office.type] ?? office.type}{office.code ? ` · ${office.code}` : ''}</p>
                      </div>
                      <StatusPill active={office.isActive} />
                    </div>
                    {office.address && <p className="text-ink-500 flex min-w-0 items-start gap-1.5 text-xs"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0 break-words">{office.address}</span></p>}
                    <div className="text-ink-500 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {office.employeeCount} staff</span>
                      <StaffStatusBreakdown active={office.activeCount} inactive={office.inactiveCount} archived={office.archivedCount} />
                      <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" /> {office.deptCount} departments</span>
                      {office.parentName && <span>Parent: {office.parentName}</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">{officeActionButtons(office, true)}</div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="departments" className="mt-4">
          {departments.length === 0 ? (
            <div className="border-border rounded-[10px] border border-dashed p-8 text-center sm:p-10">
              <Layers className="text-ink-300 mx-auto mb-2 h-8 w-8" />
              <p className="text-ink-800 text-sm font-medium">No organisation units yet</p>
              <p className="text-ink-500 mt-1 text-xs">Add your first department, directorate or unit.</p>
            </div>
          ) : (
            <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
              <table className="hidden w-full text-left text-sm lg:table">
                <thead className="border-border bg-muted/60 border-b">
                  <tr className="text-ink-500 text-xs tracking-wide uppercase">
                    <th className="px-4 py-2.5 font-medium">Organisation Unit</th>
                    <th className="px-4 py-2.5 font-medium">Code</th>
                    <th className="px-4 py-2.5 font-medium">Head</th>
                    <th className="px-4 py-2.5 text-center font-medium">Staff</th>
                    <th className="px-4 py-2.5 font-medium">Offices</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {departments.map((department) => (
                    <tr key={department.id} className="hover:bg-muted/30 transition-colors motion-reduce:transition-none">
                      <td className="px-4 py-3"><span className="text-ink-950 block font-medium">{department.name}</span><span className="text-ink-500 text-xs font-normal capitalize">{department.type}{department.parentName ? ` · ${department.parentName}` : ''}</span></td>
                      <td className="text-ink-500 px-4 py-3 font-mono text-xs">{department.code ?? '—'}</td>
                      <td className="text-ink-600 px-4 py-3">{department.headName ?? '—'}</td>
                      <td className="px-4 py-3 text-center"><div className="flex flex-col items-center gap-0.5"><span className="text-ink-950 font-semibold tabular-nums">{department.staffCount}</span><StaffStatusBreakdown active={department.activeCount} inactive={department.inactiveCount} archived={department.archivedCount} /></div></td>
                      <td className="text-ink-500 px-4 py-3">{department.officeCount > 0 ? `${department.officeCount} office${department.officeCount === 1 ? '' : 's'}` : '—'}{department.officeNames && <span className="text-ink-400 block max-w-[240px] truncate text-xs" title={department.officeNames}>{department.officeNames}</span>}</td>
                      <td className="px-4 py-3"><StatusPill active={department.isActive} /></td>
                      <td className="px-4 py-3"><div className="flex items-center justify-end gap-1">{departmentActionButtons(department)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="divide-border divide-y lg:hidden">
                {departments.map((department) => (
                  <article key={department.id} className="space-y-3 p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-ink-950 break-words font-medium">{department.name}</p>
                        <p className="text-ink-500 mt-0.5 text-xs capitalize">{department.type}{department.code ? ` · ${department.code}` : ''}{department.parentName ? ` · Parent: ${department.parentName}` : ''}</p>
                      </div>
                      <StatusPill active={department.isActive} />
                    </div>
                    <div className="text-ink-500 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {department.staffCount} staff</span>
                      <StaffStatusBreakdown active={department.activeCount} inactive={department.inactiveCount} archived={department.archivedCount} />
                      <span className="flex items-center gap-1"><Building2 className="h-3 w-3" /> {department.officeCount} offices</span>
                    </div>
                    {department.headName && <p className="text-ink-500 text-xs">Head: {department.headName}</p>}
                    {department.officeNames && <p className="text-ink-400 break-words text-xs">{department.officeNames}</p>}
                    <div className="grid grid-cols-2 gap-2">{departmentActionButtons(department, true)}</div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <OfficeFormDialog
        key={`${officeDialog.editing?.id ?? 'new-office'}-${officeDialog.open ? 'open' : 'closed'}`}
        open={officeDialog.open}
        onOpenChange={(value) => setOfficeDialog((state) => ({ ...state, open: value }))}
        offices={offices}
        editing={officeDialog.editing}
        onSaved={() => setOfficeDialog({ open: false, editing: null })}
      />
      <DepartmentFormDialog
        key={`${deptDialog.editing?.id ?? 'new-department'}-${deptDialog.open ? 'open' : 'closed'}`}
        open={deptDialog.open}
        onOpenChange={(value) => setDeptDialog((state) => ({ ...state, open: value }))}
        editing={deptDialog.editing}
        offices={offices}
        departments={departments}
        onSaved={() => setDeptDialog({ open: false, editing: null })}
      />
      {confirmDialog}
    </>
  );
}
