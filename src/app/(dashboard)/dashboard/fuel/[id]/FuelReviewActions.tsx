'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { useToast } from '@/lib/use-toast';

export function FuelReviewActions({
  transactionId,
  anomalyState,
}: {
  transactionId: string;
  anomalyState: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState<'verify' | 'reject' | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  async function review(action: 'verify' | 'reject') {
    const reason = rejectionReason.trim();
    if (action === 'reject' && !reason) {
      toast({
        title: 'Rejection reason required',
        description: 'Record why this fuel transaction cannot be verified.',
        variant: 'error',
      });
      return;
    }

    setSubmitting(action);
    try {
      const response = await fetch('/api/fuel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, action, reason: reason || undefined }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Fuel review failed');
      toast({
        title: action === 'verify' ? 'Fuel transaction verified' : 'Fuel transaction rejected',
        description:
          action === 'verify'
            ? 'The transaction can now satisfy the fuel reconciliation gate.'
            : 'The recorded reason remains visible for correction and reconciliation.',
        variant: action === 'verify' ? 'success' : 'error',
      });
      setRejectionReason('');
      router.refresh();
    } catch (error) {
      toast({
        title: 'Unable to review fuel transaction',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'error',
      });
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="w-full max-w-xl space-y-3 rounded-[8px] border border-border bg-surface p-3 sm:w-auto">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-pending-text" />
        <div>
          <p className="text-xs font-semibold text-ink-900">Current step: review fuel evidence</p>
          <p className="text-xs text-ink-500">
            {anomalyState === 'rejected'
              ? 'This transaction was rejected previously. Verify only after the evidence has been corrected.'
              : 'Verify valid evidence, or reject it with a reason. Next: reconciliation can continue once verified.'}
          </p>
        </div>
      </div>

      <Textarea
        value={rejectionReason}
        onChange={(event) => setRejectionReason(event.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Rejection reason — required only when rejecting"
        disabled={submitting !== null}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => review('verify')} loading={submitting === 'verify'} disabled={submitting !== null}>
          <CheckCircle2 className="h-4 w-4" />
          Verify transaction
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => review('reject')}
          loading={submitting === 'reject'}
          disabled={submitting !== null || !rejectionReason.trim()}
        >
          <XCircle className="h-4 w-4" />
          Reject with reason
        </Button>
      </div>
    </div>
  );
}
