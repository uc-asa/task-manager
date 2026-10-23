/**
 * The masking policy: the ONE place that decides which values never reach the logs.
 * Code anywhere in the app can log whatever context it likes; anything whose field name looks
 * sensitive is replaced here, at any depth, in any letter case. It lives in our own code (not in
 * the logging library's options) so the policy survives swapping pino for another logger.
 *
 * Matching is by field NAME and errs on the side of masking: `refreshToken`, `x-api-key`,
 * `Set-Cookie` and `clientSecret` are all caught. To mask something new, add it to the pattern.
 */
const SENSITIVE_KEY =
  /pass(word|wd)|secret|token|authorization|cookie|api[-_]?key|idempotency[-_]?key/i;

export const REDACTED = '[Redacted]';

/** Deeper than this is not inspected; it is replaced, never logged unchecked. */
const MAX_DEPTH = 8;

function mask(value: unknown, depth: number, path: Set<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  // Leave these as they are: the logger knows how to serialise them.
  if (value instanceof Error || value instanceof Date || Buffer.isBuffer(value)) return value;

  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (path.has(value)) return '[Circular]';

  path.add(value);
  const masked = Array.isArray(value)
    ? value.map((item) => mask(item, depth + 1, path))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          SENSITIVE_KEY.test(key) ? REDACTED : mask(item, depth + 1, path),
        ]),
      );
  path.delete(value); // only real cycles count; the same object used twice is fine
  return masked;
}

/** Returns a masked copy. The original object is never modified. */
export const maskSecrets = <T>(value: T): T => mask(value, 0, new Set()) as T;
