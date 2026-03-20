import { resolveMx } from './engine/mxResolver.js';
import { probeEmail, type SmtpProbeResult } from './engine/smtpProbe.js';
import { isDisposable } from './engine/disposableDomains.js';
import {
  acquireSlot,
  releaseSlot,
  applyBackoff,
  resetBackoff,
  setLimits,
  resetLimiter,
  getActiveConnections,
} from './engine/rateLimiter.js';
import { clearMxCache, getMxCacheSize } from './engine/mxResolver.js';
import type { VerificationResult } from './verification.js';

// ═══════════════════════════════════════════════════════════════
// Built-In Verification Engine — Orchestrator
//
// Coordinates all engine modules to verify batches of emails:
//   1. Group emails by domain
//   2. Disposable domain check (instant, no SMTP)
//   3. MX resolution (cached DNS)
//   4. Catch-all detection (one probe per domain)
//   5. Individual email verification (SMTP RCPT TO)
//
// All operations are rate-limited per domain with backoff support.
// No external dependencies — uses Node.js built-in dns & net modules.
// ═══════════════════════════════════════════════════════════════

export interface EngineConfig {
  /** Domain for EHLO announcement (must have valid rDNS in production) */
  heloDomain: string;
  /** Envelope MAIL FROM address */
  fromEmail: string;
  /** Max domains to process concurrently */
  concurrency: number;
  /** Per-connection timeout in ms */
  timeout: number;
  /** SMTP port (default 25) */
  port: number;
  /** Enable catch-all domain detection */
  enableCatchAllDetection: boolean;
  /** Minimum ms between connections to same domain */
  minIntervalMs: number;
  /** Max concurrent connections per domain */
  maxConcurrentPerDomain: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  heloDomain: 'mail.refinery.local',
  fromEmail: 'verify@refinery.local',
  concurrency: 10,
  timeout: 15_000,
  port: 25,
  enableCatchAllDetection: true,
  minIntervalMs: 2_000,
  maxConcurrentPerDomain: 2,
};

// Catch-all domain cache (domain → isCatchAll)
const catchAllCache = new Map<string, boolean | null>();
const CATCH_ALL_CACHE_MAX = 10_000;

/**
 * Verify a batch of email addresses using the built-in SMTP engine.
 * Returns results in the same format as the Verify550 API for seamless integration.
 */
export async function verifyBatch(
  emails: string[],
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): Promise<VerificationResult[]> {
  // Apply rate limiter configuration
  setLimits({
    minIntervalMs: config.minIntervalMs,
    maxConcurrentPerDomain: config.maxConcurrentPerDomain,
    globalMaxConcurrent: config.concurrency * 5, // Allow 5x domain-level concurrency globally
  });

  // ── Group emails by domain ──
  const byDomain = new Map<string, { email: string; index: number }[]>();
  const results: VerificationResult[] = [];

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i].trim().toLowerCase();
    const atIndex = email.indexOf('@');

    if (atIndex === -1 || atIndex === 0 || atIndex === email.length - 1) {
      // Invalid email format — no @ or nothing before/after it
      results.push({ email: emails[i], status: 'invalid', reason: 'invalid_format' });
      continue;
    }

    const domain = email.substring(atIndex + 1);
    results.push({ email: emails[i], status: 'unknown', reason: 'pending' });

    const list = byDomain.get(domain) || [];
    list.push({ email, index: i });
    byDomain.set(domain, list);
  }

  // ── Process domains concurrently (worker pool pattern) ──
  const domainEntries = [...byDomain.entries()];
  let domainIndex = 0;
  const workerCount = Math.min(config.concurrency, domainEntries.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (domainIndex < domainEntries.length) {
      const currentIndex = domainIndex++;
      const [domain, emailEntries] = domainEntries[currentIndex];
      await processDomain(domain, emailEntries, results, config);
    }
  });

  await Promise.all(workers);
  return results;
}

// ─── Per-Domain Processing Pipeline ───

