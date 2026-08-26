'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpenCheck, ExternalLink, Loader2, Plus } from 'lucide-react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/lib/use-toast';

type RegisterEntry = {
  id: string;
  title: string;
  instrumentType: string;
  citation: string;
  sourceUrl: string | null;
  status: string;
  effectiveDate: string | null;
  applicability: string;
  responsibleOffice: string | null;
  reviewDueDate: string | null;
  notes: string | null;
};

const EMPTY = {
  title: '', instrumentType: 'Act', citation: '', sourceUrl: '', status: 'in_force',
  effectiveDate: '', applicability: '', responsibleOffice: '', reviewDueDate: '', notes: '',
};

export default function LegalPolicyRegisterPage() {
  const [entries, setEntries] = useState<RegisterEntry[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<RegisterEntry | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/legal-policy');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Register could not be loaded.');
      setEntries(payload.data || []);
      setCanManage(Boolean(payload.canManage));
    } catch (error) {
      toast({ title: 'Legal register unavailable', description: error instanceof Error ? error.message : 'Register could not be loaded.', variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  function openEntry(entry?: RegisterEntry) {
    setEditing(entry ?? null);
    setForm(entry ? {
      title: entry.title, instrumentType: entry.instrumentType, citation: entry.citation,
      sourceUrl: entry.sourceUrl || '', status: entry.status, effectiveDate: entry.effectiveDate || '',
      applicability: entry.applicability, responsibleOffice: entry.responsibleOffice || '',
      reviewDueDate: entry.reviewDueDate || '', notes: entry.notes || '',
    } : EMPTY);
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/legal-policy', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, id: editing?.id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Entry could not be saved.');
      setOpen(false);
      toast({ title: editing ? 'Register entry updated' : 'Register entry created', description: `${form.citation} is recorded with an audit trail.` });
      await load();
    } catch (error) {
      toast({ title: 'Save failed', description: error instanceof Error ? error.message : 'Entry could not be saved.', variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Legal & Policy Register' }]} />
      <PageHeader title="Legal & Policy Register" description="Tenant-owned statutory instruments and internal policies, with source, status, applicability and review dates.">
        {canManage && <Button size="sm" onClick={() => openEntry()}><Plus className="h-4 w-4" /> Add entry</Button>}
      </PageHeader>

      <Card>
        <CardContent className="pt-5 text-sm text-ink-700">
          Operational checks are evidence, not blanket legal-compliance claims. The register identifies the governing source and review responsibility; legal interpretation remains with the organisation’s authorised advisers.
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>
      ) : entries.length === 0 ? (
        <EmptyState icon={<BookOpenCheck className="h-6 w-6" />} title="No register entries" description="Add the statutory instruments and internal policies governing this tenant’s fleet operations." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {entries.map((entry) => (
            <Card key={entry.id}>
              <CardHeader><CardTitle className="flex items-start justify-between gap-3"><span>{entry.title}</span><Badge variant={entry.status === 'in_force' ? 'success' : entry.status === 'uncommenced' ? 'pending' : 'info'}>{entry.status.replace(/_/g, ' ')}</Badge></CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div><p className="font-medium text-ink-950">{entry.citation}</p><p className="text-xs text-ink-500">{entry.instrumentType}{entry.effectiveDate ? ` · effective ${formatDate(entry.effectiveDate)}` : ''}</p></div>
                <p className="text-ink-700">{entry.applicability}</p>
                {entry.responsibleOffice && <p className="text-xs text-ink-500">Responsible office: {entry.responsibleOffice}</p>}
                {entry.reviewDueDate && <p className="text-xs text-ink-500">Review due: {formatDate(entry.reviewDueDate)}</p>}
                <div className="flex flex-wrap gap-2">
                  {entry.sourceUrl && <Button variant="secondary" size="compact" asChild><a href={entry.sourceUrl} target="_blank" rel="noreferrer">Authoritative source <ExternalLink className="h-3.5 w-3.5" /></a></Button>}
                  {canManage && <Button variant="secondary" size="compact" onClick={() => openEntry(entry)}>Edit</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? 'Edit register entry' : 'Add register entry'}</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><Label required>Title</Label><Input value={form.title} onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label required>Instrument type</Label><Input value={form.instrumentType} onChange={(event) => setForm((value) => ({ ...value, instrumentType: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label required>Citation</Label><Input value={form.citation} onChange={(event) => setForm((value) => ({ ...value, citation: event.target.value }))} placeholder="Act 22 of 1999" /></div>
            <div className="space-y-1.5"><Label>Status</Label><StyledSelect value={form.status} onChange={(event) => setForm((value) => ({ ...value, status: event.target.value }))}><option value="in_force">In force</option><option value="uncommenced">Uncommenced</option><option value="repealed">Repealed</option><option value="internal_policy">Internal policy</option></StyledSelect></div>
            <div className="space-y-1.5"><Label>Effective date</Label><Input type="date" value={form.effectiveDate} onChange={(event) => setForm((value) => ({ ...value, effectiveDate: event.target.value }))} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>Authoritative source URL</Label><Input type="url" value={form.sourceUrl} onChange={(event) => setForm((value) => ({ ...value, sourceUrl: event.target.value }))} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label required>Applicability</Label><Textarea value={form.applicability} onChange={(event) => setForm((value) => ({ ...value, applicability: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Responsible office</Label><Input value={form.responsibleOffice} onChange={(event) => setForm((value) => ({ ...value, responsibleOffice: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Review due</Label><Input type="date" value={form.reviewDueDate} onChange={(event) => setForm((value) => ({ ...value, reviewDueDate: event.target.value }))} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(event) => setForm((value) => ({ ...value, notes: event.target.value }))} /></div>
          </div>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={saving} disabled={saving} onClick={() => void save()}>Save entry</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
