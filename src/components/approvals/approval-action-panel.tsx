'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, Textarea } from '@/components/ui/input';
import { getApprovalPrimaryAction, isApprovalCommentRequired } from '@/lib/approval-decision';
import { useToast } from '@/lib/use-toast';
import { cn } from '@/lib/utils';
import { StyledSelect } from '@/components/ui/styled-select';

type DecisionResult = 'approved' | 'returned' | 'rejected';

type ApprovalActionErrorPayload = {
  error?: unknown;
  blockers?: unknown;
};

function approvalActionErrorMessage(payload: ApprovalActionErrorPayload) {
  const base = typeof payload.error === 'string' && payload.error.trim() ? payload.error.trim() : 'Action failed';
  const blockers = Array.isArray(payload.blockers)
    ? payload.blockers
        .map((blocker) => {
          if (!blocker || typeof blocker !== 'object') return null;
          const message = (blocker as { message?: unknown }).message;
          return typeof message === 'string' && message.trim() ? message.trim() : null;
        })
        .filter((message): message is string => Boolean(message))
    : [];
  return blockers.length ? `${base} ${blockers.join(' · ')}` : base;
}

export function ApprovalActionPanel({
  instanceId,
  requestTitle,
  requestReference,
  stageLabel,
  actionType,
  stepRequiresComment,
  nextStageLabel,
  isFinalStage,
}: {
  instanceId: string;
  requestTitle: string;
  requestReference: string;
  stageLabel: string;
  actionType: string;
  stepRequiresComment: boolean;
  nextStageLabel?: string | null;
  isFinalStage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const primary = getApprovalPrimaryAction(actionType);
  const isAcknowledgement = actionType === 'acknowledge';
  const isFinanceReview = actionType === 'finance_review';
  const isTransportReview = actionType === 'transport_review';
  const [selected, setSelected] = useState<DecisionResult | null>(null);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [financeOutcome, setFinanceOutcome] = useState('');
  const [budgetReference, setBudgetReference] = useState('');
  const [approvedAmount, setApprovedAmount] = useState('');
  const operationalNoteRequired = isTransportReview && selected === 'approved';
  const commentRequired = selected
    ? isApprovalCommentRequired(selected, stepRequiresComment) || operationalNoteRequired
    : stepRequiresComment;

  const handleAction = useCallback(async () => {
    if (!selected) return;
    if (isApprovalCommentRequired(selected, stepRequiresComment) && !comment.trim()) {
      setError('A reason is required for this decision.');
      return;
    }
    if (isTransportReview && selected === 'approved' && comment.trim().length < 3) {
      setError('Add an operational release note before completing Transport Review.');
      return;
    }
    if (
      isFinanceReview &&
      selected === 'approved' &&
      (!financeOutcome || budgetReference.trim().length < 3)
    ) {
      setError('Choose the Finance/Budget outcome and enter its governing budget reference.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/approvals/${instanceId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionType: selected,
          comment: comment.trim() || null,
          financeEvidence:
            isFinanceReview && selected === 'approved'
              ? {
                  outcome: financeOutcome,
                  budgetReference: budgetReference.trim(),
                  approvedAmount: approvedAmount || null,
                  currency: 'NAD',
                }
              : undefined,
        }),
      });
      const result = (await response.json()) as ApprovalActionErrorPayload & {
        data?: { message?: string };
      };
      if (!response.ok) throw new Error(approvalActionErrorMessage(result));
      const label = selected === 'approved'
        ? primary.past
        : selected === 'returned'
          ? 'returned for correction'
          : 'rejected';
      toast({
        title: isAcknowledgement ? 'Trip acknowledged' : `Request ${label}`,
        description: result.data?.message || (isAcknowledgement ? 'Your assigned trip was acknowledged.' : `The request was ${label}.`),
        variant: selected === 'rejected' ? 'error' : 'success',
      });
      router.push(`/dashboard/approvals/${instanceId}`);
      router.refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'An unexpected error occurred';
      setError(message);
      toast({ title: isAcknowledgement ? 'Acknowledgement failed' : 'Action failed', description: message, variant: 'error' });
      setIsSubmitting(false);
    }
  }, [approvedAmount, budgetReference, comment, financeOutcome, instanceId, isAcknowledgement, isFinanceReview, isTransportReview, primary.past, router, selected, stepRequiresComment, toast]);

  const decisionOptions: Array<{
    value: DecisionResult;
    label: string;
    description: string;
    icon: React.ReactNode;
    tone: string;
  }> = [
    {
      value: 'approved',
      label: primary.label,
      description: isAcknowledgement
        ? 'Confirm that you have reviewed and accept this authorised trip and vehicle assignment.'
        : isFinalStage
          ? `Complete the final ${stageLabel.toLocaleLowerCase()} decision.`
          : `Complete this stage and send the request to ${nextStageLabel || 'the next approver'}.`,
      icon: <CheckCircle2 className="h-5 w-5" aria-hidden="true" />,
      tone: 'border-status-success-bg bg-status-success-bg/25 text-status-success-text',
    },
    {
      value: 'returned',
      label: 'Return for Correction',
      description: 'Send the request back for changes. A clear reason is required.',
      icon: <ArrowLeft className="h-5 w-5" aria-hidden="true" />,
      tone: 'border-status-pending-bg bg-status-pending-bg/25 text-status-pending-text',
    },
    {
      value: 'rejected',
      label: 'Reject',
      description: 'End this workflow without approval. A rejection reason is required.',
      icon: <XCircle className="h-5 w-5" aria-hidden="true" />,
      tone: 'border-status-error-bg bg-status-error-bg/25 text-status-error-text',
    },
  ];
  const options = isAcknowledgement ? decisionOptions.slice(0, 1) : decisionOptions;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isAcknowledgement ? 'Trip Acknowledgement' : 'Your Decision'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="border-border bg-muted/40 rounded-[10px] border p-4" aria-labelledby="decision-context-title">
          <h2 id="decision-context-title" className="text-ink-950 text-sm font-semibold">
            {isAcknowledgement ? 'What you are acknowledging' : 'What you are deciding'}
          </h2>
          <p className="overflow-wrap-anywhere text-ink-950 mt-2 text-sm font-medium">{requestTitle}</p>
          <p className="overflow-wrap-anywhere text-ink-500 mt-1 text-xs">{requestReference} · {stageLabel}</p>
          <p className="text-ink-700 mt-3 text-sm">
            {isAcknowledgement
              ? 'Acknowledging confirms that you have reviewed and accept the authorised trip and assigned vehicle. If the assignment is incorrect or unsafe, do not acknowledge it; contact Transport Administration or report the relevant issue through Driver Self-Service.'
              : isFinalStage
                ? `This is the final workflow stage. ${primary.label} will complete the approval path.`
                : `${primary.label} will advance the request to ${nextStageLabel || 'the next configured stage'}.`}
          </p>
        </section>

        <fieldset className="space-y-3">
          <legend className="text-ink-500 text-xs font-semibold tracking-wider uppercase">
            {isAcknowledgement ? 'Confirm acknowledgement' : 'Choose one decision'}
          </legend>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected === option.value}
              onClick={() => {
                setSelected(option.value);
                setError('');
              }}
              disabled={isSubmitting}
              className={cn(
                'focus-ring flex min-h-14 w-full min-w-0 cursor-pointer items-start gap-3 rounded-[10px] border p-4 text-left transition-[opacity,box-shadow,transform] hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none',
                option.tone,
                selected === option.value
                  ? 'ring-brand-600 ring-2 ring-offset-2'
                  : 'opacity-80 hover:opacity-100',
              )}
            >
              <span className="mt-0.5 shrink-0" aria-hidden="true">{option.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{option.label}</span>
                <span className="text-ink-600 mt-1 block text-xs leading-5">{option.description}</span>
              </span>
            </button>
          ))}
        </fieldset>

        {isFinanceReview && selected === 'approved' && (
          <section className="border-border bg-muted/30 space-y-3 rounded-[10px] border p-4">
            <div>
              <h3 className="text-ink-950 text-sm font-semibold">Finance / Budget evidence</h3>
              <p className="text-ink-500 mt-1 text-xs">
                This evidence is stored with the governed workflow decision. Currency is NAD (N$).
              </p>
            </div>
            <div>
              <Label htmlFor="finance-outcome" required>Budget outcome</Label>
              <StyledSelect
                id="finance-outcome"
                value={financeOutcome}
                onChange={(event) => setFinanceOutcome(event.target.value)}
                disabled={isSubmitting}
              >
                <option value="">Choose an outcome</option>
                <option value="budget_available">Budget available</option>
                <option value="funding_approved_with_conditions">Funding approved with conditions</option>
                <option value="no_commitment_required">No budget commitment required</option>
              </StyledSelect>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="budget-reference" required>Budget reference</Label>
                <input
                  id="budget-reference"
                  value={budgetReference}
                  onChange={(event) => setBudgetReference(event.target.value)}
                  maxLength={120}
                  disabled={isSubmitting}
                  className="border-border bg-surface text-ink-950 mt-1 h-10 w-full rounded-[8px] border px-3 text-sm"
                />
              </div>
              <div>
                <Label htmlFor="approved-amount">Approved amount (N$)</Label>
                <input
                  id="approved-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={approvedAmount}
                  onChange={(event) => setApprovedAmount(event.target.value)}
                  disabled={isSubmitting}
                  className="border-border bg-surface text-ink-950 mt-1 h-10 w-full rounded-[8px] border px-3 text-sm"
                />
              </div>
            </div>
          </section>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="approval-comment" required={commentRequired}>
            {operationalNoteRequired
              ? 'Operational release note'
              : isAcknowledgement
                ? 'Acknowledgement note'
                : 'Decision comment'}
          </Label>
          <Textarea
            id="approval-comment"
            placeholder={
              operationalNoteRequired
                ? 'Record the operational handover: assignment, schedule checks, corrections made, and any instruction for the next stage…'
                : commentRequired
                  ? 'Explain the reason for this decision…'
                  : isAcknowledgement
                    ? 'Add an optional acknowledgement note…'
                    : 'Add an optional decision note…'
            }
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={5}
            maxLength={2000}
            aria-required={commentRequired}
            aria-describedby="approval-comment-help"
            disabled={isSubmitting}
          />
          <p id="approval-comment-help" className="text-ink-500 text-xs">
            {operationalNoteRequired
              ? 'Required before Transport Review can advance. This note is stored in the workflow history and audit record for downstream release and authorisation.'
              : commentRequired
                ? 'A comment is required and will be recorded in the audit history.'
                : isAcknowledgement
                  ? 'The note is optional and will be recorded with your acknowledgement.'
                  : 'Comments are optional and are recorded in the workflow history.'}
          </p>
        </div>

        {selected && (
          <section className="border-brand-200 bg-brand-50/60 dark:border-brand-900 dark:bg-brand-950/25 rounded-[8px] border p-3" aria-live="polite">
            <p className="text-ink-950 text-sm font-semibold">Confirmation</p>
            <p className="text-ink-700 mt-1 text-xs leading-5">
              {isAcknowledgement ? (
                <>You are confirming acceptance of this authorised trip and vehicle assignment.</>
              ) : (
                <>
                  You selected <strong>{options.find((option) => option.value === selected)?.label}</strong> for {stageLabel}.
                  {selected === 'approved'
                    ? isFinalStage
                      ? ' This will complete the workflow.'
                      : ` The request will move to ${nextStageLabel || 'the next stage'}.`
                    : selected === 'returned'
                      ? ' The requester will need to correct and resubmit the request.'
                      : ' The workflow will be cancelled.'}
                </>
              )}
            </p>
          </section>
        )}

        {error && (
          <div role="alert" className="border-status-error-bg bg-status-error-bg/20 rounded-[8px] border px-4 py-3">
            <p className="text-status-error-text text-sm font-medium">{error}</p>
          </div>
        )}

        <div className="mobile-action-bar flex flex-wrap gap-2">
          <Button
            variant={selected === 'rejected' ? 'destructive' : 'primary'}
            onClick={() => void handleAction()}
            disabled={
              !selected ||
              isSubmitting ||
              (commentRequired && comment.trim().length < (operationalNoteRequired ? 3 : 1)) ||
              (isFinanceReview &&
                selected === 'approved' &&
                (!financeOutcome || budgetReference.trim().length < 3))
            }
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {isSubmitting ? (isAcknowledgement ? 'Recording acknowledgement…' : 'Processing decision…') : isAcknowledgement ? 'Confirm Acknowledgement' : 'Confirm Decision'}
          </Button>
          <Button variant="secondary" onClick={() => router.push(`/dashboard/approvals/${instanceId}`)} disabled={isSubmitting}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}