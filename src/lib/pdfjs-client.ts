'use client';

const PDFJS_VERSION = '6.1.200';
const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

export interface PdfViewport {
  width: number;
  height: number;
}

export interface PdfRenderTask {
  promise: Promise<void>;
  cancel?: () => void;
}

export interface PdfPageProxy {
  getViewport: (options: { scale: number }) => PdfViewport;
  render: (options: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }) => PdfRenderTask;
  cleanup?: () => void;
}

export interface PdfDocumentProxy {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageProxy>;
  destroy?: () => Promise<void> | void;
}

interface PdfJsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (source: { data: Uint8Array }) => { promise: Promise<PdfDocumentProxy> };
}

let pdfJsPromise: Promise<PdfJsModule> | null = null;

export function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsPromise) {
    // Runtime import keeps Chrome's protected PDF extension frame out of the
    // preview/print path. Version is pinned for deterministic rendering.
    // eslint-disable-next-line no-new-func
    const runtimeImport = new Function('moduleUrl', 'return import(moduleUrl)') as (
      moduleUrl: string,
    ) => Promise<PdfJsModule>;

    pdfJsPromise = runtimeImport(PDFJS_CDN)
      .then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
        return pdfjs;
      })
      .catch((error) => {
        pdfJsPromise = null;
        throw error;
      });
  }

  return pdfJsPromise;
}

export async function fetchPdfBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    throw new Error('The official PDF could not be loaded.');
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const header = String.fromCharCode(...bytes.slice(0, 5));
  if (bytes.length < 5 || header !== '%PDF-') {
    throw new Error('The server did not return a valid PDF.');
  }

  return bytes;
}
