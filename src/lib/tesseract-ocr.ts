const DEFAULT_TESSERACT_TIMEOUT_MS = 20_000;
const TERMINATION_GRACE_MS = 2_000;

export type TesseractRecognition = {
  data: {
    text: string;
    confidence: number;
  };
};

type TesseractWorker = {
  recognize(image: Buffer): Promise<TesseractRecognition>;
  terminate(): Promise<unknown>;
};

type WorkerFactory = () => Promise<TesseractWorker>;

type TesseractOptions = {
  timeoutMs?: number;
  workerFactory?: WorkerFactory;
};

export class TesseractOcrTimeoutError extends Error {
  constructor(public timeoutMs: number) {
    super(`Tesseract OCR exceeded its ${timeoutMs}ms processing deadline.`);
    this.name = 'TesseractOcrTimeoutError';
  }
}

async function defaultWorkerFactory(): Promise<TesseractWorker> {
  const { createWorker } = await import('tesseract.js');
  return createWorker('eng');
}

function remainingMs(deadline: number) {
  return Math.max(1, deadline - Date.now());
}

async function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number, totalTimeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TesseractOcrTimeoutError(totalTimeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function terminateWorker(worker: TesseractWorker) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      worker.terminate(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, TERMINATION_GRACE_MS);
      }),
    ]);
  } catch (error) {
    console.warn('[tesseract-ocr] Worker termination failed:', error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Recognize one or more images with a single Tesseract worker under one total
 * application-level deadline covering worker startup and every recognition.
 * The worker is always terminated best-effort, including when startup itself
 * finishes only after the deadline has already expired.
 */
export async function recognizeManyWithTesseract(
  images: Buffer[],
  options: TesseractOptions = {},
): Promise<TesseractRecognition[]> {
  if (!images.length) return [];

  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TESSERACT_TIMEOUT_MS);
  const deadline = Date.now() + timeoutMs;
  const workerPromise = (options.workerFactory ?? defaultWorkerFactory)();
  let worker: TesseractWorker | null = null;

  try {
    worker = await raceWithTimeout(workerPromise, remainingMs(deadline), timeoutMs);
    const results: TesseractRecognition[] = [];
    for (const image of images) {
      results.push(
        await raceWithTimeout(worker.recognize(image), remainingMs(deadline), timeoutMs),
      );
    }
    return results;
  } finally {
    if (worker) {
      await terminateWorker(worker);
    } else {
      // Worker creation can finish after the deadline. Attach cleanup now so a
      // late worker cannot remain alive after the request has already fallen back.
      void workerPromise.then(terminateWorker).catch(() => undefined);
    }
  }
}

/**
 * Run single-image Tesseract OCR through the shared bounded worker lifecycle.
 * Existing receipt OCR callers retain the same API while multi-image callers
 * can share one worker and one total deadline via recognizeManyWithTesseract.
 */
export async function recognizeWithTesseract(
  image: Buffer,
  options: TesseractOptions = {},
): Promise<TesseractRecognition> {
  const [result] = await recognizeManyWithTesseract([image], options);
  return result;
}
