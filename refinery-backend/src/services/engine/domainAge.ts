import https from 'https';

// ═══════════════════════════════════════════════════════════════
// Domain Age Checker — via RDAP (Registration Data Access Protocol)
//
// Newly registered domains are suspicious — legitimate businesses
// don't send emails from domains created yesterday.
//
// Uses the IANA RDAP bootstrap to find the correct RDAP server,
// then queries for domain creation date. Results cached 24 hours
// since domain age doesn't change.
//
// RDAP is the standards-based successor to WHOIS and supports
// JSON responses natively — no screen-scraping needed.
// ═══════════════════════════════════════════════════════════════

export interface DomainAgeResult {
    /** Domain creation date (ISO string) or null if unavailable */
    createdAt: string | null;
    /** Age in days, or -1 if unknown */
    ageDays: number;
    /** Whether the domain is considered "new" (< 30 days) */
    isNew: boolean;
    /** The registrar name, if available */
    registrar: string | null;
}

// ── Cache ──
interface CacheEntry {
    result: DomainAgeResult;
    expiresAt: number;
}

const AGE_CACHE_TTL = 24 * 3_600_000; // 24 hours — domain age doesn't change
const AGE_CACHE_MAX = 10_000;
const NEW_DOMAIN_THRESHOLD_DAYS = 30;
const cache = new Map<string, CacheEntry>();

/**
 * Check the age of a domain using RDAP.
 * Returns creation date and whether it's suspiciously new.
 */
export async function checkDomainAge(domain: string): Promise<DomainAgeResult> {
    const d = extractRootDomain(domain).toLowerCase();

    // Cache hit
    const cached = cache.get(d);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    if (cached) cache.delete(d);

    let result: DomainAgeResult;

    try {
        const rdapData = await fetchRdap(d);
        const createdAt = extractCreationDate(rdapData);
        const registrar = extractRegistrar(rdapData);

        if (createdAt) {
            const created = new Date(createdAt);
            const ageDays = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
            result = {
                createdAt: created.toISOString(),
                ageDays,
                isNew: ageDays < NEW_DOMAIN_THRESHOLD_DAYS,
                registrar,
            };
        } else {
            result = { createdAt: null, ageDays: -1, isNew: false, registrar };
        }
    } catch {
        // RDAP unavailable — don't penalize
        result = { createdAt: null, ageDays: -1, isNew: false, registrar: null };
    }

    // Cache with eviction
    if (cache.size >= AGE_CACHE_MAX) {
        const now = Date.now();
        for (const [key, entry] of cache) {
            if (entry.expiresAt <= now) cache.delete(key);
        }
        if (cache.size >= AGE_CACHE_MAX) {
            const toDelete = Math.floor(AGE_CACHE_MAX * 0.2);
            const keys = cache.keys();
            for (let i = 0; i < toDelete; i++) {
                const next = keys.next();
                if (next.done) break;
                cache.delete(next.value);
            }
        }
    }
    cache.set(d, { result, expiresAt: Date.now() + AGE_CACHE_TTL });

    return result;
}

// ── RDAP Fetch ──

function fetchRdap(domain: string): Promise<any> {
    // Use rdap.org as a universal RDAP proxy (handles bootstrap automatically)
    const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;

    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 8000, headers: { Accept: 'application/rdap+json' } }, (res) => {
            // Follow redirects (RDAP bootstrap returns 301/302)
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchUrl(res.headers.location).then(resolve).catch(reject);
                return;
            }

            if (res.statusCode !== 200) {
                reject(new Error(`RDAP returned ${res.statusCode}`));
                return;
            }

            let body = '';
            res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch {
                    reject(new Error('Invalid RDAP JSON'));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('RDAP timeout')); });
    });
}

function fetchUrl(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 8000, headers: { Accept: 'application/rdap+json' } }, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`RDAP returned ${res.statusCode}`));
                return;
            }

            let body = '';
            res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch {
                    reject(new Error('Invalid RDAP JSON'));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('RDAP timeout')); });
    });
}

// ── RDAP Data Extraction ──

function extractCreationDate(rdap: any): string | null {
    // RDAP events array contains lifecycle dates
    if (!rdap?.events || !Array.isArray(rdap.events)) return null;

    const registration = rdap.events.find(
        (e: any) => e.eventAction === 'registration'
    );

    return registration?.eventDate || null;
}

function extractRegistrar(rdap: any): string | null {
    // The registrar is in the entities array with role "registrar"
    if (!rdap?.entities || !Array.isArray(rdap.entities)) return null;

    const registrar = rdap.entities.find(
        (e: any) => Array.isArray(e.roles) && e.roles.includes('registrar')
    );

    // Name is in vcardArray or handle
    if (registrar?.vcardArray) {
        const vcard = registrar.vcardArray;
        if (Array.isArray(vcard) && vcard.length >= 2) {
            const fnEntry = vcard[1].find((v: any) => v[0] === 'fn');
            if (fnEntry) return fnEntry[3] || null;
        }
    }

    return registrar?.handle || null;
}

// ── Utils ──

/** Extract root domain from subdomain: mail.sub.example.com → example.com */
function extractRootDomain(domain: string): string {
    const parts = domain.split('.');
    if (parts.length <= 2) return domain;
    // Handle known 2-level TLDs (co.uk, com.au, etc.)
    const twoLevelTLDs = new Set([
        'co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za', 'co.in',
        'com.au', 'com.br', 'com.cn', 'com.mx', 'com.sg', 'com.tw',
        'net.au', 'org.au', 'org.uk', 'ac.uk', 'gov.uk',
    ]);
    const lastTwo = parts.slice(-2).join('.');
    if (twoLevelTLDs.has(lastTwo)) {
        return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
}

export function clearDomainAgeCache(): void {
    cache.clear();
}

export function getDomainAgeCacheSize(): number {
    return cache.size;
}
