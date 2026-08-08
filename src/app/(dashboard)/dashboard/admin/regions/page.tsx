'use client';

import { useState } from 'react';
import { useLoadWithRetry } from '@/lib/use-load-with-retry';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input, FieldWrapper } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  MapPin,
  Plus,
  Loader2,
  Save,
  CheckCircle2,
  Trash2,
  Edit2,
  RefreshCw,
  GripVertical,
  XCircle,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Region {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number | null;
  createdAt: string;
  updatedAt: string;
}

export default function AdminRegionsPage() {
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Region | null>(null);
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSortOrder, setFormSortOrder] = useState('0');

  const { data, loading, error, reload } = useLoadWithRetry<{ rows: Region[] }>('/api/regions', { errorMessage: 'Failed to load regions' });
  const regions = data?.rows ?? [];

  const openCreate = () => {
    setEditingId(null);
    setFormName('');
    setFormCode('');
    setFormDescription('');
    setFormSortOrder('0');
    setFormOpen(true);
  };

  const openEdit = (region: Region) => {
    setEditingId(region.id);
    setFormName(region.name);
    setFormCode(region.code);
    setFormDescription(region.description || '');
    setFormSortOrder(String(region.sortOrder ?? 0));
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formCode.trim()) return;
    setSaving(true);
    try {
      const body = {
        name: formName.trim(),
        code: formCode.trim().toUpperCase(),
        description: formDescription.trim() || undefined,
        sortOrder: Number(formSortOrder) || 0,
      };
      const res = await fetch('/api/regions', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingId ? { ...body, id: editingId } : body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save region');
      toast({ title: editingId ? 'Region updated' : 'Region created', description: formName.trim(), variant: 'success' });
      setFormOpen(false);
      reload();
    } catch (err) {
      toast({ title: 'Failed to save region', description: err instanceof Error ? err.message : 'Failed to save region', variant: 'error' });
    } finally { setSaving(false); }
  };

  const handleDelete = async (region: Region) => {
    setDeleting(region.id);
    try {
      const res = await fetch(`/api/regions?id=${region.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to delete region');
      toast({ title: 'Region deleted', description: `${region.name} was removed.`, variant: 'success' });
      setPendingDelete(null);
      reload();
    } catch (err) {
      toast({ title: 'Region was not deleted', description: err instanceof Error ? err.message : 'Delete failed', variant: 'error' });
    } finally { setDeleting(null); }
  };

  const handleToggleActive = async (region: Region) => {
    try {
      const res = await fetch('/api/regions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: region.id, isActive: !region.isActive }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update region');
      toast({ title: region.isActive ? 'Region deactivated' : 'Region activated', description: region.name, variant: 'success' });
      reload();
    } catch (err) {
      toast({ title: 'Failed to update region', description: err instanceof Error ? err.message : 'Update failed', variant: 'error' });
    }
  };

  const activeCount = regions.filter((region) => region.isActive).length;
  const inactiveCount = regions.length - activeCount;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Administration' }, { label: 'Regions' }]} />
      <PageHeader title="Region Management" description="Manage tenant geographic regions used by workflow routing and operational records.">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={reload}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh</Button>
          <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" aria-hidden="true" /> Add region</Button>
        </div>
      </PageHeader>

      <section aria-label="Region summary" className="grid gap-3 sm:grid-cols-3">
        {[
          ['Total regions', regions.length, 'text-brand-700 dark:text-brand-300'],
          ['Active', activeCount, 'text-status-success-text'],
          ['Inactive', inactiveCount, 'text-ink-500'],
        ].map(([label, value, tone]) => <div key={String(label)} className="rounded-[10px] border border-border bg-surface p-4"><p className={`text-2xl font-semibold tabular-nums ${tone}`}>{Number(value)}</p><p className="mt-1 text-xs text-ink-500">{String(label)}</p></div>)}
      </section>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-14 text-sm text-ink-500" role="status"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading regions…</div>
      ) : error ? (
        <EmptyState icon={<MapPin className="h-6 w-6" />} title="Failed to load regions" description={error} action={{ label: 'Retry', onClick: reload }} />
      ) : regions.length === 0 ? (
        <EmptyState icon={<MapPin className="h-8 w-8" />} title="No regions defined" description="Create the first region when this tenant needs geographic routing or region-scoped operations." action={{ label: 'Add region', onClick: openCreate }} />
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
          {regions.map((region) => (
            <article key={region.id} className={`grid gap-4 border-b border-border px-4 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${!region.isActive ? 'opacity-70' : ''}`}>
              <div className="flex min-w-0 items-start gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] ${region.isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300' : 'bg-muted text-ink-400'}`}><MapPin className="h-5 w-5" aria-hidden="true" /></div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold text-ink-950">{region.name}</h2><Badge variant="info" size="sm">{region.code}</Badge><StatusBadge status={region.isActive ? 'success' : 'cancelled'} label={region.isActive ? 'Active' : 'Inactive'} /></div>
                  {region.description && <p className="mt-1 text-sm text-ink-500">{region.description}</p>}
                  {region.sortOrder != null && region.sortOrder > 0 && <p className="mt-1 flex items-center gap-1 text-xs text-ink-400"><GripVertical className="h-3 w-3" aria-hidden="true" /> Sort order {region.sortOrder}</p>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Button variant="secondary" size="compact" onClick={() => openEdit(region)}><Edit2 className="h-3.5 w-3.5" aria-hidden="true" /> Edit</Button>
                <Button variant="secondary" size="compact" onClick={() => void handleToggleActive(region)}>{region.isActive ? <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}{region.isActive ? 'Deactivate' : 'Activate'}</Button>
                <Button variant="ghost" size="compact" className="text-status-error-text" onClick={() => setPendingDelete(region)} disabled={deleting === region.id}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete</Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={(open) => { if (!saving) setFormOpen(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editingId ? 'Edit region' : 'Add region'}</DialogTitle><DialogDescription>Region codes are tenant-scoped and used by workflow and reporting surfaces.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <FieldWrapper label="Region name" required><Input value={formName} onChange={(event) => setFormName(event.target.value)} placeholder="e.g. Khomas Region" autoFocus /></FieldWrapper>
            <FieldWrapper label="Code" required><Input value={formCode} onChange={(event) => setFormCode(event.target.value.toUpperCase())} placeholder="e.g. KH" maxLength={10} /></FieldWrapper>
            <FieldWrapper label="Description"><Input value={formDescription} onChange={(event) => setFormDescription(event.target.value)} placeholder="Optional description" /></FieldWrapper>
            <FieldWrapper label="Sort order"><Input type="number" value={formSortOrder} onChange={(event) => setFormSortOrder(event.target.value)} min={0} /></FieldWrapper>
          </div>
          <DialogFooter><Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button><Button onClick={() => void handleSave()} loading={saving} disabled={!formName.trim() || !formCode.trim()}><Save className="h-4 w-4" /> {editingId ? 'Save region' : 'Create region'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Delete region?</DialogTitle><DialogDescription>{pendingDelete ? `Delete ${pendingDelete.name} only if it has no dependent workflow or operational records. If it is already in use, GovFleet will block deletion and you should deactivate it instead.` : 'This action is permanent.'}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="secondary" onClick={() => setPendingDelete(null)}>Cancel</Button><Button variant="destructive" loading={Boolean(pendingDelete && deleting === pendingDelete.id)} onClick={() => pendingDelete && void handleDelete(pendingDelete)}><Trash2 className="h-4 w-4" /> Delete region</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
