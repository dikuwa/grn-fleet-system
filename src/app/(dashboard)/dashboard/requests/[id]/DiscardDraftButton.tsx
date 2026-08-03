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
import { Trash2 } from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { useRouter } from 'next/navigation';

interface DiscardDraftButtonProps {
  requestId: string;
  currentStatus: string;
  disabled?: boolean;
}

/**
 * Discard a draft transport request. Only visible for `draft` status.
 * Calls PATCH /api/requests/[id]/discard (server-enforced draft-only).
 */
export function DiscardDraftButton({
  requestId,
  currentStatus,
  disabled,
}: DiscardDraftButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  if (currentStatus !== 'draft') return null;

  const handleDiscard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/discard`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Failed to discard draft');
      }
      setOpen(false);
      router.refresh();
      toast({
        title: 'Draft Discarded',
        description: 'The draft transport request has been discarded.',
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to discard draft';
      setError(msg);
      toast({ title: 'Discard Failed', description: msg, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" disabled={disabled || loading}>
          <Trash2 className="h-4 w-4" /> Discard Draft
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard Draft Request</DialogTitle>
          <DialogDescription>
            This draft has not been submitted. Discarding it marks the request as
            cancelled and cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <label className="block text-sm font-medium text-ink-700">
            Reason for discarding (optional)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional: why is this draft being discarded?"
            className="h-24 w-full rounded-[8px] border border-border bg-surface p-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none"
          />
          {error && <p className="text-xs text-status-error-text">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={loading}>
            Keep Draft
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleDiscard}
            loading={loading}
            className="bg-status-error-text hover:bg-red-700"
          >
            <Trash2 className="h-4 w-4" /> Yes, Discard Draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
