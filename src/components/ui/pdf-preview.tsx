'use client';

import { useEffect, useState } from 'react';
import { Loader2, Download, FileText, AlertCircle, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PdfPreviewProps {
  /** Document ID to fetch PDF for */
  documentId: string;
  /** Document type label for display */
  documentType: string;
}

/**
 * PDF Preview Widget
 *
 * Fetches a PDF from /api/documents/[id]/pdf and renders it in an
 * embedded iframe with download and full-screen controls.
 * Handles loading, error, and unsupported-browser states gracefully.
 */
export function PdfPreview({ documentId, documentType }: PdfPreviewProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'download' | 'print' | null>(null);

  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );

  const handlePreview = async () => {
    if (pdfUrl) return; // Already loaded
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/documents/${documentId}/pdf`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to generate PDF' }));
        throw new Error(err.error || 'PDF generation not available');
      }

      // Convert response to a blob URL
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load PDF preview');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async () => {
    // Let the canonical endpoint supply the central human-readable filename.
    const a = document.createElement('a');
    a.href = `/api/documents/${documentId}/pdf`;
    a.click();
    window.setTimeout(() => setPendingAction(null), 1000);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {!pdfUrl && !error && (
          <Button variant="secondary" size="sm" loading={isLoading} onClick={handlePreview}>
            {!isLoading ? <FileText className="h-4 w-4" /> : null}
            Generate Preview
          </Button>
        )}
        {pdfUrl && (
          <>
            <Button
              variant="secondary"
              size="sm"
              loading={pendingAction === 'download'}
              onClick={() => {
                setPendingAction('download');
                void handleDownload();
              }}
            >
              {pendingAction !== 'download' ? <Download className="h-4 w-4" /> : null}
              Download PDF
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <a
                href={`/dashboard/documents/${documentId}/print`}
                target="_blank"
                rel="noopener noreferrer"
                aria-busy={pendingAction === 'print' || undefined}
                onClick={() => {
                  setPendingAction('print');
                  window.setTimeout(() => setPendingAction(null), 1200);
                }}
              >
                {pendingAction === 'print' ? (
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <Printer className="h-4 w-4" />
                )}{' '}
                Print PDF
              </a>
            </Button>
          </>
        )}
      </div>

      {isLoading && (
        <div className="flex min-h-[320px] items-center justify-center" role="status">
          <div className="text-ink-500 flex items-center gap-2 text-sm">
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />
            <span>Loading document…</span>
          </div>
        </div>
      )}

      {error && (
        <div className="border-status-error-bg bg-status-error-bg/30 flex items-center gap-2 rounded-[8px] border px-3 py-2">
          <AlertCircle className="text-status-error-text h-4 w-4 shrink-0" />
          <p className="text-status-error-text text-xs">{error}</p>
        </div>
      )}

      {pdfUrl && (
        <div className="border-border overflow-hidden rounded-[10px] border">
          <iframe
            src={pdfUrl}
            className="w-full"
            style={{ height: '600px' }}
            title={`${documentType} PDF Preview`}
          />
        </div>
      )}
    </div>
  );
}
