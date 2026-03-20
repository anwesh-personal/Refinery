import dns from 'dns/promises';

// ═══════════════════════════════════════════════════════════════
// DNSBL (DNS Blocklist) Checker
//
// Checks if a mail server's IP is listed on known DNS-based
// blocklists. Listed IPs are associated with spam, malware,
// or other abuse — emails from these servers are unreliable.
//
// How it works:
//   Given IP 1.2.3.4 and blocklist zen.spamhaus.org:
//   → Lookup 4.3.2.1.zen.spamhaus.org
//   → If A record exists → listed (blocked)
//   → If NXDOMAIN → clean
//
// Results cached per IP for 4 hours to avoid hammering DNS.
// ═══════════════════════════════════════════════════════════════

/** Well-known DNSBL providers — ordered by reliability */
const DNSBL_PROVIDERS = [
    'zen.spamhaus.org',        // Most authoritative; SBL + XBL + PBL
    'b.barracudacentral.org',  // Barracuda Reputation Block List
    'bl.spamcop.net',          // SpamCop
    'dnsbl.sorbs.net',         // SORBS
    'psbl.surriel.com',        // Passive Spam Block List
] as const;

export interface DnsblResult {
    /** Whether the IP was found on any blocklist */
    listed: boolean;
    /** Which blocklists returned a positive hit */
    listings: string[];
    /** Total number of blocklists checked */
    totalChecked: number;
    /** The IP that was checked */
    ip: string;
}

// ── Cache ──
interface CacheEntry {
    result: DnsblResult;
    expiresAt: number;
}

const DNSBL_CACHE_TTL = 4 * 3_600_000; // 4 hours
const DNSBL_CACHE_MAX = 5_000;
const cache = new Map<string, CacheEntry>();

/**
 * Check if an IP address is listed on any DNS blocklists.
 * Only supports IPv4 (DNSBL doesn't work well with IPv6).
 */
export async function checkDnsbl(ip: string): Promise<DnsblResult> {
    const trimmed = ip.trim();

    // Only IPv4 is supported by DNSBL
    if (!isIPv4(trimmed)) {
        return { listed: false, listings: [], totalChecked: 0, ip: trimmed };
    }

    // Cache hit
    const cached = cache.get(trimmed);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    if (cached) cache.delete(trimmed);

    // Reverse the IP octets: 1.2.3.4 → 4.3.2.1
    const reversed = trimmed.split('.').reverse().join('.');

    // Check all providers in parallel
    const checks = DNSBL_PROVIDERS.map(async (provider): Promise<string | null> => {
        const query = `${reversed}.${provider}`;
        try {
            const addresses = await dns.resolve4(query);
            // Any A record response means listed
            return addresses.length > 0 ? provider : null;
        } catch {
            // NXDOMAIN or timeout = not listed
            return null;
        }
    });

    const results = await Promise.all(checks);
    const listings = results.filter((r): r is string => r !== null);

    const result: DnsblResult = {
        listed: listings.length > 0,
        listings,
        totalChecked: DNSBL_PROVIDERS.length,
        ip: trimmed,
    };

    // Cache with eviction
    if (cache.size >= DNSBL_CACHE_MAX) {
        const now = Date.now();
        for (const [key, entry] of cache) {
            if (entry.expiresAt <= now) cache.delete(key);
        }
        if (cache.size >= DNSBL_CACHE_MAX) {
            const toDelete = Math.floor(DNSBL_CACHE_MAX * 0.2);
            const keys = cache.keys();
            for (let i = 0; i < toDelete; i++) {
                const next = keys.next();
                if (next.done) break;
                cache.delete(next.value);
            }
        }
    }
    cache.set(trimmed, { result, expiresAt: Date.now() + DNSBL_CACHE_TTL });

    return result;
}

/**
 * Resolve an MX hostname to its IP, then check DNSBL.
 * This is the convenience function used by the pipeline.
 */
export async function checkMxDnsbl(mxHost: string): Promise<DnsblResult> {
    try {
        const addresses = await dns.resolve4(mxHost);
        if (addresses.length === 0) {
            return { listed: false, listings: [], totalChecked: 0, ip: '' };
        }
        // Check the primary IP
        return checkDnsbl(addresses[0]);
    } catch {
        return { listed: false, listings: [], totalChecked: 0, ip: '' };
    }
}

function isIPv4(str: string): boolean {
    const parts = str.split('.');
    if (parts.length !== 4) return false;
    return parts.every(p => {
        const n = parseInt(p, 10);
        return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p;
    });
}

export function clearDnsblCache(): void {
    cache.clear();
}

export function getDnsblCacheSize(): number {
    return cache.size;
}
