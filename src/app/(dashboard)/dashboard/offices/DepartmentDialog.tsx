'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Plus } from 'lucide-react';

export function DepartmentDialog({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), code: code.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create department');
      setOpen(false);
      setName('');
      setCode('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create department');
    } finally {
      setSaving(false);
    }
  }, [name, code, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm"><Plus className="h-4 w-4" /> Add Department</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add Department</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label required>Department Name</Label>
            <Input placeholder="e.g. Transport and Fleet Management" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>Code</Label>
            <Input placeholder="e.g. TFM" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          {error && <p className="text-xs text-status-error-text">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" type="submit" loading={saving}>Create Department</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
