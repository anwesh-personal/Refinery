import dns from 'dns/promises';

// ═══════════════════════════════════════════════════════════════
// MX Resolver — DNS MX record lookup with TTL-based caching
//
// - Resolves MX records for a given domain
// - Falls back to A record if no MX exists (RFC 5321 §5.1)
// - LRU-style cache with configurable TTL
// - Handles NXDOMAIN, SERVFAIL, timeouts gracefully
// ═══════════════════════════════════════════════════════════════

export interface MxRecord {
  exchange: string;
  priority: number;
}

interface CacheEntry {
  records: MxRecord[];
  expiresAt: number;
}

const MX_CACHE_TTL_MS = 3_600_000; // 1 hour
const MX_CACHE_MAX_SIZE = 10_000;  // Evict oldest after this

const cache = new Map<string, CacheEntry>();

/**
 * Resolve MX records for a domain, sorted by priority (lowest = best).
 * Returns empty array if the domain has no mail infrastructure.
 */
export async function resolveMx(domain: string): Promise<MxRecord[]> {
  const normalised = domain.toLowerCase().trim();

  // ── Cache hit ──
  const cached = cache.get(normalised);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.records;
  }

  try {
    const raw = await dns.resolveMx(normalised);
    const sorted = raw
      .map((r) => ({ exchange: r.exchange, priority: r.priority }))
      .sort((a, b) => a.priority - b.priority);

    setCache(normalised, sorted);
    return sorted;
  } catch (err: any) {
    // No MX records — try A record fallback (RFC 5321 §5.1)
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
      return tryARecordFallback(normalised);
    }

    // DNS timeout or server failure — return empty, don't cache the failure
    if (err.code === 'ETIMEOUT' || err.code === 'ESERVFAIL') {
      return [];
    }

    throw err;
  }
}

/**
 * RFC 5321 §5.1: If no MX records exist, the domain itself is treated
 * as the mail exchange if it has an A or AAAA record.
 */
async function tryARecordFallback(domain: string): Promise<MxRecord[]> {
  try {
    const aRecords = await dns.resolve4(domain);
    if (aRecords.length > 0) {
      const fallback: MxRecord[] = [{ exchange: domain, priority: 10 }];
      setCache(domain, fallback);
      return fallback;
    }
  } catch {
    // No A record either — domain has no mail infrastructure
  }

  // Cache the negative result to avoid repeated lookups
  setCache(domain, []);
  return [];
}

/** Insert into cache with LRU eviction */
function setCache(domain: string, records: MxRecord[]): void {
  // Simple eviction: if cache is full, delete the oldest 20%
  if (cache.size >= MX_CACHE_MAX_SIZE) {
    const toDelete = Math.floor(MX_CACHE_MAX_SIZE * 0.2);
    const keys = cache.keys();
    for (let i = 0; i < toDelete; i++) {
      const next = keys.next();
      if (next.done) break;
      cache.delete(next.value);
    }
  }

  cache.set(domain, { records, expiresAt: Date.now() + MX_CACHE_TTL_MS });
}

/** Clear the MX cache (useful for testing) */
export function clearMxCache(): void {
  cache.clear();
}

/** Get the current cache size */
export function getMxCacheSize(): number {
  return cache.size;
}
