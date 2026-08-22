'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { XCircle } from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { useRouter } from 'next/navigation';

interface CancelRequestButtonProps {
  requestId: string;
  currentStatus: string;
  disabled?: boolean;
}

const nonCancellableStatuses = ['closed', 'cancelled', 'in_progress', 'vehicle_issued'];

export function CancelRequestButton({ requestId, currentStatus, disabled }: CancelRequestButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const canCancel = !nonCancellableStatuses.includes(currentStatus);
  const cleanReason = reason.trim();
  const validReason = cleanReason.length >= 5 && cleanReason.length <= 500;

  if (!canCancel) return null;

  const handleCancel = async () => {
    if (!validReason) {
      setError('Provide a cancellation reason of at least 5 characters.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cleanReason }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Failed to cancel');
      }
      setOpen(false);
      setReason('');
      router.refresh();
      toast({ title: 'Request Cancelled', description: 'The transport request has been cancelled.', variant: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to cancel';
      setError(msg);
      toast({ title: 'Cancellation Failed', description: msg, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        setReason('');
        setError(null);
      }
    }}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" disabled={disabled || loading}>
          <XCircle className="h-4 w-4" /> Cancel Request
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel Transport Request</DialogTitle>
          <DialogDescription>
            Cancelling ends the request workflow and any unissued allocation, trip and authority. Provide a reason for the audit trail.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <label className="block text-sm font-medium text-ink-700">
            Reason for cancellation <span className="text-status-error-text" aria-hidden="true">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError(null);
            }}
            maxLength={500}
            required
            aria-required="true"
            placeholder="Explain why this request is being cancelled..."
            className="h-24 w-full resize-none rounded-[8px] border border-border bg-surface p-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600"
          />
          <div className="flex items-center justify-between gap-3 text-xs text-ink-500">
            <span>Minimum 5 characters.</span>
            <span>{reason.length}/500</span>
          </div>
          {error && (
            <p className="text-xs text-status-error-text">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={loading}>
            Keep Request
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleCancel}
            loading={loading}
            disabled={loading || !validReason}
            className="bg-status-error-text hover:bg-red-700"
          >
            <XCircle className="h-4 w-4" /> Yes, Cancel Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
