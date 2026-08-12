'use client';

import { useState } from 'react';
import { Download, Eye, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { printPdfFromUrl } from '@/lib/print-pdf';

/**
 * Canonical document controls shown in the Document Preview card header.
 *
 * Preview, Download and Print all point at the same authenticated PDF artifact.
 * This prevents the dashboard from maintaining a second, generic HTML document
 * renderer that can drift away from the document users actually print.
 */
export function DocumentViewerActions({
  documentId,
  documentType,
}: {
  documentId: string;
  documentType: string;
}) {
  const [printError, setPrintError] = useState<string | null>(null);
  const pdfUrl = `/api/documents/${documentId}/pdf`;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" asChild>
          <a href={pdfUrl} download={`${documentType}-${documentId}.pdf`}>
            <Download className="h-4 w-4" /> Download PDF
          </a>
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <a href={`${pdfUrl}?preview=1`} target="_blank" rel="noreferrer">
            <Eye className="h-4 w-4" /> Preview
          </a>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setPrintError(null);
            void printPdfFromUrl(pdfUrl).catch((error) =>
              setPrintError(error instanceof Error ? error.message : 'Could not prepare the PDF.'),
            );
          }}
        >
          <Printer className="h-4 w-4" /> Print
        </Button>
      </div>
      {printError && <p className="text-status-error-text text-xs">{printError}</p>}
    </div>
  );
}
