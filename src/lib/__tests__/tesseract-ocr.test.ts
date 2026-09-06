import { describe, expect, it, vi } from 'vitest';
import {
  recognizeManyWithTesseract,
  recognizeWithTesseract,
  TesseractOcrTimeoutError,
} from '../tesseract-ocr';

describe('bounded Tesseract OCR', () => {
  it('returns single-image recognition data and always terminates the worker', async () => {
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

  it('reuses one worker for multiple images and terminates it once', async () => {
    const terminate = vi.fn(async () => undefined);
    const recognize = vi
      .fn()
      .mockResolvedValueOnce({ data: { text: 'FRONT', confidence: 90 } })
      .mockResolvedValueOnce({ data: { text: 'BACK', confidence: 80 } });
    const workerFactory = vi.fn(async () => ({ recognize, terminate }));

    const results = await recognizeManyWithTesseract(
      [Buffer.from('front'), Buffer.from('back')],
      { timeoutMs: 100, workerFactory },
    );

    expect(results.map((result) => result.data.text)).toEqual(['FRONT', 'BACK']);
    expect(workerFactory).toHaveBeenCalledTimes(1);
    expect(recognize).toHaveBeenCalledTimes(2);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('uses one total deadline across a multi-image recognition batch', async () => {
    const terminate = vi.fn(async () => undefined);
    const recognize = vi
      .fn()
      .mockResolvedValueOnce({ data: { text: 'FRONT', confidence: 90 } })
      .mockImplementationOnce(
        () => new Promise<{ data: { text: string; confidence: number } }>(() => undefined),
      );

    await expect(
      recognizeManyWithTesseract([Buffer.from('front'), Buffer.from('back')], {
        timeoutMs: 10,
        workerFactory: async () => ({ recognize, terminate }),
      }),
    ).rejects.toBeInstanceOf(TesseractOcrTimeoutError);

    expect(recognize).toHaveBeenCalledTimes(2);
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
