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
import { DocumentPdfPreview } from './document-pdf-preview';

/** Canonical document controls for preview, download and print. */
export function DocumentViewerActions({
  documentId,
  documentType,
}: {
  documentId: string;
  documentType: string;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const pdfUrl = `/api/documents/${documentId}/pdf`;
  const previewUrl = `${pdfUrl}?preview=1`;
  const downloadName = `${documentType}-${documentId}.pdf`;

  return (
    <>
      <div className="flex flex-col items-start gap-2 sm:items-end">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            asChild
            className="text-status-success-text hover:text-status-success-text"
          >
            <a href={pdfUrl} download={downloadName}>
              <Download className="h-4 w-4" /> Download PDF
            </a>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="text-brand-700 hover:text-brand-700"
            onClick={() => setPreviewOpen(true)}
          >
            <Eye className="h-4 w-4" /> Preview
          </Button>
          <Button
            variant="secondary"
            size="sm"
            asChild
            className="text-status-pending-text hover:text-status-pending-text"
          >
            <a href={previewUrl} target="_blank" rel="noopener noreferrer">
              <Printer className="h-4 w-4" /> Print
            </a>
          </Button>
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          className="bg-surface flex h-[96dvh] flex-col overflow-hidden p-0 shadow-2xl [&>button.absolute]:hidden"
          style={{ width: '96vw', maxWidth: '1800px' }}
        >
          <DialogHeader className="border-border bg-surface mb-0 flex min-h-14 shrink-0 flex-row items-center justify-between gap-3 border-b px-3 py-2 sm:px-5">
            <div className="min-w-0">
              <DialogTitle className="truncate text-sm sm:text-base">Document preview</DialogTitle>
              <DialogDescription className="truncate text-xs">
                Official PDF · use the page and zoom controls without leaving GovFleet.
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <Button
                variant="secondary"
                size="sm"
                asChild
                className="text-status-success-text hover:text-status-success-text"
              >
                <a href={pdfUrl} download={downloadName}>
                  <Download className="h-4 w-4" />{' '}
                  <span className="hidden md:inline">Download</span>
                </a>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                asChild
                className="text-status-pending-text hover:text-status-pending-text"
              >
                <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                  <Printer className="h-4 w-4" />{' '}
                  <span className="hidden sm:inline">Print</span>
                </a>
              </Button>
              <DialogClose asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-status-error-text hover:text-status-error-text"
                  aria-label="Close document preview"
                >
                  <X className="h-4 w-4" /> <span className="hidden sm:inline">Close</span>
                </Button>
              </DialogClose>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-hidden">
            <DocumentPdfPreview url={previewUrl} title="Official document PDF preview" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
