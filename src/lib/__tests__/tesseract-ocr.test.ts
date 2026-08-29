import { describe, expect, it, vi } from 'vitest';
import { recognizeWithTesseract, TesseractOcrTimeoutError } from '../tesseract-ocr';

describe('recognizeWithTesseract', () => {
  it('returns recognition data and always terminates the worker', async () => {
    const terminate = vi.fn(async () => undefined);
    const recognize = vi.fn(async () => ({ data: { text: 'TOTAL N$ 100.00', confidence: 92 } }));

    const result = await recognizeWithTesseract(Buffer.from('image'), {
      timeoutMs: 100,
      workerFactory: async () => ({ recognize, terminate }),
    });

    expect(result.data.text).toContain('TOTAL');
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('times out stalled recognition and terminates the worker for manual-entry fallback', async () => {
    const terminate = vi.fn(async () => undefined);
    const recognize = vi.fn(() => new Promise<{ data: { text: string; confidence: number } }>(() => undefined));

    await expect(
      recognizeWithTesseract(Buffer.from('image'), {
        timeoutMs: 10,
        workerFactory: async () => ({ recognize, terminate }),
      }),
    ).rejects.toBeInstanceOf(TesseractOcrTimeoutError);

    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
