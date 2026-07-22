'use client';

import { useState } from 'react';
import { Loader2, Download, FileText, AlertCircle } from 'lucide-react';
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
    // Trigger a direct download by opening the API URL
    const a = document.createElement('a');
    a.href = `/api/documents/${documentId}/pdf`;
    a.download = `${documentType.replace(/_/g, '-')}-${documentId.slice(0, 8)}.pdf`;
    a.click();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {!pdfUrl && !isLoading && !error && (
          <Button variant="secondary" size="sm" onClick={handlePreview}>
            <FileText className="h-4 w-4" />
            Generate Preview
          </Button>
        )}
        {pdfUrl && (
          <Button variant="secondary" size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4" />
            Download PDF
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center rounded-[10px] border border-border bg-muted/30 py-12">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-brand-700" />
            <p className="text-xs text-ink-500">Generating PDF preview...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-[8px] border border-status-error-bg bg-status-error-bg/30 px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-status-error-text" />
          <p className="text-xs text-status-error-text">{error}</p>
        </div>
      )}

      {pdfUrl && (
        <div className="overflow-hidden rounded-[10px] border border-border">
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
