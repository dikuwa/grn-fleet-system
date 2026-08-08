'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { StyledDateInput, StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';
import { Plus } from 'lucide-react';

interface Option { id: string; label: string }

export interface DelegationScopeOptions {
  offices: Option[];
  departments: Option[];
  regions: Option[];
}

export function DelegationManager({ roles, employees, scope }: { roles: Option[]; employees: Option[]; scope?: DelegationScopeOptions }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [canApprove, setCanApprove] = useState(false);
  const [canSign, setCanSign] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  async function create(formData: FormData) {
    setBusy(true);
    try {
      const response = await fetch('/api/delegations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roleId: formData.get('roleId'),
          substantiveHolderEmployeeId: formData.get('substantiveHolderEmployeeId') || undefined,
          actingEmployeeId: formData.get('actingEmployeeId'),
          actingTitle: formData.get('actingTitle'),
          officeId: formData.get('officeId') || undefined,
          departmentId: formData.get('departmentId') || undefined,
          regionId: formData.get('regionId') || undefined,
          startAt: formData.get('startAt'),
          endAt: formData.get('endAt'),
          reason: formData.get('reason'),
          canApprove,
          canSign,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.conflicts?.join(' · ') || data.error || 'Delegation not created');
      toast({ title: 'Acting appointment created', description: 'It will activate and expire automatically.', variant: 'success' });
      setOpen(false);
      setCanApprove(false);
      setCanSign(false);
      router.refresh();
    } catch (error) {
      toast({ title: 'Delegation not created', description: error instanceof Error ? error.message : 'Please review the appointment details.', variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" /> New appointment</Button>
      <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create acting appointment</DialogTitle>
            <DialogDescription>The substantive position remains unchanged. The acting authority exists only for the scheduled period and selected scope.</DialogDescription>
          </DialogHeader>
          <form action={create} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label required>Role being covered</Label><StyledSelect name="roleId" required placeholder="Select role">{roles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</StyledSelect></div>
              <div className="space-y-1.5"><Label>Substantive holder</Label><StyledSelect name="substantiveHolderEmployeeId" placeholder="Not recorded">{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.label}</option>)}</StyledSelect></div>
              <div className="space-y-1.5"><Label required>Acting employee</Label><StyledSelect name="actingEmployeeId" required placeholder="Select employee">{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.label}</option>)}</StyledSelect></div>
              <div className="space-y-1.5"><Label required>Acting title</Label><Input name="actingTitle" placeholder="Acting Regional Director" required /></div>
              {scope && <>
                <div className="space-y-1.5"><Label>Office scope</Label><StyledSelect name="officeId" placeholder="Whole organisation">{scope.offices.map((office) => <option key={office.id} value={office.id}>{office.label}</option>)}</StyledSelect></div>
                <div className="space-y-1.5"><Label>Department scope</Label><StyledSelect name="departmentId" placeholder="All departments">{scope.departments.map((department) => <option key={department.id} value={department.id}>{department.label}</option>)}</StyledSelect></div>
                <div className="space-y-1.5"><Label>Region scope</Label><StyledSelect name="regionId" placeholder="All regions">{scope.regions.map((region) => <option key={region.id} value={region.id}>{region.label}</option>)}</StyledSelect></div>
              </>}
              <div className="space-y-1.5"><Label required>Start</Label><StyledDateInput name="startAt" type="datetime-local" required /></div>
              <div className="space-y-1.5"><Label required>End</Label><StyledDateInput name="endAt" type="datetime-local" required /></div>
            </div>
            <div className="space-y-1.5"><Label required>Appointment reason</Label><Textarea name="reason" rows={3} required /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-[8px] border border-border p-3 hover:bg-muted/40"><Checkbox checked={canApprove} onCheckedChange={(checked) => setCanApprove(checked === true)} aria-label="Acting appointee can approve" /><span><span className="block text-sm font-medium text-ink-800">Can approve</span><span className="mt-0.5 block text-xs text-ink-500">Allow approval actions supported by the covered role.</span></span></label>
              <label className="flex cursor-pointer items-start gap-3 rounded-[8px] border border-border p-3 hover:bg-muted/40"><Checkbox checked={canSign} onCheckedChange={(checked) => setCanSign(checked === true)} aria-label="Acting appointee can sign" /><span><span className="block text-sm font-medium text-ink-800">Can sign</span><span className="mt-0.5 block text-xs text-ink-500">Allow official signing where the covered role permits it.</span></span></label>
            </div>
            <DialogFooter><Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button><Button type="submit" loading={busy}>Save appointment</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
