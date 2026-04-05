/**
 * Generic retry utility with exponential backoff + jitter.
 *
 * Designed for production use across all fault-tolerant operations:
 *   - S3 downloads
 *   - ClickHouse batch inserts
 *   - External API calls
 *   - Any future I/O-bound operation
 *
 * No hardcoded behavior — everything is configurable via RetryOptions.
 */

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Must be >= 1. */
  maxAttempts: number;

  /** Base delay in ms before the first retry. Default: 1000. */
  baseDelayMs?: number;

  /** Maximum delay cap in ms (prevents exponential explosion). Default: 30000. */
  maxDelayMs?: number;

  /** Multiplier applied to delay on each subsequent retry. Default: 2. */
  backoffMultiplier?: number;

  /** Jitter range [0, 1] — fraction of delay added randomly. Default: 0.25. */
  jitterFraction?: number;

  /**
   * Predicate that determines if an error is retryable.
   * If omitted, ALL errors are retried.
   * Return false to fail immediately without further retries.
   */
  isRetryable?: (error: Error) => boolean;

  /**
   * Callback fired before each retry. Use for logging.
   * @param error — the error that caused the retry
   * @param attempt — which attempt just failed (1-indexed)
   * @param nextDelayMs — how long we'll wait before the next attempt
   */
  onRetry?: (error: Error, attempt: number, nextDelayMs: number) => void;

  /** Abort signal — allows external cancellation of the retry loop. */
  abortSignal?: AbortSignal;
}

/**
 * Execute an async function with automatic retry on failure.
 *
 * @example
 * ```ts
 * const data = await withRetry(
 *   () => downloadFromS3(bucket, key),
 *   {
 *     maxAttempts: 4,
 *     baseDelayMs: 2000,
 *     isRetryable: (e) => isTransientNetworkError(e),
 *     onRetry: (e, attempt, delay) => console.log(`Retry ${attempt}, waiting ${delay}ms: ${e.message}`),
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const {
    maxAttempts,
    baseDelayMs = 1000,
    maxDelayMs = 30_000,
    backoffMultiplier = 2,
    jitterFraction = 0.25,
    isRetryable,
    onRetry,
    abortSignal,
  } = options;

  if (maxAttempts < 1) throw new Error('withRetry: maxAttempts must be >= 1');

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check for external cancellation before each attempt
    if (abortSignal?.aborted) {
      throw new Error('Retry aborted by signal');
    }

    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Check if error is non-retryable
      if (isRetryable && !isRetryable(lastError)) {
        throw lastError;
      }

      // If this was the last attempt, throw immediately
      if (attempt >= maxAttempts) {
        throw lastError;
      }

      // Calculate delay with exponential backoff + jitter
      const rawDelay = baseDelayMs * Math.pow(backoffMultiplier, attempt - 1);
      const clampedDelay = Math.min(rawDelay, maxDelayMs);
      const jitter = clampedDelay * jitterFraction * Math.random();
      const delay = Math.round(clampedDelay + jitter);

      // Notify caller
      onRetry?.(lastError, attempt, delay);

      // Wait
      await sleep(delay, abortSignal);
    }
  }

  // Unreachable in normal flow, but TypeScript needs it
  throw lastError ?? new Error('withRetry: exhausted all attempts');
}

/**
 * Common retryable-error predicate for network/IO operations.
 * Matches transient errors from S3, ClickHouse, and HTTP clients.
 */
export function isTransientError(error: Error): boolean {
  const msg = (error.message || '').toLowerCase();
  const transientPatterns = [
    'epipe',
    'econnreset',
    'econnrefused',
    'etimedout',
    'socket hang up',
    'socket closed',
    'network',
    'timeout',
    'aborted',
    'enotfound',
    'ehostunreach',
    'eai_again',        // DNS resolution failure
    'request aborted',
    'premature close',
    'unexpected end',
    'connection reset',
  ];
  return transientPatterns.some(pattern => msg.includes(pattern));
}

/** Abortable sleep */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Sleep aborted'));

    const timer = setTimeout(resolve, ms);

    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Sleep aborted'));
    }, { once: true });
  });
}
