'use client';

/** Print the exact authenticated PDF artifact used by preview/download. */
export async function printPdfFromUrl(url: string): Promise<void> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('The PDF could not be prepared for printing.');
  const blob = await response.blob();
  if (!blob.type.includes('pdf')) throw new Error('The server did not return a PDF.');

  const objectUrl = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.setAttribute('title', 'PDF print frame');
  frame.style.position = 'fixed';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.border = '0';
  frame.src = objectUrl;

  let cleanedUp = false;
  let fallbackTimer: number | undefined;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
    frame.contentWindow?.removeEventListener('afterprint', cleanup);
    frame.remove();
    URL.revokeObjectURL(objectUrl);
  };

  frame.onload = () => {
    try {
      const printWindow = frame.contentWindow;
      if (!printWindow) throw new Error('The browser could not open the PDF print frame.');
      printWindow.addEventListener('afterprint', cleanup, { once: true });
      printWindow.focus();
      printWindow.print();
      // Some embedded PDF viewers do not reliably dispatch `afterprint` back
      // to the parent frame. Keep the object URL alive long enough for the
      // browser print pipeline, then clean it up as a safety fallback.
      fallbackTimer = window.setTimeout(cleanup, 60_000);
    } catch (error) {
      cleanup();
      throw error;
    }
  };

  frame.onerror = () => {
    cleanup();
  };

  document.body.appendChild(frame);
}
