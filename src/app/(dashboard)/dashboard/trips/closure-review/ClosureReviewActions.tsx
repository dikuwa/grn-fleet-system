'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { CheckSquare, RotateCcw, CheckCircle2, Undo2, Clock3 } from 'lucide-react';

interface ClosureReviewActionsProps {
  tripId: string;
  tripStatus: string;
  hasReturnInspection: boolean;
}

type ClosureDecision = 'closed' | 'requires_correction' | 'follow_up';

export function ClosureReviewActions({
  tripId,
  tripStatus,
  hasReturnInspection,
}: ClosureReviewActionsProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [actionResult, setActionResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const submitDecision = async (decision: ClosureDecision) => {
    if (decision !== 'closed' && !reviewNotes.trim()) {
      setActionResult({
        success: false,
        message:
          decision === 'follow_up'
            ? 'Add review notes before marking the trip for follow-up.'
            : 'Add review notes before requesting correction.',
      });
      return;
    }

    setIsSubmitting(true);
    setActionResult(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          reviewNotes: reviewNotes.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to process closure review');

      if (decision === 'closed') {
        setActionResult({ success: true, message: 'Trip closed successfully' });
      } else if (decision === 'follow_up') {
        setActionResult({ success: true, message: 'Trip marked for follow-up' });
      } else {
        setActionResult({ success: true, message: 'Trip returned for correction' });
      }
      setTimeout(() => router.refresh(), 800);
    } catch (err) {
      setActionResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to process closure review',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReturnInspection = () => {
    router.push(`/dashboard/inspections/new?type=return&tripId=${tripId}`);
  };

  if (actionResult?.success) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-status-success-text">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {actionResult.message}
      </div>
    );
  }

  // Administrative closure is never available before the official return
  // inspection exists. The API enforces the same rule, but keeping the UI in
  // sync prevents Transport Officers from seeing a Close action that can only
  // return a 409. Further reconciliation gates (fuel/expenses/incidents) remain
  // server-authoritative and their exact error is surfaced if they are pending.
  const canReview = tripStatus === 'closure_review' && hasReturnInspection;

  return (
    <div className="min-w-[240px] space-y-2" onClick={(event) => event.stopPropagation()}>
      {canReview && (
        <textarea
          value={reviewNotes}
          onChange={(event) => setReviewNotes(event.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Review notes, correction details, or follow-up reason…"
          className="w-full resize-y rounded-[8px] border border-border bg-background px-2.5 py-2 text-xs text-ink-950 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-400 focus:ring-2 focus:ring-ink-200"
          aria-label="Closure review notes"
        />
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {canReview && (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                submitDecision('closed');
              }}
              loading={isSubmitting}
              className="h-7 px-2.5 text-[11px]"
            >
              <CheckSquare className="h-3 w-3" />
              Close
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                submitDecision('requires_correction');
              }}
              disabled={isSubmitting || !reviewNotes.trim()}
              className="h-7 px-2.5 text-[11px]"
            >
              <Undo2 className="h-3 w-3" />
              Request correction
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                submitDecision('follow_up');
              }}
              disabled={isSubmitting || !reviewNotes.trim()}
              className="h-7 px-2.5 text-[11px]"
            >
              <Clock3 className="h-3 w-3" />
              Follow-up
            </Button>
          </>
        )}

        {!hasReturnInspection && (
          <Button
            variant="secondary"
            size="sm"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleReturnInspection();
            }}
            className="h-7 px-2.5 text-[11px]"
          >
            <RotateCcw className="h-3 w-3" />
            Inspect
          </Button>
        )}
      </div>

      {actionResult && !actionResult.success && (
        <p className="text-[10px] text-status-error-text">{actionResult.message}</p>
      )}
    </div>
  );
}
