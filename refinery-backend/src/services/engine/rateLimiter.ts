import { sleep } from '../../utils/helpers.js';

// ═══════════════════════════════════════════════════════════════
// Rate Limiter — Per-domain connection throttling
//
// Purpose: Prevent IP blocking by major email providers.
//   - Min interval between connections to the same domain
//   - Max concurrent connections per domain
//   - Global concurrency cap
//   - Exponential backoff support (triggered by 4xx responses)
//
// This is critical for production. Aggressive SMTP probing
// without rate limiting WILL get your IP blocklisted.
// ═══════════════════════════════════════════════════════════════

interface DomainSlot {
  lastConnectionAt: number;
  activeConnections: number;
  /** If set, no connections to this domain until this timestamp */
  backoffUntil: number;
  /** Consecutive 4xx/failure count for adaptive backoff */
  failureCount: number;
}

// ── Defaults (configurable via setLimits) ──
let MIN_INTERVAL_MS = 2_000;          // 2s between connections to same domain
let MAX_CONCURRENT_PER_DOMAIN = 2;    // Max parallel connections per domain
let GLOBAL_MAX_CONCURRENT = 50;       // Max parallel connections total

const slots = new Map<string, DomainSlot>();
let globalActive = 0;

// ── Config ──

export interface RateLimitConfig {
  minIntervalMs?: number;
  maxConcurrentPerDomain?: number;
  globalMaxConcurrent?: number;
}

/** Override default rate limits */
export function setLimits(config: RateLimitConfig): void {
  if (config.minIntervalMs !== undefined) MIN_INTERVAL_MS = config.minIntervalMs;
  if (config.maxConcurrentPerDomain !== undefined) MAX_CONCURRENT_PER_DOMAIN = config.maxConcurrentPerDomain;
  if (config.globalMaxConcurrent !== undefined) GLOBAL_MAX_CONCURRENT = config.globalMaxConcurrent;
}

// ── Slot Acquisition & Release ──

/**
 * Acquire a rate-limited slot for a domain. Blocks until a slot is available.
 * Call releaseSlot() in a finally block after the connection completes.
 */
export async function acquireSlot(domain: string): Promise<void> {
  const normalised = domain.toLowerCase();

  // Wait for global capacity
  while (globalActive >= GLOBAL_MAX_CONCURRENT) {
    await sleep(100);
  }

  let slot = slots.get(normalised);
  if (!slot) {
    slot = { lastConnectionAt: 0, activeConnections: 0, backoffUntil: 0, failureCount: 0 };
    slots.set(normalised, slot);
  }

  // Wait for domain backoff to expire
  while (Date.now() < slot.backoffUntil) {
    const remaining = slot.backoffUntil - Date.now();
    await sleep(Math.min(remaining, 1_000));
  }

  // Wait for per-domain concurrency
  while (slot.activeConnections >= MAX_CONCURRENT_PER_DOMAIN) {
    await sleep(200);
  }

  // Enforce minimum interval between connections
  const elapsed = Date.now() - slot.lastConnectionAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - elapsed);
  }

  slot.activeConnections++;
  slot.lastConnectionAt = Date.now();
  globalActive++;
}

/**
 * Release a slot after a connection completes.
 * Must be called in a finally block.
 */
export function releaseSlot(domain: string): void {
  const normalised = domain.toLowerCase();
  const slot = slots.get(normalised);
  if (slot) {
    slot.activeConnections = Math.max(0, slot.activeConnections - 1);
  }
  globalActive = Math.max(0, globalActive - 1);
}

// ── Backoff ──

/**
 * Apply exponential backoff for a domain (called when receiving 4xx or failures).
 * Each consecutive failure doubles the backoff: 5s, 10s, 20s, 40s... up to 5min.
 */
export function applyBackoff(domain: string): void {
  const normalised = domain.toLowerCase();
  let slot = slots.get(normalised);
  if (!slot) {
    slot = { lastConnectionAt: 0, activeConnections: 0, backoffUntil: 0, failureCount: 0 };
    slots.set(normalised, slot);
  }

  slot.failureCount++;
  const backoffSeconds = Math.min(5 * Math.pow(2, slot.failureCount - 1), 300); // Max 5 minutes
  slot.backoffUntil = Date.now() + backoffSeconds * 1_000;
}

/** Reset failure counter for a domain (called on successful connection) */
export function resetBackoff(domain: string): void {
  const normalised = domain.toLowerCase();
  const slot = slots.get(normalised);
  if (slot) {
    slot.failureCount = 0;
  }
}

// ── Monitoring ──

/** Current number of globally active connections */
export function getActiveConnections(): number {
  return globalActive;
}

/** Get backoff status for a domain */
export function getDomainStatus(domain: string): { active: number; backoffUntil: number; failures: number } | null {
  const slot = slots.get(domain.toLowerCase());
  if (!slot) return null;
  return { active: slot.activeConnections, backoffUntil: slot.backoffUntil, failures: slot.failureCount };
}

/** Reset all rate limiting state */
export function resetLimiter(): void {
  slots.clear();
  globalActive = 0;
}
