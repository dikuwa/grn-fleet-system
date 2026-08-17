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
  if (!printWindow) {
    throw new Error('Printing was blocked by the browser. Allow pop-ups for this site and try again.');
  }

  printWindow.document.title = 'Preparing official document';
  printWindow.document.body.innerHTML = `
    <main style="font-family:system-ui,sans-serif;padding:24px;color:#172033;background:#fff">
      <p>Preparing the official PDF for printing…</p>
    </main>
  `;

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

    // Navigate the top-level window to the original PDF bytes. Chromium,
    // WebKit and Firefox can then print the PDF as PDF/vector content instead of
    // printing screenshots of rendered pages.
    printWindow.location.replace(objectUrl);

    // Native PDF viewers do not expose a reliable load event to the opener.
    // Request print after the viewer has had time to initialise. If a browser
    // blocks scripted printing, the original PDF remains open with its native
    // Print control available, which is preferable to degrading document quality.
    window.setTimeout(() => {
      try {
        if (printWindow.closed) {
          revoke();
          return;
        }
        printWindow.focus();
        printWindow.print();
      } catch {
        // Intentional fallback: leave the native PDF viewer open.
      }
    }, 1200);

    // Keep the object URL alive long enough for the viewer and print dialog to
    // finish reading the PDF. Browser/page teardown will also release it.
    window.setTimeout(revoke, 5 * 60 * 1000);
  } catch (error) {
    printWindow.close();
    throw error instanceof Error ? error : new Error('The browser could not start printing.');
  }
}
