import { describe, it, expect, beforeEach } from 'vitest';
import {
  acquireSlot,
  releaseSlot,
  applyBackoff,
  resetBackoff,
  setLimits,
  resetLimiter,
  getActiveConnections,
  getDomainStatus,
} from './rateLimiter.js';

describe('rateLimiter', () => {
  beforeEach(() => {
    resetLimiter();
    // Set fast limits for testing
    setLimits({ minIntervalMs: 50, maxConcurrentPerDomain: 2, globalMaxConcurrent: 10 });
  });

  it('allows acquiring and releasing slots', async () => {
    expect(getActiveConnections()).toBe(0);

    await acquireSlot('example.com');
    expect(getActiveConnections()).toBe(1);

    releaseSlot('example.com');
    expect(getActiveConnections()).toBe(0);
  });

  it('tracks per-domain active connections', async () => {
    await acquireSlot('a.com');
    await acquireSlot('a.com');

    const status = getDomainStatus('a.com');
    expect(status).not.toBeNull();
    expect(status!.active).toBe(2);

    releaseSlot('a.com');
    expect(getDomainStatus('a.com')!.active).toBe(1);

    releaseSlot('a.com');
    expect(getDomainStatus('a.com')!.active).toBe(0);
  });

  it('never goes below 0 on double release', () => {
    releaseSlot('nonexistent.com');
    expect(getActiveConnections()).toBe(0);
  });

  it('applies exponential backoff', () => {
    applyBackoff('slow.com');
    const status1 = getDomainStatus('slow.com');
    expect(status1!.failures).toBe(1);
    expect(status1!.backoffUntil).toBeGreaterThan(Date.now());

    applyBackoff('slow.com');
    const status2 = getDomainStatus('slow.com');
    expect(status2!.failures).toBe(2);
    // Second backoff should be longer than first
    expect(status2!.backoffUntil).toBeGreaterThan(status1!.backoffUntil);
  });

  it('resets backoff on success', () => {
    applyBackoff('recover.com');
    expect(getDomainStatus('recover.com')!.failures).toBe(1);

    resetBackoff('recover.com');
    expect(getDomainStatus('recover.com')!.failures).toBe(0);
  });

  it('caps backoff at 5 minutes', () => {
    // Apply many failures to hit the cap
    for (let i = 0; i < 20; i++) {
      applyBackoff('capped.com');
    }
    const status = getDomainStatus('capped.com');
    // Max backoff: 300 seconds (5 minutes)
    const maxBackoffMs = 300 * 1000;
    const actualBackoff = status!.backoffUntil - Date.now();
    expect(actualBackoff).toBeLessThanOrEqual(maxBackoffMs + 1000); // +1s tolerance
  });

  it('normalizes domain names to lowercase', async () => {
    await acquireSlot('UPPER.COM');
    const status = getDomainStatus('upper.com');
    expect(status).not.toBeNull();
    expect(status!.active).toBe(1);
    releaseSlot('UPPER.COM');
  });

  it('resets all state', async () => {
    await acquireSlot('a.com');
    await acquireSlot('b.com');
    expect(getActiveConnections()).toBe(2);

    resetLimiter();
    expect(getActiveConnections()).toBe(0);
    expect(getDomainStatus('a.com')).toBeNull();
  });
});
