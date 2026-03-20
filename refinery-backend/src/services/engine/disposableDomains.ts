// ═══════════════════════════════════════════════════════════════
// Disposable Domain Database — 33,000+ disposable email domains
//
// Uses the community-maintained `disposable-email-domains` package
// (updated weekly) plus a curated local extension list.
// Also supports runtime additions via addDomains().
// ═══════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load 33k+ domains from npm package
let npmDomains: string[] = [];
try {
  // The package exports a JSON array of strings
  const modPath = import.meta.resolve?.('disposable-email-domains')
    || require.resolve('disposable-email-domains');
  const resolved = typeof modPath === 'string' && modPath.startsWith('file://')
    ? fileURLToPath(modPath)
    : modPath;
  const raw = fs.readFileSync(resolved as string, 'utf-8');
  npmDomains = JSON.parse(raw);
} catch {
  try {
    // Fallback: direct require
    npmDomains = require('disposable-email-domains');
  } catch {
    console.warn('[DisposableDomains] Could not load npm package — using local list only.');
  }
}

// ── Local extension list (domains missed by the npm package) ──
const LOCAL_EXTENSIONS = [
  // Recently popular services not yet in the npm list
  'tempmailo.com', 'internxt.com', 'duck.com',
  'crazymailing.com', 'binkmail.com', 'chammy.info',
  'mt2015.com', 'rmqkr.net', 's0ny.net',
  'xoxy.net', 'superrito.com',
];

// Build the master Set
const DISPOSABLE_DOMAINS = new Set<string>(
  [...npmDomains, ...LOCAL_EXTENSIONS].map(d => d.toLowerCase().trim())
);

console.log(`[DisposableDomains] Loaded ${DISPOSABLE_DOMAINS.size.toLocaleString()} disposable domains.`);

/**
 * Check if an email domain is a known disposable/throwaway service.
 * Domain should be lowercase.
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
