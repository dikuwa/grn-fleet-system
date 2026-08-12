'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  CheckSquare,
  RotateCcw,
  CheckCircle2,
  Undo2,
  Clock3,
  ArrowRight,
} from 'lucide-react';

interface ClosureReviewActionsProps {
  tripId: string;
  tripStatus: string;
  hasReturnInspection: boolean;
  reconciliationReady: boolean;
  reconciliationBlockers: string[];
}

type ClosureDecision = 'closed' | 'requires_correction' | 'follow_up';

export function ClosureReviewActions({
  tripId,
  tripStatus,
  hasReturnInspection,
  reconciliationReady,
  reconciliationBlockers,
}: ClosureReviewActionsProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [actionResult, setActionResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const submitDecision = async (decision: ClosureDecision) => {
    if (decision === 'closed' && !reconciliationReady) {
      setActionResult({
        success: false,
        message: reconciliationBlockers[0] || 'Resolve reconciliation blockers before closing.',
      });
      return;
    }
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

  const canReview = tripStatus === 'closure_review' && hasReturnInspection;
  const currentStep = !hasReturnInspection
    ? 'Complete arrival inspection'
    : reconciliationReady
      ? 'Reconciliation checks complete'
      : reconciliationBlockers[0] || 'Resolve reconciliation requirements';
  const nextStep = !hasReturnInspection
    ? 'Review fuel, expenses and incidents'
    : reconciliationReady
      ? 'Close the trip'
      : reconciliationBlockers.length > 1
        ? 'Resolve the remaining reconciliation blockers'
        : 'Close the trip';

  return (
    <div className="min-w-[240px] space-y-2" onClick={(event) => event.stopPropagation()}>
      <div className="rounded-[8px] border border-border bg-muted/30 p-2.5">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Current step
            </p>
            <p
              className={`mt-0.5 text-[11px] font-semibold leading-4 ${
                reconciliationReady
                  ? 'text-status-success-text'
                  : hasReturnInspection
                    ? 'text-status-pending-text'
                    : 'text-ink-950'
              }`}
            >
              {currentStep}
            </p>
          </div>
          <ArrowRight className="hidden h-3.5 w-3.5 text-ink-400 sm:block" aria-hidden="true" />
          <div className="min-w-0 border-t border-border pt-2 sm:border-l sm:border-t-0 sm:pl-2 sm:pt-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Next step
            </p>
            <p className="mt-0.5 text-[11px] font-semibold leading-4 text-ink-950">{nextStep}</p>
          </div>
        </div>
      </div>

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

      {canReview && !reconciliationReady && reconciliationBlockers.length > 0 && (
        <p className="text-[10px] leading-4 text-status-pending-text">
          Close blocked: {reconciliationBlockers.join(' · ')}
        </p>
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
              disabled={isSubmitting || !reconciliationReady}
              className="h-7 px-2.5 text-[11px]"
              title={
                reconciliationReady
                  ? 'Close reconciled trip'
                  : reconciliationBlockers.join('; ') || 'Reconciliation is incomplete'
              }
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
