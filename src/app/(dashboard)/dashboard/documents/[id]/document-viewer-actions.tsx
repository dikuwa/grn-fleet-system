'use client';

import { useState } from 'react';
import { Download, Eye, Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { printPdfFromUrl } from '@/lib/print-pdf';
import { PdfPreview } from '@/components/ui/pdf-preview';

/**
 * Canonical document controls shown in the Document Preview card header.
 *
 * Download and Print reuse the exact authenticated PDF artifact used by the
 * preview route, so the browser never prints the dashboard shell. Preview
 * embeds the existing in-page PDF preview (which carries its own download and
 * print controls) below the header.
 */
export function DocumentViewerActions({
  documentId,
  documentType,
}: {
  documentId: string;
  documentType: string;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" asChild>
          <a href={`/api/documents/${documentId}/pdf`}>
            <Download className="h-4 w-4" /> Download PDF
          </a>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={showPreview}
          onClick={() => {
            setPrintError(null);
            setShowPreview((current) => !current);
          }}
        >
          {showPreview ? <X className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {showPreview ? 'Close Preview' : 'Preview'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            void printPdfFromUrl(`/api/documents/${documentId}/pdf`).catch((error) =>
              setPrintError(error instanceof Error ? error.message : 'Could not prepare the PDF.'),
            )
          }
        >
          <Printer className="h-4 w-4" /> Print
        </Button>
      </div>
      {printError && <p className="text-status-error-text text-xs">{printError}</p>}
      {showPreview && (
        <div className="w-full">
          <PdfPreview documentId={documentId} documentType={documentType} />
        </div>
      )}
    </div>
  );
}
