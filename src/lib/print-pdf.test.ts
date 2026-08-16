import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPdfBytes, loadPdfJs } from './pdfjs-client';
import { printPdfFromUrl } from './print-pdf';

vi.mock('./pdfjs-client', () => ({
  fetchPdfBytes: vi.fn(),
  loadPdfJs: vi.fn(),
}));

describe('PDF printing', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('prints rendered pages from a same-origin document without navigating the iframe', async () => {
    vi.useFakeTimers();
    const render = vi.fn().mockReturnValue({ promise: Promise.resolve() });
    const cleanupPage = vi.fn();
    const destroyPdf = vi.fn();
    const getPage = vi.fn().mockResolvedValue({
      getViewport: () => ({ width: 595, height: 842 }),
      render,
      cleanup: cleanupPage,
    });

    vi.mocked(fetchPdfBytes).mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45]));
    vi.mocked(loadPdfJs).mockResolvedValue({
      getDocument: () => ({
        promise: Promise.resolve({ numPages: 1, getPage, destroy: destroyPdf }),
      }),
    });

    const canvasContext = {
      fillStyle: '',
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext);
    const print = vi.fn();
    const focus = vi.fn();
    const appendChild = document.body.appendChild.bind(document.body);
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      const appended = appendChild(node);
      if (node instanceof HTMLIFrameElement && node.contentWindow) {
        Object.defineProperty(node.contentWindow, 'print', { configurable: true, value: print });
        Object.defineProperty(node.contentWindow, 'focus', { configurable: true, value: focus });
        Object.defineProperty(node.contentWindow.HTMLCanvasElement.prototype, 'getContext', {
          configurable: true,
          value: () => canvasContext,
        });
      }
      return appended;
    });

    let printFrame: HTMLIFrameElement | null = null;
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = createElement(tagName, options);
      if (tagName === 'iframe') printFrame = element as HTMLIFrameElement;
      return element;
    });

    await printPdfFromUrl('/api/documents/document-1/pdf?preview=1');

    expect(printFrame).not.toBeNull();
    expect(printFrame!.getAttribute('src')).toBeNull();
    expect(getPage).toHaveBeenCalledWith(1);
    expect(render).toHaveBeenCalledOnce();
    expect(cleanupPage).toHaveBeenCalledOnce();
    expect(print).toHaveBeenCalledOnce();

    vi.runAllTimers();
    expect(destroyPdf).toHaveBeenCalledOnce();
  });
});
