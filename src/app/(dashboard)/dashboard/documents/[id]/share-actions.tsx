'use client';

import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Mail,
  MessageCircle,
  Printer,
  Share2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { printPdfFromUrl } from '@/lib/print-pdf';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function ShareActions({
  shareUrl,
  documentTitle,
  documentId,
  documentReference,
  status,
  organisationName,
  verificationCode,
}: {
  shareUrl?: string;
  documentTitle: string;
  documentId: string;
  documentReference?: string;
  status?: string;
  organisationName?: string;
  verificationCode?: string;
}) {
  const [copied, setCopied] = useState<'link' | 'message' | null>(null);
  const isDraft = status?.trim().toLowerCase() === 'draft';
  // A generated draft already has a stable verification slug internally, but
  // that identity is not a public sharing channel until the document is issued.
  const effectiveShareUrl = isDraft ? undefined : shareUrl;
  const defaultMessage = useMemo(
    () =>
      [
        organisationName,
        documentTitle,
        documentReference ? `Reference: ${documentReference}` : null,
        status ? `Status: ${status}` : null,
        'Verify securely:',
        effectiveShareUrl,
      ]
        .filter(Boolean)
        .join('\n'),
    [documentReference, documentTitle, effectiveShareUrl, organisationName, status],
  );
  const [editedMessage, setEditedMessage] = useState('');
  const message = editedMessage || defaultMessage;

  const copy = async (value: string, kind: 'link' | 'message') => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Share2 className="h-4 w-4" /> Share
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share verified document</DialogTitle>
        </DialogHeader>
        {!effectiveShareUrl ? (
          <div className="border-status-pending-bg bg-status-pending-bg rounded-lg border p-4">
            <p className="text-ink-950 text-sm font-medium">
              {isDraft ? 'Issue this document before sharing' : 'Create a secure link first'}
            </p>
            <p className="text-ink-600 mt-1 text-xs">
              {isDraft
                ? 'Draft verification identities are private. Once the document is formally issued, its verified public identity can be shared.'
                : 'Use “Create Link” to choose an expiry and access limit. GovFleet will reuse an existing active link by default.'}
            </p>
          </div>
        ) : (
          <>
            <label className="text-ink-500 text-xs font-medium">
              Formatted message
              <textarea
                value={message}
                onChange={(event) => setEditedMessage(event.target.value)}
                rows={6}
                className="border-border bg-canvas text-ink-950 mt-1 w-full resize-none rounded-lg border p-3 text-sm"
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                variant="primary"
                onClick={() =>
                  window.open(
                    `https://wa.me/?text=${encodeURIComponent(message)}`,
                    '_blank',
                    'noopener',
                  )
                }
              >
                <MessageCircle className="h-4 w-4" /> Open in WhatsApp
              </Button>
              <Button variant="secondary" onClick={() => copy(effectiveShareUrl, 'link')}>
                {copied === 'link' ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied === 'link' ? 'Link copied' : 'Copy secure link'}
              </Button>
              <Button variant="secondary" onClick={() => copy(message, 'message')}>
                {copied === 'message' ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied === 'message' ? 'Message copied' : 'Copy formatted message'}
              </Button>
              {verificationCode && (
                <Button variant="secondary" onClick={() => copy(verificationCode, 'message')}>
                  <Copy className="h-4 w-4" /> Copy verification code
                </Button>
              )}
              <Button variant="secondary" asChild>
                <a
                  href={`mailto:?subject=${encodeURIComponent(documentTitle)}&body=${encodeURIComponent(message)}`}
                >
                  <Mail className="h-4 w-4" /> Send by email
                </a>
              </Button>
              <Button variant="secondary" asChild>
                <a href={`/api/documents/${documentId}/pdf`}>
                  <Download className="h-4 w-4" /> Download PDF
                </a>
              </Button>
              <Button
                variant="secondary"
                onClick={() => void printPdfFromUrl(`/api/documents/${documentId}/pdf`)}
              >
                <Printer className="h-4 w-4" /> Print document
              </Button>
              <Button variant="secondary" asChild>
                <a href={effectiveShareUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" /> Open verification page
                </a>
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
