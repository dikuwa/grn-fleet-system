'use client';

import { fetchPdfBytes, loadPdfJs } from '@/lib/pdfjs-client';

/**
 * Print the canonical authenticated PDF without navigating a frame into the
 * browser's cross-origin PDF extension. PDF.js renders each official page into
 * a same-origin print document, so calling print remains permitted in Chrome,
 * Safari and Firefox while the surrounding dashboard stays excluded.
 */
export async function printPdfFromUrl(url: string): Promise<void> {
  const [bytes, pdfjs] = await Promise.all([fetchPdfBytes(url), loadPdfJs()]);
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const iframe = document.createElement('iframe');

  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.border = '0';

  document.body.appendChild(iframe);

  const printDocument = iframe.contentDocument;
  const printWindow = iframe.contentWindow;
  if (!printDocument || !printWindow) {
    iframe.remove();
    await pdf.destroy?.();
    throw new Error('The browser could not create a print document.');
  }

  let cleaned = false;
  let cleanupTimer: number | null = null;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (cleanupTimer !== null) window.clearTimeout(cleanupTimer);
    iframe.remove();
    void pdf.destroy?.();
  };

  try {
    printDocument.open();
    printDocument.write(`<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>GovFleet official document</title>
          <style>
            @page { size: auto; margin: 0; }
            * { box-sizing: border-box; }
            html, body { margin: 0; padding: 0; background: #fff; }
            .pdf-page {
              display: flex;
              width: 100%;
              align-items: flex-start;
              justify-content: center;
              break-after: page;
              page-break-after: always;
              background: #fff;
            }
            .pdf-page:last-child { break-after: auto; page-break-after: auto; }
            canvas { display: block; width: 100%; height: auto; }
          </style>
        </head>
        <body></body>
      </html>`);
    printDocument.close();

    const body = printDocument.body;
    if (!body) throw new Error('The browser could not prepare the print document.');

    // Approximately 150 DPI for an A4 source. This keeps official text and QR
    // codes crisp without the memory cost of full 300 DPI canvases.
    const printScale = 2.1;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: printScale });
      const canvas = printDocument.createElement('canvas');
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error(`Page ${pageNumber} could not be prepared for printing.`);

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvas, canvasContext: context, viewport }).promise;

      const pageWrapper = printDocument.createElement('section');
      pageWrapper.className = 'pdf-page';
      pageWrapper.appendChild(canvas);
      body.appendChild(pageWrapper);
      page.cleanup?.();
    }

    printWindow.addEventListener('afterprint', cleanup, { once: true });
    printWindow.focus();
    printWindow.print();

    // Safari and some Chromium versions do not reliably emit afterprint for a
    // child frame. Keep the print document alive long enough for the dialog.
    cleanupTimer = window.setTimeout(cleanup, 120_000);
  } catch (error) {
    cleanup();
    throw error instanceof Error ? error : new Error('The browser could not start printing.');
  }
}
