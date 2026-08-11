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
  const cleanup = () => {
    window.setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(objectUrl);
    }, 1_000);
  };
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } finally {
      cleanup();
    }
  };
  document.body.appendChild(frame);
}
