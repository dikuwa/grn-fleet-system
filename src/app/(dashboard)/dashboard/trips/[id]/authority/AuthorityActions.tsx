'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Download, Mail, MessageCircle, Printer, RefreshCw } from 'lucide-react';
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
  amendment?: {
    id: string;
    authorityVersion: number;
    reason: string;
    createdAt: string;
  } | null;
};

export function AuthorityActions({
  tripId,
  verificationUrl,
}: {
  tripId: string;
  verificationUrl?: string;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [amendmentState, setAmendmentState] = useState<AmendmentState | null>(null);
  const [working, setWorking] = useState(false);
  const [externalDialogOpen, setExternalDialogOpen] = useState(false);
  const [acceptanceMethod, setAcceptanceMethod] = useState('');
  const [note, setNote] = useState('');
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

  useEffect(() => {
    void refreshAmendmentState();
  }, [refreshAmendmentState]);

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
        description: 'The replacement vehicle can now proceed to its fresh departure inspection.',
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
      </div>

      {amendmentState?.pending && (
        <div className="border-status-pending-border bg-status-pending-bg text-status-pending-text mt-3 rounded-[8px] border px-3 py-2 text-xs print:hidden">
          <strong>Revised authority acceptance required.</strong>{' '}
          The vehicle was replaced after the previous driver acceptance.
          {amendmentState.amendment?.reason ? ` Reason: ${amendmentState.amendment.reason}` : ''}
        </div>
      )}

      <Dialog open={externalDialogOpen} onOpenChange={setExternalDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record revised external-driver acceptance</DialogTitle>
            <DialogDescription>
              Confirm how the currently assigned external driver accepted the replacement vehicle on the revised Trip Authority. The original acceptance remains in the audit history.
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
