import { describe, it, expect } from 'vitest';
import { isDisposable, addDomains, getDisposableCount } from './disposableDomains.js';

describe('disposableDomains', () => {
  it('detects known disposable domains', () => {
    expect(isDisposable('mailinator.com')).toBe(true);
    expect(isDisposable('guerrillamail.com')).toBe(true);
    expect(isDisposable('yopmail.com')).toBe(true);
    expect(isDisposable('temp-mail.org')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isDisposable('MAILINATOR.COM')).toBe(true);
    expect(isDisposable('Yopmail.Com')).toBe(true);
  });

  it('does not flag legitimate domains', () => {
    expect(isDisposable('gmail.com')).toBe(false);
    expect(isDisposable('yahoo.com')).toBe(false);
    expect(isDisposable('company.io')).toBe(false);
    expect(isDisposable('outlook.com')).toBe(false);
  });

  it('can add domains at runtime', () => {
    const before = getDisposableCount();
    addDomains(['custom-temp-domain.net', 'throwaway123.org']);
    expect(getDisposableCount()).toBe(before + 2);
    expect(isDisposable('custom-temp-domain.net')).toBe(true);
    expect(isDisposable('throwaway123.org')).toBe(true);
  });

  it('trims and lowercases user-added domains', () => {
    addDomains(['  UPPER-CASE.COM  ']);
    expect(isDisposable('upper-case.com')).toBe(true);
  });

  it('has a reasonable number of built-in domains', () => {
    // Should have at least 150 (we know we have ~180+)
    expect(getDisposableCount()).toBeGreaterThan(150);
  });
});
