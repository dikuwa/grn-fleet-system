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

  const canCancel = !nonCancellableStatuses.includes(currentStatus);

  if (!canCancel) return null;

  const handleCancel = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Failed to cancel');
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" disabled={disabled || loading}>
          <XCircle className="h-4 w-4" /> Cancel Request
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel Transport Request</DialogTitle>
          <DialogDescription>
            Are you sure you want to cancel this transport request? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <label className="block text-sm font-medium text-ink-700">
            Reason for cancellation
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional: provide a reason for cancellation..."
            className="h-24 w-full rounded-[8px] border border-border bg-surface p-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200 resize-none"
          />
          {error && (
            <p className="text-xs text-status-error-text">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={loading}>
            Keep Request
          </Button>
          <Button variant="primary" size="sm" onClick={handleCancel} loading={loading} className="bg-status-error-text hover:bg-red-700">
            <XCircle className="h-4 w-4" /> Yes, Cancel Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
