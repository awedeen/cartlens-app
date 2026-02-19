// Security utilities for CartLens

// ---------------------------------------------------------------------------
// In-memory rate limiter (per IP)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

/**
 * Returns true if the request should be allowed, false if rate limited.
 * @param key        Identifier — typically client IP
 * @param maxRequests Max allowed requests per window
 * @param windowMs   Window duration in ms (default 60 seconds)
 */
export function checkRateLimit(
  key: string,
  maxRequests: number = 60,
  windowMs: number = 60_000
): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) {
    return false;
  }

  entry.count += 1;
  return true;
}

// Clean up stale entries every 10 minutes to prevent memory creep
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 600_000);

// ---------------------------------------------------------------------------
// Input sanitization
// ---------------------------------------------------------------------------

/**
 * Trims a value to a safe maximum string length.
 * Returns null if the value is null/undefined/empty.
 */
export function sanitizeString(
  value: string | null | undefined,
  maxLength: number = 255
): string | null {
  if (!value) return null;
  const trimmed = String(value).trim().slice(0, maxLength);
  return trimmed || null;
}
