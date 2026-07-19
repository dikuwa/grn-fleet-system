/**
 * Rate Limiter
 *
 * Provides a simple in-memory rate limiter (fallback) and an
 * Upstash/Redis-backed limiter when configured via env vars.
 *
 * Usage in route handlers or middleware:
 *
 *   const { success, headers } = await rateLimit(request, 'login', 5, 60);
 *   if (!success) return new NextResponse('Too Many Requests', { status: 429, headers });
 */

import { env } from '@/env';

// ---------------------------------------------------------------------------
// In-memory token bucket (fallback when Upstash is not configured)
// ---------------------------------------------------------------------------

interface BucketEntry {
  tokens: number;
  resetAt: number;
}

const buckets = new Map<string, BucketEntry>();

// Clean up stale entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (entry.resetAt < now) buckets.delete(key);
    }
  }, 300_000);
}

async function inMemoryCheck(
  key: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<{ success: boolean; remaining: number; resetAt: number }> {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || entry.resetAt < now) {
    // Fresh window
    buckets.set(key, { tokens: maxRequests - 1, resetAt: now + windowSeconds * 1000 });
    return { success: true, remaining: maxRequests - 1, resetAt: now + windowSeconds * 1000 };
  }

  if (entry.tokens > 0) {
    entry.tokens -= 1;
    return { success: true, remaining: entry.tokens, resetAt: entry.resetAt };
  }

  return { success: false, remaining: 0, resetAt: entry.resetAt };
}

// ---------------------------------------------------------------------------
// Rate limit result
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  success: boolean;
  headers: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Main rateLimit function
// ---------------------------------------------------------------------------

/**
 * Check a rate limit for the given key.
 *
 * @param key      Unique identifier (e.g. `ip:login:user-email`)
 * @param maxRequests  Maximum requests allowed in the window (default 10)
 * @param windowSeconds  Window duration in seconds (default 60)
 */
export async function rateLimit(
  key: string,
  maxRequests: number = 10,
  windowSeconds: number = 60,
): Promise<RateLimitResult> {
  const hasRedis = !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);

  if (hasRedis) {
    // Upstash/Redis-backed rate limiter
    try {
      const now = Math.floor(Date.now() / 1000);

      // Use a simple sliding window via sorted sets via EVAL script
      const script = `
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local window = tonumber(ARGV[2])
        local max = tonumber(ARGV[3])
        local windowStart = now - window

        redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
        local count = redis.call('ZCARD', key)

        if count >= max then
          local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
          local resetAt = tonumber(oldest[2]) + window
          return {0, resetAt}
        end

        redis.call('ZADD', key, now, now .. ':' .. math.random())
        redis.call('EXPIRE', key, window * 2)
        local remaining = max - count - 1
        return {1, now + window}
      `;

      const res = await fetch(
        `${env.UPSTASH_REDIS_REST_URL!.replace(/\/$/, '')}/eval`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            script,
            keys: [`ratelimit:${key}`],
            args: [now, windowSeconds, maxRequests],
          }),
        },
      );

      const data = await res.json();
      const [success, resetAt] = data.result as [number, number];

      return {
        success: success === 1,
        headers: {
          'X-RateLimit-Limit': String(maxRequests),
          'X-RateLimit-Remaining': success === 1 ? String(maxRequests - 1) : '0',
          'X-RateLimit-Reset': String(resetAt),
          'Retry-After': success === 1 ? '0' : String(Math.max(1, resetAt - now)),
        },
      };
    } catch {
      // Fall through to in-memory on Redis failure
    }
  }

  // Fallback: in-memory
  const result = await inMemoryCheck(key, maxRequests, windowSeconds);
  return {
    success: result.success,
    headers: {
      'X-RateLimit-Limit': String(maxRequests),
      'X-RateLimit-Remaining': String(result.remaining),
      'X-RateLimit-Reset': String(Math.floor(result.resetAt / 1000)),
      'Retry-After': result.success ? '0' : String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))),
    },
  };
}
