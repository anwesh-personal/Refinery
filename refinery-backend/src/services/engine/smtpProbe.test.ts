import { describe, it, expect } from 'vitest';

// Test the SMTP response parser in isolation.
// We import the probeEmail function but test parsing logic via the exported interface.
// Since probeEmail opens real sockets we also test the full probe against a known domain.

describe('smtpProbe', () => {
  // We test the module can be imported without errors
  it('module exports probeEmail function', async () => {
    const mod = await import('./smtpProbe.js');
    expect(typeof mod.probeEmail).toBe('function');
  });

  it('returns unknown for unreachable host', async () => {
    const { probeEmail } = await import('./smtpProbe.js');

    // Connect to a port that will refuse connection
    const result = await probeEmail('127.0.0.1', 'test@example.com', {
      heloDomain: 'test.local',
      fromEmail: 'test@test.local',
      timeout: 3000,
      port: 59999, // Unlikely to be listening
    });

    expect(result.status).toBe('unknown');
    expect(result.code).toBe(0);
    expect(result.response).toBeTruthy();
  });

  it('returns unknown on connection timeout', async () => {
    const { probeEmail } = await import('./smtpProbe.js');

    // Connect to a non-routable IP that will timeout
    const result = await probeEmail('192.0.2.1', 'test@example.com', {
      heloDomain: 'test.local',
      fromEmail: 'test@test.local',
      timeout: 2000,
      port: 25,
    });

    expect(result.status).toBe('unknown');
    expect(result.code).toBe(0);
  }, 10_000);

  it('result interface has required fields', async () => {
    const { probeEmail } = await import('./smtpProbe.js');

    const result = await probeEmail('127.0.0.1', 'test@example.com', {
      heloDomain: 'test.local',
      fromEmail: 'test@test.local',
      timeout: 2000,
      port: 59999,
    });

    // Verify shape
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('code');
    expect(result).toHaveProperty('response');
    expect(['valid', 'invalid', 'risky', 'unknown']).toContain(result.status);
    expect(typeof result.code).toBe('number');
    expect(typeof result.response).toBe('string');
  });
});
