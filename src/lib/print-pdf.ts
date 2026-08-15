'use client';

/**
 * Print the canonical authenticated PDF without opening a new tab/window.
 * The PDF is fetched in the current session, converted to a blob URL and loaded
 * into a temporary off-screen iframe. This keeps users inside GovFleet and
 * avoids popup-blocker failures.
 */
export async function printPdfFromUrl(url: string): Promise<void> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('The official PDF could not be prepared for printing.');

  const blob = await response.blob();
  if (!blob.type.includes('pdf')) throw new Error('The server did not return a printable PDF.');

  const objectUrl = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.src = objectUrl;

  let settled = false;
  const cleanup = () => {
    if (settled) return;
    settled = true;
    iframe.remove();
    URL.revokeObjectURL(objectUrl);
  };

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('The browser did not finish loading the PDF for printing. Try Preview, then Print again.'));
    }, 20_000);

    iframe.onload = () => {
      window.clearTimeout(timeout);
      try {
        const target = iframe.contentWindow;
        if (!target) throw new Error('Print frame is unavailable.');
        target.focus();
        target.print();
        // Keep the blob alive long enough for the native print dialog/viewer.
        window.setTimeout(cleanup, 60_000);
        resolve();
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error('The browser could not start printing.'));
      }
    };

    iframe.onerror = () => {
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error('The browser could not load the PDF for printing.'));
    };

    document.body.appendChild(iframe);
  });
}
