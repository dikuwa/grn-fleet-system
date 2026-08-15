'use client';

import { useEffect, useState } from 'react';
import { FileWarning, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function DocumentPdfPreview({
  url,
  title,
  className = '',
}: {
  url: string;
  title: string;
  className?: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let localObjectUrl: string | null = null;

    setObjectUrl(null);
    setError(null);

    void fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('The official PDF could not be loaded.');
        const blob = await response.blob();
        if (!blob.type.includes('pdf')) throw new Error('The server did not return a PDF.');
        localObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(localObjectUrl);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : 'The official PDF could not be loaded.');
      });

    return () => {
      controller.abort();
      if (localObjectUrl) URL.revokeObjectURL(localObjectUrl);
    };
  }, [reloadKey, url]);

  if (error) {
    return (
      <div className={`bg-surface flex h-full min-h-[320px] items-center justify-center p-6 ${className}`} role="alert">
        <div className="max-w-sm text-center">
          <FileWarning className="text-status-error-text mx-auto h-8 w-8" aria-hidden="true" />
          <p className="text-ink-950 mt-3 text-sm font-medium">Preview unavailable</p>
          <p className="text-ink-500 mt-1 text-xs">{error}</p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => setReloadKey((value) => value + 1)}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className={`bg-surface flex h-full min-h-[320px] items-center justify-center ${className}`} role="status">
        <div className="text-ink-500 flex items-center gap-2 text-sm">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Loading official PDF…
        </div>
      </div>
    );
  }

  return <iframe src={objectUrl} title={title} className={`h-full w-full border-0 bg-white ${className}`} />;
}
