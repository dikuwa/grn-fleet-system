import { afterEach, describe, expect, it, vi } from 'vitest';
import { printPdfFromUrl } from './print-pdf';

describe('PDF printing', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens the canonical PDF in the native viewer without invoking cross-origin print', async () => {
    vi.useFakeTimers();
    const replace = vi.fn();
    const print = vi.fn();
    const printWindow = {
      closed: false,
      close: vi.fn(),
      print,
      document: { title: '', body: { innerHTML: '' } },
      location: { replace },
    } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(printWindow);

    const pdfBlob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(pdfBlob, {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      }),
    );
    const createObjectUrl = vi.fn().mockReturnValue('blob:https://fleet.example/canonical-pdf');
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl });

    await printPdfFromUrl('/api/documents/document-1/pdf?preview=1');

    expect(fetchMock).toHaveBeenCalledWith('/api/documents/document-1/pdf?preview=1', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/pdf' },
    });
    expect(createObjectUrl).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/pdf' }));
    expect(replace).toHaveBeenCalledWith('blob:https://fleet.example/canonical-pdf');
    expect(print).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(print).not.toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:https://fleet.example/canonical-pdf');
  });

  it('closes the preparation window when the endpoint does not return a PDF', async () => {
    const close = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({
      close,
      document: { title: '', body: { innerHTML: '' } },
    } as unknown as Window);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not authorised', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    await expect(printPdfFromUrl('/api/documents/document-1/pdf?preview=1')).rejects.toThrow(
      'The server did not return a PDF.',
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
