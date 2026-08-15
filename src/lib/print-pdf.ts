'use client';

/**
 * Open the canonical PDF in a top-level browser PDF viewer and request print.
 *
 * Chromium/WebKit PDF viewers are unreliable when `print()` is invoked from a
 * hidden iframe. A top-level viewer is substantially more reliable and, when a
 * browser still blocks scripted printing, leaves the official PDF visibly open
 * with the browser's native Print control available instead of failing silently.
 */
export async function printPdfFromUrl(url: string): Promise<void> {
  // Open synchronously while the click still counts as a user gesture. Waiting
  // for fetch() first can cause browsers to treat the window as a popup.
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    throw new Error('Printing was blocked by the browser. Allow pop-ups for this site and try again.');
  }

  printWindow.document.title = 'Preparing document for print';
  printWindow.document.body.innerHTML = `
    <main style="font-family:system-ui,sans-serif;padding:24px;color:#172033">
      <p>Preparing the official PDF for printing…</p>
    </main>
  `;

  try {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('The PDF could not be prepared for printing.');

    const blob = await response.blob();
    if (!blob.type.includes('pdf')) throw new Error('The server did not return a PDF.');

    const objectUrl = URL.createObjectURL(blob);
    let revoked = false;
    const revoke = () => {
      if (revoked) return;
      revoked = true;
      URL.revokeObjectURL(objectUrl);
    };

    printWindow.location.replace(objectUrl);

    // Native PDF viewers do not consistently dispatch DOM load/afterprint
    // events to the opener. Give the viewer time to initialise, then request
    // print. If scripted print is blocked, the top-level PDF remains visible so
    // the user can use its native Print button without dashboard chrome.
    window.setTimeout(() => {
      try {
        if (printWindow.closed) {
          revoke();
          return;
        }
        printWindow.focus();
        printWindow.print();
      } catch {
        // Keep the top-level PDF open as the intentional native-print fallback.
      }
    }, 900);

    // Do not revoke while the browser PDF viewer may still be reading/printing.
    // This is only a bounded cleanup fallback; closing the page releases it too.
    window.setTimeout(revoke, 120_000);
  } catch (error) {
    printWindow.close();
    throw error;
  }
}
