'use client';

import { fetchPdfBytes } from '@/lib/pdfjs-client';

/**
 * Print the canonical authenticated PDF itself. The protected response is
 * fetched with the current session, exposed only through a temporary blob URL,
 * and loaded into a hidden same-origin frame for the browser print dialog.
 */
export async function printPdfFromUrl(url: string): Promise<void> {
  const bytes = await fetchPdfBytes(url);
  const pdfBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const objectUrl = URL.createObjectURL(new Blob([pdfBuffer], { type: 'application/pdf' }));
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

  let cleaned = false;
  let cleanupTimer: number | null = null;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (cleanupTimer !== null) window.clearTimeout(cleanupTimer);
    iframe.remove();
    URL.revokeObjectURL(objectUrl);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const loadTimer = window.setTimeout(
        () => reject(new Error('The PDF took too long to prepare for printing.')),
        15_000,
      );
      iframe.addEventListener(
        'load',
        () => {
          window.clearTimeout(loadTimer);
          resolve();
        },
        { once: true },
      );
      iframe.addEventListener(
        'error',
        () => {
          window.clearTimeout(loadTimer);
          reject(new Error('The browser could not load the PDF for printing.'));
        },
        { once: true },
      );
      iframe.src = objectUrl;
      document.body.appendChild(iframe);
    });

    const printWindow = iframe.contentWindow;
    if (!printWindow) throw new Error('The browser could not create a PDF print window.');

    printWindow.addEventListener('afterprint', cleanup, { once: true });
    printWindow.focus();
    printWindow.print();

    // Safari and some Chromium versions do not reliably emit afterprint for a
    // child frame. Keep the blob alive long enough for the dialog.
    cleanupTimer = window.setTimeout(cleanup, 120_000);
  } catch (error) {
    cleanup();
    throw error instanceof Error ? error : new Error('The browser could not start printing.');
  }
}
