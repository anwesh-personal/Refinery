import { describe, it, expect } from 'vitest';
import { isFreeProvider, classifyProvider, getFreeProviderCount } from './freeProviders.js';

describe('freeProviders', () => {
  it('detects major free providers', () => {
    expect(isFreeProvider('gmail.com')).toBe(true);
    expect(isFreeProvider('yahoo.com')).toBe(true);
    expect(isFreeProvider('hotmail.com')).toBe(true);
    expect(isFreeProvider('outlook.com')).toBe(true);
    expect(isFreeProvider('aol.com')).toBe(true);
    expect(isFreeProvider('icloud.com')).toBe(true);
  });

  it('detects regional providers', () => {
    expect(isFreeProvider('mail.ru')).toBe(true);
    expect(isFreeProvider('qq.com')).toBe(true);
    expect(isFreeProvider('web.de')).toBe(true);
    expect(isFreeProvider('yandex.ru')).toBe(true);
  });

  it('does not flag business domains', () => {
    expect(isFreeProvider('customdomain.com')).toBe(false);
    expect(isFreeProvider('company.io')).toBe(false);
    expect(isFreeProvider('enterprise.co')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isFreeProvider('GMAIL.COM')).toBe(true);
    expect(isFreeProvider('Yahoo.Com')).toBe(true);
  });

  it('classifies provider categories', () => {
    expect(classifyProvider('gmail.com')).toBe('major');
    expect(classifyProvider('protonmail.com')).toBe('privacy');
    expect(classifyProvider('comcast.net')).toBe('isp');
    expect(classifyProvider('mail.ru')).toBe('regional');
    expect(classifyProvider('unknown.com')).toBeNull();
  });

  it('has a substantial provider database', () => {
    expect(getFreeProviderCount()).toBeGreaterThan(80);
  });
});
