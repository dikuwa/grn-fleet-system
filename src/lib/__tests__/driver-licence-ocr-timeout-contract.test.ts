import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/drivers/[id]/licences/route.ts'),
  'utf8',
);
const helper = readFileSync(resolve(process.cwd(), 'src/lib/tesseract-ocr.ts'), 'utf8');

describe('driver licence OCR execution boundary', () => {
  it('routes front/back image OCR through the bounded shared helper', () => {
    expect(route).not.toContain("from 'tesseract.js'");
    expect(route).not.toContain("createWorker('eng')");
    expect(route).not.toContain('worker.recognize(');
    expect(route).toContain('recognizeManyWithTesseract(preparedImages)');
    expect(route).toContain("qualityWarnings.push('ocr_timeout_manual_entry_required')");
    expect(route).toContain("qualityWarnings.push('ocr_failed_manual_entry_required')");
  });

  it('shares one worker and one total deadline across the image batch', () => {
    const many = helper.indexOf('export async function recognizeManyWithTesseract');
    const deadline = helper.indexOf('const deadline = Date.now() + timeoutMs', many);
    const worker = helper.indexOf('const workerPromise =', deadline);
    const loop = helper.indexOf('for (const image of images)', worker);
    const recognize = helper.indexOf('worker.recognize(image)', loop);
    const remaining = helper.indexOf('remainingMs(deadline)', recognize);
    const terminate = helper.indexOf('await terminateWorker(worker)', recognize);

    expect(many).toBeGreaterThan(-1);
    expect(deadline).toBeGreaterThan(many);
    expect(worker).toBeGreaterThan(deadline);
    expect(loop).toBeGreaterThan(worker);
    expect(recognize).toBeGreaterThan(loop);
    expect(remaining).toBeGreaterThan(recognize);
    expect(terminate).toBeGreaterThan(recognize);
  });
});
