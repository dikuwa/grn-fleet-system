'use client';

import { useState } from 'react';
import { Check, Copy, Download, Mail, MessageCircle, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { printPdfFromUrl } from '@/lib/print-pdf';

export function AuthorityActions({
  tripId,
  verificationUrl,
}: {
  tripId: string;
  verificationUrl?: string;
}) {
  const [copied, setCopied] = useState(false);
  const shareText = `Official GRN Fleet Trip Authority verification: ${verificationUrl ?? ''}`;

  const copy = async () => {
    await navigator.clipboard.writeText(verificationUrl ?? window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
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
  );
}
