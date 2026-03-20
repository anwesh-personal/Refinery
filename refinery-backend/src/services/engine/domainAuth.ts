import dns from 'dns/promises';

// ═══════════════════════════════════════════════════════════════
// SPF / DMARC Record Checker
//
// Verifies that a domain has proper email authentication records.
// Domains without SPF/DMARC are suspicious — legitimate businesses
// almost always configure these.
//
// Checks:
//   - SPF (TXT record starting with "v=spf1")
//   - DMARC (_dmarc.domain TXT record starting with "v=DMARC1")
//
// Results are cached per domain (1 hour TTL) to avoid repeated DNS lookups.
// ═══════════════════════════════════════════════════════════════

export interface DomainAuthResult {
    spf: {
        exists: boolean;
        record: string | null;
        /** strict = -all, soft = ~all, neutral = ?all, none = +all or missing */
        policy: 'strict' | 'softfail' | 'neutral' | 'none';
    };
    dmarc: {
        exists: boolean;
        record: string | null;
        policy: 'reject' | 'quarantine' | 'none' | 'missing';
    };
    /** Overall score: 0-100 (100 = fully authenticated, 0 = nothing) */
    authScore: number;
}

// ── Cache ──
interface CacheEntry {
    result: DomainAuthResult;
    expiresAt: number;
}

const AUTH_CACHE_TTL = 3_600_000; // 1 hour
const AUTH_CACHE_MAX = 10_000;
const cache = new Map<string, CacheEntry>();

/**
 * Check SPF and DMARC records for a domain.
 * Returns authentication strength assessment.
 */
export async function checkDomainAuth(domain: string): Promise<DomainAuthResult> {
    const d = domain.toLowerCase().trim();

    // Cache hit (only if not expired)
    const cached = cache.get(d);
    if (cached && cached.expiresAt > Date.now()) return cached.result;

    // Remove stale entry if it existed
    if (cached) cache.delete(d);

    const [spf, dmarc] = await Promise.all([
        checkSPF(d),
        checkDMARC(d),
    ]);

    // Score: SPF worth 50, DMARC worth 50
    let authScore = 0;
    if (spf.exists) {
        authScore += spf.policy === 'strict' ? 50 : spf.policy === 'softfail' ? 35 : spf.policy === 'neutral' ? 15 : 5;
    }
    if (dmarc.exists) {
        authScore += dmarc.policy === 'reject' ? 50 : dmarc.policy === 'quarantine' ? 35 : 15;
    }

    const result: DomainAuthResult = { spf, dmarc, authScore };

    // Evict if at capacity — first remove expired entries, then oldest if still full
    if (cache.size >= AUTH_CACHE_MAX) {
        const now = Date.now();
        for (const [key, entry] of cache) {
            if (entry.expiresAt <= now) cache.delete(key);
        }
        // If still over capacity, drop the oldest 20%
        if (cache.size >= AUTH_CACHE_MAX) {
            const toDelete = Math.floor(AUTH_CACHE_MAX * 0.2);
            const keys = cache.keys();
            for (let i = 0; i < toDelete; i++) {
                const next = keys.next();
                if (next.done) break;
                cache.delete(next.value);
            }
        }
    }
    cache.set(d, { result, expiresAt: Date.now() + AUTH_CACHE_TTL });

    return result;
}

// ── SPF Check ──
async function checkSPF(domain: string): Promise<DomainAuthResult['spf']> {
    try {
        const records = await dns.resolveTxt(domain);
        const flat = records.map(r => r.join('')).filter(r => r.toLowerCase().startsWith('v=spf1'));

        if (flat.length === 0) {
            return { exists: false, record: null, policy: 'none' };
        }

        const spfRecord = flat[0];
        let policy: DomainAuthResult['spf']['policy'] = 'none';

        if (spfRecord.includes('-all')) policy = 'strict';
        else if (spfRecord.includes('~all')) policy = 'softfail';
        else if (spfRecord.includes('?all')) policy = 'neutral';
        else if (spfRecord.includes('+all')) policy = 'none';

        return { exists: true, record: spfRecord, policy };
    } catch {
        return { exists: false, record: null, policy: 'none' };
    }
}

// ── DMARC Check ──
async function checkDMARC(domain: string): Promise<DomainAuthResult['dmarc']> {
    try {
        const records = await dns.resolveTxt(`_dmarc.${domain}`);
        const flat = records.map(r => r.join('')).filter(r => r.toLowerCase().startsWith('v=dmarc1'));

        if (flat.length === 0) {
            return { exists: false, record: null, policy: 'missing' };
        }

        const dmarcRecord = flat[0];
        let policy: DomainAuthResult['dmarc']['policy'] = 'none';

        const pMatch = /p\s*=\s*(reject|quarantine|none)/i.exec(dmarcRecord);
        if (pMatch) {
            policy = pMatch[1].toLowerCase() as 'reject' | 'quarantine' | 'none';
        }

        return { exists: true, record: dmarcRecord, policy };
    } catch {
        return { exists: false, record: null, policy: 'missing' };
    }
}

/** Clear auth cache */
export function clearAuthCache(): void {
    cache.clear();
}

/** Get cache size */
export function getAuthCacheSize(): number {
    return cache.size;
}
