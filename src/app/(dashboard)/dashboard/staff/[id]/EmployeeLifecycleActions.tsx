'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';
import { Archive, RotateCcw, Save } from 'lucide-react';
import { Textarea } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function EmployeeLifecycleActions({ employeeId, archived }: { employeeId: string; archived: boolean }) {
  const [availability, setAvailability] = useState('available');
  const [busy, setBusy] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const router = useRouter();
  const { toast } = useToast();

  async function update(payload: Record<string, unknown>) {
    setBusy(true);
    const response = await fetch(`/api/employees/${employeeId}/lifecycle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return toast({ title: 'Employee not updated', description: data.error, variant: 'error' });
    toast({ title: 'Employee updated', variant: 'success' });
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!archived && (
        <>
          <StyledSelect value={availability} onChange={(event) => setAvailability(event.target.value)} aria-label="Availability status">
            <option value="available">Available</option>
            <option value="annual_leave">Annual leave</option>
            <option value="sick_leave">Sick leave</option>
            <option value="official_travel">Official travel</option>
            <option value="training">Training</option>
            <option value="off_duty">Off duty</option>
            <option value="temporarily_unavailable">Temporarily unavailable</option>
          </StyledSelect>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => update({ action: 'availability', status: availability, reason: 'Updated from employee profile' })}><Save className="h-4 w-4" />Set availability</Button>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => setArchiveOpen(true)}><Archive className="h-4 w-4" />Archive</Button>
        </>
      )}
      {archived && <Button size="sm" disabled={busy} onClick={() => update({ action: 'restore', reason: 'Restored by authorised administrator' })}><RotateCcw className="h-4 w-4" />Restore employee</Button>}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Archive employee?</DialogTitle>
            <DialogDescription>
              Access and active assignments will be disabled. Record the reason for the audit trail.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={archiveReason}
            onChange={(event) => setArchiveReason(event.target.value)}
            placeholder="Reason for archiving"
            rows={4}
            autoFocus
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setArchiveOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              loading={busy}
              disabled={!archiveReason.trim()}
              onClick={async () => {
                await update({ action: 'archive', reason: archiveReason.trim() });
                setArchiveOpen(false);
                setArchiveReason('');
              }}
            >
              <Archive className="h-4 w-4" /> Archive employee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
