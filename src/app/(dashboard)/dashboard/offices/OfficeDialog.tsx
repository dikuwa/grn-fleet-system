'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Plus } from 'lucide-react';
import { useToast } from '@/lib/use-toast';

export function OfficeDialog({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState('constituency_office');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/offices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), code: code.trim(), type, address: address.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create office');
      setOpen(false);
      setName('');
      setCode('');
      setAddress('');
      router.refresh();
      toast({ title: 'Office Created', description: `${name.trim()} has been added.`, variant: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create office';
      setError(msg);
      toast({ title: 'Creation Failed', description: msg, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }, [name, code, type, address, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm"><Plus className="h-4 w-4" /> Add Office</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add Office</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label required>Office Name</Label>
            <Input placeholder="e.g. Rundu Urban Constituency Office" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>Code</Label>
            <Input placeholder="e.g. RUO" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label required>Type</Label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
              <option value="head_office">Head Office</option>
              <option value="constituency_office">Constituency Office</option>
              <option value="settlement_office">Settlement Office</option>
              <option value="directorate">Directorate</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input placeholder="Physical address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          {error && <p className="text-xs text-status-error-text">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" type="submit" loading={saving}>Create Office</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
