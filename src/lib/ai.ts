/**
 * Shared server-side AI service.
 *
 * All AI calls must go through this module so that:
 *  - feature flags are enforced centrally,
 *  - the API key never leaks into client bundles (never NEXT_PUBLIC_),
 *  - requests have a hard timeout and graceful fallback,
 *  - usage is logged for observability,
 *  - prompts are constructed without sensitive personal data beyond need.
 *
 * AI output is ADVISORY only — no approval, release, verification or
 * compliance decision is ever made by this module.
 */

import { env, hasEnvVar } from '@/env';

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

export type AiFeature =
  | 'predictive_maintenance'
  | 'reports'
  | 'request_assistant'
  | 'inspection_summaries'
  | 'receipt_ocr';

const FEATURE_ENV: Record<AiFeature, string> = {
  predictive_maintenance: 'AI_PREDICTIVE_MAINTENANCE_ENABLED',
  reports: 'AI_REPORTS_ENABLED',
  request_assistant: 'AI_REQUEST_ASSISTANT_ENABLED',
  inspection_summaries: 'AI_INSPECTION_SUMMARIES_ENABLED',
  receipt_ocr: 'AI_RECEIPT_OCR_ENABLED',
};

/** Whether the AI subsystem is enabled at all (master switch + API key). */
export function isAiConfigured(): boolean {
  return hasEnvVar('OPENAI_API_KEY') && env.AI_FEATURES_ENABLED !== 'false';
}

/** Whether a specific AI feature is switched on. */
export function isAiFeatureEnabled(feature: AiFeature): boolean {
  if (!isAiConfigured()) return false;
  return (process.env[FEATURE_ENV[feature]] ?? 'true') !== 'false';
}

// ---------------------------------------------------------------------------
// Usage logging + rate limiting
// ---------------------------------------------------------------------------

const CALL_WINDOW_MS = 60_000;
const MAX_CALLS_PER_WINDOW = 30;

/** Flat per-field confidence assigned to AI vision extraction (no per-field signal from the API). */
export const AI_OCR_CONFIDENCE = 0.85;
const callLog: Array<{
  at: number;
  feature: string;
  tenantId?: string;
  model: string;
  ok: boolean;
  inputTokens?: number;
  outputTokens?: number;
}> = [];

function logAiUsage(entry: (typeof callLog)[number]) {
  callLog.push(entry);
  if (callLog.length > 500) callLog.shift();
  console.info(
    `[ai] ${entry.feature} ${entry.ok ? 'ok' : 'failed'} model=${entry.model} tenant=${entry.tenantId ?? 'n/a'} tokens=${entry.inputTokens ?? 0}+${entry.outputTokens ?? 0}`,
  );
}

/** Lightweight in-process rate limiter (per tenant, sliding window). */
export function isAiRateLimited(tenantId?: string): boolean {
  const now = Date.now();
  const windowStart = now - CALL_WINDOW_MS;
  const recent = callLog.filter((entry) => entry.at >= windowStart && entry.tenantId === tenantId);
  return recent.length >= MAX_CALLS_PER_WINDOW;
}

// ---------------------------------------------------------------------------
// OpenAI chat completion helper (vision-capable)
// ---------------------------------------------------------------------------

export type OpenAiContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

type OpenAiMessage = {
  role: 'system' | 'user';
  content: string | OpenAiContentPart[];
};

type OpenAiResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

/**
 * Call the OpenAI Chat Completions API with a timeout.
 * Returns parsed JSON on success, or null when the call fails so callers can
 * fall back gracefully (e.g. to Tesseract or manual review).
 */
export async function callOpenAi(options: {
  feature: AiFeature;
  tenantId?: string;
  model?: string;
  system: string;
  user: string | OpenAiContentPart[];
  maxTokens?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
}): Promise<{ json: unknown; usage: { inputTokens: number; outputTokens: number } } | null> {
  if (!isAiFeatureEnabled(options.feature)) return null;
  if (isAiRateLimited(options.tenantId)) {
    console.warn(
      `[ai] rate limit hit for tenant=${options.tenantId ?? 'n/a'} feature=${options.feature}`,
    );
    return null;
  }
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = options.model ?? env.OPENAI_MODEL ?? 'gpt-5-mini';
  const maxTokens = Number(options.maxTokens ?? env.AI_MAX_OUTPUT_TOKENS ?? 1500);
  const timeoutMs = Number(options.timeoutMs ?? env.AI_REQUEST_TIMEOUT_MS ?? 30000);
  const supportsCustomTemperature = !/^(gpt-5|o\d)/i.test(model);

  const messages: OpenAiMessage[] = [
    { role: 'system', content: options.system },
    { role: 'user', content: options.user },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_completion_tokens: maxTokens,
        ...(supportsCustomTemperature ? { temperature: 0 } : {}),
        ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as OpenAiResponse | null;
      console.warn(`[ai] HTTP ${response.status}: ${body?.error?.message ?? 'unknown error'}`);
      logAiUsage({
        at: Date.now(),
        feature: options.feature,
        tenantId: options.tenantId,
        model,
        ok: false,
      });
      return null;
    }
    const data = (await response.json()) as OpenAiResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      logAiUsage({
        at: Date.now(),
        feature: options.feature,
        tenantId: options.tenantId,
        model,
        ok: false,
      });
      return null;
    }
    logAiUsage({
      at: Date.now(),
      feature: options.feature,
      tenantId: options.tenantId,
      model,
      ok: true,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
    });
    let json: unknown = null;
    if (options.jsonMode) {
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start >= 0 && end > start) {
        json = JSON.parse(content.slice(start, end + 1));
      }
    } else {
      json = content;
    }
    return {
      json,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    console.warn(
      `[ai] ${timedOut ? 'timeout' : 'request failed'} after ${timeoutMs}ms for ${options.feature}`,
    );
    logAiUsage({
      at: Date.now(),
      feature: options.feature,
      tenantId: options.tenantId,
      model,
      ok: false,
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Receipt OCR (OpenAI vision, structured)
// ---------------------------------------------------------------------------

/**
 * Extract structured fuel-receipt fields from an image using an
 * image-capable OpenAI model. Returns null (graceful) on any failure so the
 * caller can fall back to Tesseract or manual review.
 */
export async function extractReceiptWithAi(input: {
  imageBuffer: Buffer;
  mimeType: string;
  tenantId?: string;
}): Promise<{
  json: Record<string, unknown>;
  usage: { inputTokens: number; outputTokens: number };
} | null> {
  const { imageBuffer, mimeType, tenantId } = input;
  const base64 = imageBuffer.toString('base64');
  const result = await callOpenAi({
    feature: 'receipt_ocr',
    tenantId,
    system:
      'You extract structured data from fuel station receipts. Return ONLY a JSON object with these optional fields: ' +
      'supplier (string), stationLocation (string), transactionDate (string YYYY-MM-DD), transactionTime (string HH:MM), ' +
      'transactionReference (string), pumpNumber (string), fuelType (string), amount (number NAD), litres (number), ' +
      'pricePerLitre (number), odometer (number), registrationNumber (string), receiptNumber (string), vatNumber (string), ' +
      'attendant (string), cardNumber (string), vehicleMake (string), vehicleModel (string), vehicleColour (string). ' +
      'Omit any field you cannot read with confidence. Do not invent values.',
    user: [
      { type: 'text', text: 'Extract the receipt fields from this image as JSON.' },
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
    ],
    jsonMode: true,
  });
  if (!result || typeof result.json !== 'object' || result.json === null) return null;
  return { json: result.json as Record<string, unknown>, usage: result.usage };
}
