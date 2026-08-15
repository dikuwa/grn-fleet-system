'use client';

import { useState } from 'react';
import { Download, Eye, Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { printPdfFromUrl } from '@/lib/print-pdf';

/**
 * Canonical document controls for preview, download and print.
 *
 * All three actions use the same authenticated PDF endpoint. Preview is kept
 * inside a full-screen modal so dashboard chrome never becomes part of the
 * printable surface and users can close the preview without losing context.
 */
export function DocumentViewerActions({
  documentId,
  documentType,
}: {
  documentId: string;
  documentType: string;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const pdfUrl = `/api/documents/${documentId}/pdf`;
  const previewUrl = `${pdfUrl}?preview=1`;
  const downloadName = `${documentType}-${documentId}.pdf`;

  const printDocument = async () => {
    setPrintError(null);
    try {
      await printPdfFromUrl(previewUrl);
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : 'Could not open the PDF for printing.');
    }
  };

  return (
    <>
      <div className="flex flex-col items-end gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" asChild>
            <a href={pdfUrl} download={downloadName}>
              <Download className="h-4 w-4" /> Download PDF
            </a>
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPreviewOpen(true)}>
            <Eye className="h-4 w-4" /> Preview
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void printDocument()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
        {printError ? (
          <p className="text-status-error-text max-w-sm text-right text-xs">{printError}</p>
        ) : null}
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="bg-surface !inset-0 !top-0 !left-0 !h-dvh !max-h-dvh !w-screen !max-w-none !translate-x-0 !translate-y-0 !rounded-none !border-0 !p-0 [&>button.absolute]:hidden sm:!inset-0 sm:!top-0 sm:!left-0 sm:!h-dvh sm:!max-h-dvh sm:!w-screen sm:!max-w-none sm:!translate-x-0 sm:!translate-y-0 sm:!rounded-none sm:!p-0">
          <DialogHeader className="border-border bg-surface mb-0 flex min-h-14 shrink-0 flex-row items-center justify-between gap-3 border-b px-3 py-2 sm:px-5">
            <div className="min-w-0">
              <DialogTitle className="truncate text-sm sm:text-base">Document preview</DialogTitle>
              <DialogDescription className="truncate text-xs">
                Previewing the same official PDF used for download and print.
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" size="sm" asChild className="hidden sm:inline-flex">
                <a href={pdfUrl} download={downloadName}>
                  <Download className="h-4 w-4" /> Download
                </a>
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void printDocument()}>
                <Printer className="h-4 w-4" /> Print
              </Button>
              <DialogClose asChild>
                <Button variant="secondary" size="sm" aria-label="Close document preview">
                  <X className="h-4 w-4" /> <span className="hidden sm:inline">Close</span>
                </Button>
              </DialogClose>
            </div>
          </DialogHeader>

          <div className="bg-muted/30 min-h-0 flex-1 overflow-hidden">
            <iframe
              src={previewUrl}
              title="Official document PDF preview"
              className="h-full w-full border-0 bg-white"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
