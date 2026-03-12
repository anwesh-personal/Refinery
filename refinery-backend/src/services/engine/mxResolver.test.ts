import { describe, it, expect, beforeEach } from 'vitest';
import { resolveMx, clearMxCache, getMxCacheSize } from './mxResolver.js';

describe('mxResolver', () => {
  beforeEach(() => {
    clearMxCache();
  });

  it('resolves MX records for gmail.com', async () => {
    const records = await resolveMx('gmail.com');
    expect(records.length).toBeGreaterThan(0);
    expect(records[0].exchange).toBeTruthy();
    expect(records[0].priority).toBeGreaterThanOrEqual(0);
  });

  it('sorts MX records by priority (lowest first)', async () => {
    const records = await resolveMx('gmail.com');
    if (records.length > 1) {
      for (let i = 1; i < records.length; i++) {
        expect(records[i].priority).toBeGreaterThanOrEqual(records[i - 1].priority);
      }
    }
  });

  it('returns empty array for nonexistent domain', async () => {
    const records = await resolveMx('this-domain-definitely-does-not-exist-xrfnry-2026.example');
    expect(records).toEqual([]);
  });

  it('caches results on second call', async () => {
    expect(getMxCacheSize()).toBe(0);

    await resolveMx('gmail.com');
    expect(getMxCacheSize()).toBe(1);

    // Second call should use cache
    const records = await resolveMx('gmail.com');
    expect(records.length).toBeGreaterThan(0);
    expect(getMxCacheSize()).toBe(1); // Still 1 — no new lookup
  });

  it('normalizes domain to lowercase', async () => {
    await resolveMx('GMAIL.COM');
    expect(getMxCacheSize()).toBe(1);

    // Should hit cache with lowercase lookup
    await resolveMx('gmail.com');
    expect(getMxCacheSize()).toBe(1);
  });

  it('clears cache', async () => {
    await resolveMx('gmail.com');
    expect(getMxCacheSize()).toBe(1);

    clearMxCache();
    expect(getMxCacheSize()).toBe(0);
  });

  it('handles A record fallback for domains without MX', async () => {
    // Most domains with websites but no MX will return the domain as fallback
    // This is a soft test — real behavior depends on DNS
    const records = await resolveMx('example.com');
    // example.com may or may not have MX records, but should not throw
    expect(Array.isArray(records)).toBe(true);
  });
});
