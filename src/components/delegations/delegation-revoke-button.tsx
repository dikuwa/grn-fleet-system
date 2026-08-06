'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { useToast } from '@/lib/use-toast';
import { Ban } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DelegationRevokeButton({
  delegationId,
  status,
}: {
  delegationId: string;
  status: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function revoke() {
    setBusy(true);
    try {
      const res = await fetch('/api/delegations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: delegationId, action: 'revoke', reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Revoke failed');
      toast({
        title: 'Delegation revoked',
        description: 'The acting appointment has ended.',
        variant: 'success',
      });
      setOpen(false);
      setReason('');
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Revoke failed';
      toast({ title: 'Revoke failed', description: msg, variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-status-error-text hover:text-status-error-text"
      >
        <Ban className="h-3.5 w-3.5" /> Revoke
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke acting appointment?</DialogTitle>
            <DialogDescription>
              The delegation is currently <strong>{status}</strong>. Revoking ends it immediately.
              The reason is recorded in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for revoking"
            rows={4}
            autoFocus
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={busy} disabled={!reason.trim()} onClick={revoke}>
              <Ban className="h-4 w-4" /> Revoke appointment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
