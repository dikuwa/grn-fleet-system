'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/lib/use-toast';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
} from 'lucide-react';

interface DriverStatusActionsProps {
  employeeId: string;
  driverStatus: string;
  suspensionReason: string | null;
  employeeName: string;
}

export function DriverStatusActions({
  employeeId,
  driverStatus,
  suspensionReason,
  employeeName,
}: DriverStatusActionsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [suspendReasonOpen, setSuspendReasonOpen] = useState(false);
  const [reactivateDialogOpen, setReactivateDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');

  const isSuspended = driverStatus === 'suspended';

  const handleSuspend = async () => {
    if (!suspendReason.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/drivers/${employeeId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'suspend',
          reason: suspendReason.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to suspend driver');
      }

      toast({
        title: 'Driver Suspended',
        description: `${employeeName} has been suspended.`,
        variant: 'success',
      });
      setSuspendDialogOpen(false);
      setSuspendReason('');
      router.refresh();
    } catch (err) {
      toast({
        title: 'Suspension Failed',
        description: err instanceof Error ? err.message : 'An error occurred.',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReactivate = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/drivers/${employeeId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reactivate',
          reason: 'Manual reactivation by authorised officer',
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to reactivate driver');
      }

      toast({
        title: 'Driver Reactivated',
        description: `${employeeName} has been reactivated.`,
        variant: 'success',
      });
      setReactivateDialogOpen(false);
      router.refresh();
    } catch (err) {
      toast({
        title: 'Reactivation Failed',
        description: err instanceof Error ? err.message : 'An error occurred.',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {isSuspended ? (
        <Button
          variant="primary"
          size="sm"
          onClick={() => setReactivateDialogOpen(true)}
        >
          <CheckCircle2 className="h-4 w-4" />
          Reactivate Driver
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setSuspendDialogOpen(true)}
          className="text-status-error-text hover:text-status-error-text"
        >
          <Ban className="h-4 w-4" />
          Suspend Driver
        </Button>
      )}

      {/* Suspend confirmation dialog */}
      <ConfirmDialog
        open={suspendDialogOpen}
        onOpenChange={setSuspendDialogOpen}
        title="Suspend Driver"
        description={`Are you sure you want to suspend ${employeeName} as a driver? They will be unable to be assigned to new trips while suspended.`}        confirmLabel="Continue"
        onConfirm={() => {
          setSuspendDialogOpen(false);
          setSuspendReasonOpen(true);
        }}
        variant="destructive"
      />

      {/* Suspend reason inline dialog - shown separately */}
      <Dialog open={suspendReasonOpen} onOpenChange={setSuspendReasonOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Suspension Reason</DialogTitle>
            <DialogDescription>
              Provide a reason for suspending {employeeName} as a driver.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label htmlFor="suspend-reason" className="text-ink-500 mb-1 block text-xs font-medium">
              Reason for suspension *
            </label>
            <textarea
              id="suspend-reason"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              rows={3}
              placeholder="e.g. Expired licence, medical unfitness, disciplinary action..."
              className="border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-200 w-full rounded-[8px] border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
            <div className="flex items-start gap-2 rounded-[8px] border border-status-warning-bg bg-status-warning-bg/10 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning-text" />
              <p className="text-xs text-ink-600">
                Suspending a driver will invalidate their active licences and prevent them from being
                allocated to trips. Completed trip history will be preserved.
              </p>
            </div>
            <Button
              onClick={handleSuspend}
              disabled={!suspendReason.trim() || submitting}
              loading={submitting}
              variant="destructive"
              className="w-full"
            >
              {submitting ? 'Suspending...' : 'Confirm Suspension'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reactivate confirmation dialog */}
      <ConfirmDialog
        open={reactivateDialogOpen}
        onOpenChange={setReactivateDialogOpen}
        title="Reactivate Driver"
        description={`Reactivate ${employeeName} as an authorised driver? Reactivating will restore verified licences and make the driver available for trip assignments. Verify that the reason for prior suspension has been resolved.`}
        confirmLabel={submitting ? 'Reactivating...' : 'Reactivate Driver'}
        onConfirm={handleReactivate}
      />
    </>
  );
}
