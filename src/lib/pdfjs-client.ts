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

/**
 * Load the browser PDF renderer at runtime instead of delegating to Chrome's
 * protected PDF extension frame. The version is pinned so preview/print stay
 * deterministic. This keeps the app free of a second PDF package-manager tree
 * while we already use @react-pdf/renderer for document generation.
 */
export function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsPromise) {
    // Keep the URL as a runtime import so Next/Turbopack does not try to bundle
    // a remote module. jsDelivr serves the official npm pdfjs-dist build.
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
