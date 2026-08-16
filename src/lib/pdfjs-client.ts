'use client';

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
  getDocument: (source: { data: Uint8Array }) => { promise: Promise<PdfDocumentProxy> };
}

let pdfJsPromise: Promise<PdfJsModule> | null = null;

/**
 * Load the browser PDF renderer from the locally installed package instead of
 * delegating to Chrome's protected PDF extension frame or a runtime CDN. The
 * PDF.js webpack entry creates a module worker from the package build, allowing
 * Next.js to emit and serve both assets from the application deployment.
 */
export function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsPromise) {
    pdfJsPromise = import('pdfjs-dist/webpack.mjs')
      .then((pdfjs) => pdfjs as unknown as PdfJsModule)
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
    throw new Error(`The official PDF could not be loaded (HTTP ${response.status}).`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const header = String.fromCharCode(...bytes.slice(0, 5));
  if (bytes.length < 5 || header !== '%PDF-') {
    throw new Error('The server did not return a valid PDF.');
  }

  return bytes;
}
