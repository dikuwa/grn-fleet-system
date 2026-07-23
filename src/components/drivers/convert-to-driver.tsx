'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { Car, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/lib/use-toast';

export function ConvertToDriver({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ licenceNumber: '', licenceClass: 'B', issueDate: '', expiryDate: '', internalAuthorisationRef: '', allowedVehicleCategories: '', verified: false });

  async function submit() {
    setSaving(true);
    try {
      const response = await fetch('/api/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId,
          ...form,
          verificationStatus: form.verified ? 'verified' : 'pending',
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to create driver profile');
      toast({ title: 'Driver profile created', description: `${employeeName} can now be managed as a driver.`, variant: 'success' });
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast({ title: 'Driver conversion failed', description: error instanceof Error ? error.message : 'Unable to create driver profile', variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}><Car className="h-4 w-4" /> Make Driver</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Convert {employeeName} to Driver</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label required>Licence Number</Label><Input value={form.licenceNumber} onChange={(event) => setForm({ ...form, licenceNumber: event.target.value })} /></div>
            <div className="space-y-1.5"><Label required>Licence Class</Label><Input value={form.licenceClass} onChange={(event) => setForm({ ...form, licenceClass: event.target.value })} /></div>
            <div className="space-y-1.5"><Label required>Issue Date</Label><Input type="date" value={form.issueDate} onChange={(event) => setForm({ ...form, issueDate: event.target.value })} /></div>
            <div className="space-y-1.5"><Label required>Expiry Date</Label><Input type="date" value={form.expiryDate} onChange={(event) => setForm({ ...form, expiryDate: event.target.value })} /></div>
            <div className="space-y-1.5"><Label>Authorisation Reference</Label><Input value={form.internalAuthorisationRef} onChange={(event) => setForm({ ...form, internalAuthorisationRef: event.target.value })} /></div>
            <div className="space-y-1.5"><Label>Vehicle Categories</Label><Input placeholder="Sedan, bakkie" value={form.allowedVehicleCategories} onChange={(event) => setForm({ ...form, allowedVehicleCategories: event.target.value })} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={form.verified} onChange={(event) => setForm({ ...form, verified: event.target.checked })} /> Licence evidence has been verified</label>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit} loading={saving} disabled={!form.licenceNumber || !form.licenceClass || !form.issueDate || !form.expiryDate}><CheckCircle2 className="h-4 w-4" /> Create Driver</Button></div>
        </DialogContent>
      </Dialog>
    </>
  );
}