async function processDomain(
  domain: string,
  entries: { email: string; index: number }[],
  results: VerificationResult[],
  config: EngineConfig,
): Promise<void> {
  // ── Step 1: Disposable domain check ──
  if (isDisposable(domain)) {
    for (const entry of entries) {
      results[entry.index] = {
        email: entry.email,
        status: 'disposable',
        reason: 'disposable_domain',
      };
    }
    return;
  }

  // ── Step 2: MX resolution ──
  let mxRecords;
  try {
    mxRecords = await resolveMx(domain);
  } catch (err: any) {
    // DNS resolution error — mark all as unknown
    for (const entry of entries) {
      results[entry.index] = {
        email: entry.email,
        status: 'unknown',
        reason: `dns_error: ${err.message}`,
      };
    }
    return;
  }

  if (mxRecords.length === 0) {
    // No MX records and no A record fallback — domain cannot receive mail
    for (const entry of entries) {
      results[entry.index] = {
        email: entry.email,
        status: 'invalid',
        reason: 'no_mx_records',
      };
    }
    return;
  }

  // ── Step 3: Catch-all detection (one probe per domain) ──
  if (config.enableCatchAllDetection && !catchAllCache.has(domain)) {
    await detectCatchAll(domain, mxRecords[0].exchange, config);
  }

  const isCatchAll = catchAllCache.get(domain);
  if (isCatchAll === true) {
    for (const entry of entries) {
      results[entry.index] = {
        email: entry.email,
        status: 'catch-all',
        reason: 'catch_all_domain',
      };
    }
    return;
  }

  // ── Step 4: Individual SMTP verification ──
  for (const entry of entries) {
    await acquireSlot(domain);
    try {
      const result = await probeWithFallback(mxRecords, entry.email, config);

      // Map granular SMTP statuses to VerificationResult format
      const SMTP_TO_VERIFY: Record<string, VerificationResult['status']> = {
        valid: 'valid', invalid: 'invalid', risky: 'risky',
        greylisted: 'risky', mailbox_full: 'risky', unknown: 'unknown',
      };

      results[entry.index] = {
        email: entry.email,
        status: SMTP_TO_VERIFY[result.status] ?? 'unknown',
        reason: result.response.substring(0, 200),
      };

      // Adaptive backoff on 4xx responses
      if (['risky', 'greylisted', 'mailbox_full'].includes(result.status) && result.code >= 400 && result.code < 500) {
        applyBackoff(domain);
      } else if (result.status === 'valid' || result.status === 'invalid') {
        resetBackoff(domain);
      }
    } catch (err: any) {
      results[entry.index] = {
        email: entry.email,
        status: 'unknown',
        reason: `probe_error: ${err.message}`,
      };
    } finally {
      releaseSlot(domain);
    }
  }
}

// ─── Catch-All Detection ───

/**
 * Detect if a domain is catch-all by probing a random non-existent address.
 * If the domain accepts it, every address at that domain is valid (catch-all).
 */
async function detectCatchAll(
  domain: string,
  mxHost: string,
  config: EngineConfig,
): Promise<void> {
  // Generate a provably random address that won't exist
  const randomLocal = `xrfnry_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const probeAddress = `${randomLocal}@${domain}`;

  await acquireSlot(domain);
  try {
    const result = await probeEmail(mxHost, probeAddress, {
      heloDomain: config.heloDomain,
      fromEmail: config.fromEmail,
      timeout: config.timeout,
      port: config.port,
    });

    // If the random address is "valid" → domain is catch-all
    catchAllCache.set(domain, result.status === 'valid');
    evictCatchAllCache();
  } catch {
    // Can't determine — treat as non-catch-all (safer: individual checks will run)
    catchAllCache.set(domain, null);
  } finally {
    releaseSlot(domain);
  }
}

// ─── MX Fallback ───

/**
 * Try probing through each MX host in priority order.
 * Falls back to the next MX if the current one is unreachable.
 */
async function probeWithFallback(
  mxRecords: { exchange: string; priority: number }[],
  email: string,
  config: EngineConfig,
): Promise<SmtpProbeResult> {
  let lastResult: SmtpProbeResult = { status: 'unknown', code: 0, response: 'No MX hosts reachable', starttls: false };

  for (const mx of mxRecords) {
    try {
      const result = await probeEmail(mx.exchange, email, {
        heloDomain: config.heloDomain,
        fromEmail: config.fromEmail,
        timeout: config.timeout,
        port: config.port,
      });

      lastResult = result;

      // If we got a definitive answer, stop trying other MX hosts
      if (result.status === 'valid' || result.status === 'invalid') {
        return result;
      }

      // For risky/unknown, try next MX (might get a cleaner answer)
    } catch {
      continue;
    }
  }

  return lastResult;
}

// ─── Engine Stats / Management ───

/** Get current engine runtime stats */
export function getEngineStats(): {
  activeConnections: number;
  mxCacheSize: number;
  catchAllCacheSize: number;
} {
  return {
    activeConnections: getActiveConnections(),
    mxCacheSize: getMxCacheSize(),
    catchAllCacheSize: catchAllCache.size,
  };
}

/** Clear all engine caches (MX, catch-all, rate limiter) */
export function resetEngine(): void {
  clearMxCache();
  catchAllCache.clear();
  resetLimiter();
}

/** Evict oldest entries from catch-all cache when it exceeds capacity */
function evictCatchAllCache(): void {
  if (catchAllCache.size <= CATCH_ALL_CACHE_MAX) return;
  const toDelete = Math.floor(CATCH_ALL_CACHE_MAX * 0.2);
  const keys = catchAllCache.keys();
  for (let i = 0; i < toDelete; i++) {
    const next = keys.next();
    if (next.done) break;
    catchAllCache.delete(next.value);
  }
}
