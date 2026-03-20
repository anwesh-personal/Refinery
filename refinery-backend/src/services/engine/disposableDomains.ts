// ═══════════════════════════════════════════════════════════════
// Disposable Domain Database — 33,000+ disposable email domains
//
// Uses the community-maintained `disposable-email-domains` package
// (updated weekly) plus a curated local extension list.
// Also supports runtime additions via addDomains().
// ═══════════════════════════════════════════════════════════════

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Load domains from the npm package (index.json is a JSON string[] array)
let npmDomains: string[] = [];
try {
  npmDomains = require('disposable-email-domains') as string[];
} catch (err) {
  console.warn('[DisposableDomains] Could not load npm package:', (err as Error).message);
}

// Curated extension list — domains known to be disposable but not yet
// in the npm package at time of writing.
const LOCAL_EXTENSIONS: readonly string[] = [
  'tempmailo.com', 'internxt.com', 'duck.com',
  'crazymailing.com', 'binkmail.com', 'chammy.info',
  'mt2015.com', 'rmqkr.net', 's0ny.net',
  'xoxy.net', 'superrito.com',
] as const;

// Build the master Set — single source of truth
const DISPOSABLE_DOMAINS = new Set<string>(
  [...npmDomains, ...LOCAL_EXTENSIONS].map(d => d.toLowerCase().trim()),
);

console.log(`[DisposableDomains] Loaded ${DISPOSABLE_DOMAINS.size.toLocaleString()} disposable domains.`);

/**
 * Check if an email domain is a known disposable/throwaway service.
 */
export function isDisposable(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(domain.toLowerCase());
}

/** Add domains at runtime (e.g. loaded from an external file or API) */
export function addDomains(domains: string[]): void {
  for (const d of domains) {
    DISPOSABLE_DOMAINS.add(d.toLowerCase().trim());
  }
}

/** Total number of known disposable domains */
export function getDisposableCount(): number {
  return DISPOSABLE_DOMAINS.size;
}
