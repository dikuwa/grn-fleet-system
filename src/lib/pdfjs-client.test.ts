import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPdfBytes, loadPdfJs } from './pdfjs-client';

describe('PDF client infrastructure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches protected PDF bytes with same-origin credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new TextEncoder().encode('%PDF-test'), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const bytes = await fetchPdfBytes('/api/documents/doc-1/pdf?preview=1');

    expect(new TextDecoder().decode(bytes)).toBe('%PDF-test');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/documents/doc-1/pdf?preview=1',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });

  it('reports the HTTP status when a protected PDF fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));

    await expect(fetchPdfBytes('/api/documents/forbidden/pdf')).rejects.toThrow('HTTP 403');
  });

  it('does not contain a runtime CDN loader', () => {
    expect(loadPdfJs.toString()).not.toContain('jsdelivr');
    expect(loadPdfJs.toString()).not.toContain('https://');
  });
});
