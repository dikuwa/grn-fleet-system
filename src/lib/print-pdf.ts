'use client';

/**
 * Print the canonical PDF through the browser's native PDF viewer.
 *
 * Do not rasterise official PDFs into canvas pages before printing: even at
 * high DPI that converts vector text, rules, QR codes and logos into bitmaps and
 * can look soft/washed out in print preview. Passing the original PDF bytes to
 * the native viewer preserves embedded fonts and vector content all the way to
 * the printer/PDF destination.
 */
export async function printPdfFromUrl(url: string): Promise<void> {
  // Open synchronously while the click is still a trusted user gesture so
  // browsers do not classify the print viewer as an unsolicited popup.
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.title = 'Preparing official document';
    printWindow.document.body.innerHTML = `
      <main style="font-family:system-ui,sans-serif;padding:24px;color:#172033;background:#fff">
        <p>Opening the official PDF…</p>
        <p>Use the browser PDF viewer's Print control for full-quality printing.</p>
      </main>
    `;
  }

  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/pdf' },
    });

    if (!response.ok) {
      throw new Error('The PDF could not be prepared for printing.');
    }

    const blob = await response.blob();
    if (!blob.type.includes('pdf')) {
      throw new Error('The server did not return a PDF.');
    }

    const objectUrl = URL.createObjectURL(blob);
    let revoked = false;
    const revoke = () => {
      if (revoked) return;
      revoked = true;
      URL.revokeObjectURL(objectUrl);
    };

    if (printWindow) {
      // Navigate the new top-level window to the original PDF bytes. Chromium,
      // WebKit and Firefox can then print the PDF as PDF/vector content instead
      // of printing screenshots of rendered pages.
      printWindow.location.replace(objectUrl);

      // Keep the object URL alive long enough for the viewer and print dialog
      // to finish reading the PDF. Browser/page teardown will also release it.
      window.setTimeout(revoke, 5 * 60 * 1000);
    } else {
      // Strict popup policies can reject even a synchronous window.open call.
      // A same-tab navigation is not a popup and therefore remains reliable.
      // Do not revoke this URL here: navigating away destroys this page and the
      // browser releases the object URL with its document.
      const currentTabLink = document.createElement('a');
      currentTabLink.href = objectUrl;
      currentTabLink.target = '_self';
      currentTabLink.rel = 'noopener';
      currentTabLink.click();
    }

    // Do not call printWindow.print() after this navigation. Chromium hands
    // blob PDFs to its extension-backed viewer, whose window is cross-origin
    // from the application. Calling Window#print across that boundary either
    // throws a security error or prints the viewer surface as a rasterised web
    // page. The native viewer remains open with its own Print control, which
    // sends the canonical PDF bytes to the print pipeline without resampling.

  } catch (error) {
    printWindow?.close();
    throw error instanceof Error ? error : new Error('The browser could not start printing.');
  }
}
