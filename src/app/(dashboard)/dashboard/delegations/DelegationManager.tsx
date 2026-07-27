'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { StyledDateInput, StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';
import { Loader2, Plus } from 'lucide-react';

interface Option { id: string; label: string }

export function DelegationManager({ roles, employees }: { roles: Option[]; employees: Option[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  async function create(formData: FormData) {
    setBusy(true);
    const response = await fetch('/api/delegations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roleId: formData.get('roleId'),
        substantiveHolderEmployeeId: formData.get('substantiveHolderEmployeeId') || undefined,
        actingEmployeeId: formData.get('actingEmployeeId'),
        actingTitle: formData.get('actingTitle'),
        startAt: formData.get('startAt'),
        endAt: formData.get('endAt'),
        reason: formData.get('reason'),
        canApprove: formData.get('canApprove') === 'on',
        canSign: formData.get('canSign') === 'on',
      }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      toast({ title: 'Delegation not created', description: data.conflicts?.join(' · ') || data.error, variant: 'error' });
      return;
    }
    toast({ title: 'Acting appointment created', description: 'It will activate and expire automatically.', variant: 'success' });
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen((value) => !value)}><Plus className="h-4 w-4" />New appointment</Button>
      {open && (
        <Card className="mt-4">
          <CardHeader><CardTitle>Create acting appointment</CardTitle><p className="text-xs text-ink-500">The substantive position remains unchanged.</p></CardHeader>
          <CardContent>
            <form action={create} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label required>Role being covered</Label><StyledSelect name="roleId" required placeholder="Select role">{roles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</StyledSelect></div>
                <div className="space-y-1.5"><Label>Substantive holder</Label><StyledSelect name="substantiveHolderEmployeeId" placeholder="Not recorded">{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.label}</option>)}</StyledSelect></div>
                <div className="space-y-1.5"><Label required>Acting employee</Label><StyledSelect name="actingEmployeeId" required placeholder="Select employee">{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.label}</option>)}</StyledSelect></div>
                <div className="space-y-1.5"><Label required>Acting title</Label><Input name="actingTitle" placeholder="Acting Regional Director" required /></div>
                <div className="space-y-1.5"><Label required>Start</Label><StyledDateInput name="startAt" type="datetime-local" required /></div>
                <div className="space-y-1.5"><Label required>End</Label><StyledDateInput name="endAt" type="datetime-local" required /></div>
              </div>
              <div className="space-y-1.5"><Label required>Appointment reason</Label><Textarea name="reason" rows={2} required /></div>
              <div className="flex flex-wrap gap-4 rounded-[8px] border border-border p-3">
                <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" name="canApprove" className="h-4 w-4" />Can approve</label>
                <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" name="canSign" className="h-4 w-4" />Can sign</label>
              </div>
              <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save appointment</Button></div>
            </form>
          </CardContent>
        </Card>
      )}
    </>
  );
}
