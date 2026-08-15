'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  ChevronUp,
  FileWarning,
  Loader2,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchPdfBytes, loadPdfJs, type PdfDocumentProxy, type PdfRenderTask } from '@/lib/pdfjs-client';

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.4;
const ZOOM_STEP = 0.2;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function ViewerControls({
  pageNumber,
  pageCount,
  zoom,
  onPageChange,
  onZoomChange,
  compact = false,
}: {
  pageNumber: number;
  pageCount: number;
  zoom: number;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  compact?: boolean;
}) {
  const buttonClass = compact ? 'shrink-0' : '';

  return (
    <div
      className={
        compact
          ? 'border-border bg-surface/95 flex items-center gap-1 rounded-[10px] border p-1 shadow-lg backdrop-blur'
          : 'border-border bg-surface/95 flex flex-col items-center gap-1 rounded-[10px] border p-1.5 shadow-lg backdrop-blur'
      }
      aria-label="PDF navigation controls"
    >
      <Button type="button" variant="ghost" size="icon-sm" className={buttonClass} onClick={() => onPageChange(1)} disabled={pageNumber <= 1} aria-label="First page" title="First page">
        <ChevronsUp className="h-4 w-4" />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" className={buttonClass} onClick={() => onPageChange(pageNumber - 1)} disabled={pageNumber <= 1} aria-label="Previous page" title="Previous page">
        <ChevronUp className="h-4 w-4" />
      </Button>

      <div className="text-ink-600 min-w-11 px-1 text-center text-[11px] font-medium tabular-nums" aria-live="polite">
        {pageNumber}/{Math.max(pageCount, 1)}
      </div>

      <Button type="button" variant="ghost" size="icon-sm" className={buttonClass} onClick={() => onPageChange(pageNumber + 1)} disabled={pageNumber >= pageCount} aria-label="Next page" title="Next page">
        <ChevronDown className="h-4 w-4" />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" className={buttonClass} onClick={() => onPageChange(pageCount)} disabled={pageNumber >= pageCount} aria-label="Last page" title="Last page">
        <ChevronsDown className="h-4 w-4" />
      </Button>

      <div className={compact ? 'bg-border mx-1 h-6 w-px' : 'bg-border my-1 h-px w-7'} aria-hidden="true" />

      <Button type="button" variant="ghost" size="icon-sm" className={buttonClass} onClick={() => onZoomChange(clamp(zoom - ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out" title="Zoom out">
        <ZoomOut className="h-4 w-4" />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" className={buttonClass} onClick={() => onZoomChange(1)} aria-label="Fit page to viewer" title="Fit page">
        <Maximize2 className="h-4 w-4" />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" className={buttonClass} onClick={() => onZoomChange(clamp(zoom + ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in">
        <ZoomIn className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function DocumentPdfPreview({
  url,
  title,
  className = '',
}: {
  url: string;
  title: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [pdf, setPdf] = useState<PdfDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const updateWidth = () => setContainerWidth(node.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let loadedPdf: PdfDocumentProxy | null = null;

    setPdf(null);
    setPageCount(0);
    setPageNumber(1);
    setZoom(1);
    setError(null);
    setLoading(true);

    void Promise.all([fetchPdfBytes(url, controller.signal), loadPdfJs()])
      .then(async ([bytes, pdfjs]) => {
        if (controller.signal.aborted) return;
        loadedPdf = await pdfjs.getDocument({ data: bytes }).promise;
        if (controller.signal.aborted) {
          await loadedPdf.destroy?.();
          return;
        }
        setPdf(loadedPdf);
        setPageCount(loadedPdf.numPages);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        console.error('Document PDF preview failed:', reason);
        setError('The in-app PDF preview could not be prepared. Download is still available.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
      void loadedPdf?.destroy?.();
    };
  }, [reloadKey, url]);

  useEffect(() => {
    if (!pdf || !canvasRef.current || containerWidth <= 0) return;

    let cancelled = false;
    let renderTask: PdfRenderTask | null = null;
    setRendering(true);

    void pdf
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled || !canvasRef.current) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const fitWidth = Math.max(220, containerWidth * 0.8);
        const fitScale = clamp(fitWidth / baseViewport.width, 0.35, 2.25);
        const cssScale = fitScale * zoom;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const renderViewport = page.getViewport({ scale: cssScale * pixelRatio });
        const cssViewport = page.getViewport({ scale: cssScale });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('PDF canvas is unavailable.');

        canvas.width = Math.ceil(renderViewport.width);
        canvas.height = Math.ceil(renderViewport.height);
        canvas.style.width = `${Math.ceil(cssViewport.width)}px`;
        canvas.style.height = `${Math.ceil(cssViewport.height)}px`;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);

        renderTask = page.render({ canvas, canvasContext: context, viewport: renderViewport });
        return renderTask.promise.finally(() => page.cleanup?.());
      })
      .catch((reason) => {
        if (cancelled || (reason instanceof Error && reason.name === 'RenderingCancelledException')) return;
        console.error('PDF page render failed:', reason);
        setError('This PDF page could not be rendered. Download is still available.');
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });

    return () => {
      cancelled = true;
      renderTask?.cancel?.();
    };
  }, [containerWidth, pageNumber, pdf, zoom]);

  const changePage = useCallback((nextPage: number) => {
    if (!pageCount) return;
    setPageNumber(clamp(nextPage, 1, pageCount));
    scrollerRef.current?.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  }, [pageCount]);

  if (error) {
    return (
      <div className={`bg-muted/30 flex h-full min-h-[320px] items-center justify-center p-6 ${className}`} role="alert">
        <div className="max-w-sm text-center">
          <FileWarning className="text-status-error-text mx-auto h-8 w-8" aria-hidden="true" />
          <p className="text-ink-950 mt-3 text-sm font-medium">Preview unavailable</p>
          <p className="text-ink-500 mt-1 text-xs">{error}</p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => setReloadKey((value) => value + 1)}>Try again</Button>
        </div>
      </div>
    );
  }

  return (
    <div ref={viewportRef} className={`bg-muted/40 relative h-full min-h-[320px] overflow-hidden ${className}`}>
      <div ref={scrollerRef} className="h-full overflow-auto overscroll-contain px-[10%] py-[5%] sm:pr-[13%]" aria-label={title}>
        <div className="flex min-h-full min-w-max items-start justify-center">
          <div className="border-border relative overflow-hidden rounded-[3px] border bg-white shadow-md">
            <canvas ref={canvasRef} className="block bg-white" aria-label={`${title}, page ${pageNumber} of ${Math.max(pageCount, 1)}`} />
            {(loading || rendering) && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/75" role="status">
                <div className="text-ink-500 flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  {loading ? 'Loading document…' : 'Rendering page…'}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {pdf && pageCount > 0 ? (
        <>
          <div className="absolute top-1/2 right-3 hidden -translate-y-1/2 sm:block">
            <ViewerControls pageNumber={pageNumber} pageCount={pageCount} zoom={zoom} onPageChange={changePage} onZoomChange={setZoom} />
          </div>
          <div className="absolute right-2 bottom-2 left-2 flex justify-center sm:hidden">
            <div className="max-w-full overflow-x-auto pb-0.5">
              <ViewerControls pageNumber={pageNumber} pageCount={pageCount} zoom={zoom} onPageChange={changePage} onZoomChange={setZoom} compact />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
