'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Download, Mail, MessageCircle, Printer, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/lib/use-toast';
import { printPdfFromUrl } from '@/lib/print-pdf';

type AmendmentState = {
  pending: boolean;
  driverKind: 'internal' | 'external' | 'unassigned';
  canSelfAcknowledge: boolean;
  canRecordExternal: boolean;
  externalEligibilityError?: string | null;
  amendment?: {
    id: string;
    amendmentType?: string;
    authorityVersion: number;
    reason: string;
    createdAt: string;
  } | null;
};

type DriverReplacementDecisionState = {
  pending: boolean;
  amendment?: {
    id: string;
    reason: string;
    version: number;
    createdAt: string;
    replacementDriver: {
      id: string;
      name: string;
      employeeNumber: string;
    } | null;
  } | null;
};

function amendmentLabel(type?: string) {
  if (!type) return 'material amendment';
  return type.replaceAll('_', ' ');
}

export function AuthorityActions({
  tripId,
  verificationUrl,
  canDistribute = false,
}: {
  tripId: string;
  verificationUrl?: string;
  canDistribute?: boolean;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [amendmentState, setAmendmentState] = useState<AmendmentState | null>(null);
  const [replacementDecision, setReplacementDecision] = useState<DriverReplacementDecisionState | null>(null);
  const [working, setWorking] = useState(false);
  const [decisionWorking, setDecisionWorking] = useState(false);
  const [externalDialogOpen, setExternalDialogOpen] = useState(false);
  const [acceptanceMethod, setAcceptanceMethod] = useState('');
  const [note, setNote] = useState('');
  const [decisionComment, setDecisionComment] = useState('');
  const shareText = `Official GRN Fleet Trip Authority verification: ${verificationUrl ?? ''}`;

  const refreshAmendmentState = useCallback(async () => {
    try {
      const response = await fetch(`/api/trips/${tripId}/amendment-acceptance`, { cache: 'no-store' });
      if (!response.ok) return;
      setAmendmentState((await response.json()) as AmendmentState);
    } catch {
      // The authority remains usable for viewing even if this optional action-state lookup fails.
    }
  }, [tripId]);

  const refreshReplacementDecision = useCallback(async () => {
    try {
      const response = await fetch(`/api/trips/${tripId}/authority/driver-replacement`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        setReplacementDecision(null);
        return;
      }
      setReplacementDecision((await response.json()) as DriverReplacementDecisionState);
    } catch {
      setReplacementDecision(null);
    }
  }, [tripId]);

  useEffect(() => {
    void refreshAmendmentState();
    void refreshReplacementDecision();
  }, [refreshAmendmentState, refreshReplacementDecision]);

  const copy = async () => {
    await navigator.clipboard.writeText(verificationUrl ?? window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const acknowledgeAmendment = async (method?: string) => {
    setWorking(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/amendment-acceptance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acceptanceMethod: method,
          note: note.trim() || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not acknowledge revised authority');
      toast({
        title: 'Revised authority acknowledged',
        description: 'The revised authority can now proceed to a fresh official departure inspection.',
        variant: 'success',
      });
      setExternalDialogOpen(false);
      setAcceptanceMethod('');
      setNote('');
      await refreshAmendmentState();
      window.location.reload();
    } catch (error) {
      toast({
        title: 'Acknowledgement failed',
        description: error instanceof Error ? error.message : 'Could not acknowledge revised authority',
        variant: 'error',
      });
    } finally {
      setWorking(false);
    }
  };

  const decideReplacement = async (action: 'approve' | 'reject') => {
    const amendmentId = replacementDecision?.amendment?.id;
    if (!amendmentId) return;

    setDecisionWorking(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/authority/driver-replacement`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amendmentId,
          action,
          comment: decisionComment.trim() || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not save the replacement-driver decision');

      toast({
        title: action === 'approve' ? 'Replacement driver authorised' : 'Replacement driver rejected',
        description:
          action === 'approve'
            ? 'A new Trip Authority version has been created. The replacement driver can now review and acknowledge it.'
            : 'The existing Trip Authority and live driver assignment remain unchanged.',
        variant: 'success',
      });
      setDecisionComment('');
      await Promise.all([refreshReplacementDecision(), refreshAmendmentState()]);
      window.location.reload();
    } catch (error) {
      toast({
        title: 'Decision failed',
        description: error instanceof Error ? error.message : 'Could not save the replacement-driver decision',
        variant: 'error',
      });
    } finally {
      setDecisionWorking(false);
    }
  };

  const pendingType = amendmentLabel(amendmentState?.amendment?.amendmentType);
  const replacement = replacementDecision?.amendment;

  return (
    <>
      <div className="flex flex-wrap gap-2 print:hidden">
        {amendmentState?.pending && amendmentState.canSelfAcknowledge && (
          <Button onClick={() => void acknowledgeAmendment()} loading={working}>
            <RefreshCw className="h-4 w-4" />
            Accept revised authority
          </Button>
        )}
        {amendmentState?.pending && amendmentState.canRecordExternal && (
          <Button onClick={() => setExternalDialogOpen(true)}>
            <RefreshCw className="h-4 w-4" />
            Record revised driver acceptance
          </Button>
        )}
        <Button asChild>
          <a href={`/api/trips/${tripId}/authority/pdf`}>
            <Download className="h-4 w-4" />
            Download PDF
          </a>
        </Button>
        <Button
          variant="secondary"
          onClick={() => void printPdfFromUrl(`/api/trips/${tripId}/authority/pdf`)}
        >
          <Printer className="h-4 w-4" />
          Print
        </Button>
        {canDistribute && verificationUrl && (
          <>
            <Button variant="secondary" onClick={copy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy secure link'}
            </Button>
            <Button variant="secondary" asChild>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </a>
            </Button>
            <Button variant="secondary" asChild>
              <a
                href={`mailto:?subject=${encodeURIComponent('Official Trip Authority')}&body=${encodeURIComponent(shareText)}`}
              >
                <Mail className="h-4 w-4" />
                Email
              </a>
            </Button>
          </>
        )}
      </div>

      {replacementDecision?.pending && replacement && (
        <div className="border-status-pending-border bg-status-pending-bg/40 mt-3 space-y-3 rounded-[8px] border p-3 text-xs print:hidden">
          <div>
            <p className="font-semibold text-ink-950">Replacement driver requires final-authorisation review</p>
            <p className="mt-1 text-ink-600">
              Transport Administration nominated{' '}
              <strong>
                {replacement.replacementDriver?.name || 'a replacement driver'}
                {replacement.replacementDriver?.employeeNumber
                  ? ` · ${replacement.replacementDriver.employeeNumber}`
                  : ''}
              </strong>
              . The current live assignment and signed authority remain unchanged until you decide this amendment.
            </p>
            <p className="mt-1 text-ink-600">Reason: {replacement.reason}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`driver-replacement-decision-${tripId}`}>Decision comment (optional)</Label>
            <Textarea
              id={`driver-replacement-decision-${tripId}`}
              value={decisionComment}
              onChange={(event) => setDecisionComment(event.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Add context for the approval or rejection"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void decideReplacement('approve')} loading={decisionWorking}>
              <Check className="h-4 w-4" /> Approve revised authority
            </Button>
            <Button
              variant="secondary"
              onClick={() => void decideReplacement('reject')}
              disabled={decisionWorking}
            >
              <XCircle className="h-4 w-4" /> Reject replacement
            </Button>
          </div>
        </div>
      )}

      {amendmentState?.pending && (
        <div className="border-status-pending-border bg-status-pending-bg text-status-pending-text mt-3 rounded-[8px] border px-3 py-2 text-xs print:hidden">
          <strong>Revised authority acceptance required.</strong>{' '}
          A {pendingType} became effective after the previous driver acceptance. The assigned driver must accept the current authority before a fresh departure inspection and final issue.
          {amendmentState.amendment?.reason ? ` Reason: ${amendmentState.amendment.reason}` : ''}
          {amendmentState.externalEligibilityError ? (
            <span className="mt-1 block font-semibold">
              Acceptance is blocked: {amendmentState.externalEligibilityError}
            </span>
          ) : null}
        </div>
      )}

      <Dialog open={externalDialogOpen} onOpenChange={setExternalDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record revised external-driver acceptance</DialogTitle>
            <DialogDescription>
              Confirm how the currently assigned external driver accepted the revised Trip Authority after the {pendingType}. The original acceptance remains immutable audit history.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="amendment-acceptance-method">Confirmation method</Label>
              <Select value={acceptanceMethod} onValueChange={setAcceptanceMethod}>
                <SelectTrigger id="amendment-acceptance-method">
                  <SelectValue placeholder="Select confirmation method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_person">In person</SelectItem>
                  <SelectItem value="phone">Phone</SelectItem>
                  <SelectItem value="signed_paper">Signed paper</SelectItem>
                  <SelectItem value="secure_link">Secure link</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="amendment-acceptance-note">Note (optional)</Label>
              <Textarea
                id="amendment-acceptance-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Record any useful acceptance context"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setExternalDialogOpen(false)} disabled={working}>
              Cancel
            </Button>
            <Button
              onClick={() => void acknowledgeAmendment(acceptanceMethod)}
              disabled={!acceptanceMethod}
              loading={working}
            >
              Record acceptance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
