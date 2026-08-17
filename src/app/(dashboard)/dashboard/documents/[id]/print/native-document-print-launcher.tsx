'use client';

import { useEffect, useState } from 'react';
import { FileWarning, Loader2 } from 'lucide-react';

export function NativeDocumentPrintLauncher({ documentId }: { documentId: string }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void fetch(`/api/documents/${documentId}/pdf?preview=1`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/pdf' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('The PDF could not be prepared for printing.');
        const blob = await response.blob();
        if (!blob.type.includes('pdf')) throw new Error('The server did not return a PDF.');
        if (controller.signal.aborted) return;
        window.location.replace(URL.createObjectURL(blob));
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : 'The PDF could not be opened.');
      });

    return () => controller.abort();
  }, [documentId]);

  return (
    <main className="bg-canvas text-ink-950 flex min-h-dvh items-center justify-center p-6">
      {error ? (
        <div className="max-w-sm text-center" role="alert">
          <FileWarning className="text-status-error-text mx-auto h-7 w-7" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">Print preview unavailable</p>
          <p className="text-ink-500 mt-1 text-xs">{error}</p>
        </div>
      ) : (
        <div className="text-ink-500 flex items-center gap-2 text-sm" role="status">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <span>Opening document…</span>
        </div>
      )}
    </main>
  );
}
