import { describe, it, expect } from 'vitest';
import { detectRole, getRolePrefixCount } from './roleDetector.js';

describe('roleDetector', () => {
  it('detects common role-based prefixes', () => {
    expect(detectRole('info@company.com')).toBe('info');
    expect(detectRole('admin@company.com')).toBe('admin');
    expect(detectRole('support@company.com')).toBe('support');
    expect(detectRole('sales@company.com')).toBe('sales');
    expect(detectRole('hr@company.com')).toBe('hr');
    expect(detectRole('noreply@company.com')).toBe('noreply');
  });

  it('detects prefixes with separators', () => {
    expect(detectRole('info.us@company.com')).toBe('info');
    expect(detectRole('sales_team@company.com')).toBe('sales');
    expect(detectRole('support-desk@company.com')).toBe('support');
  });

  it('does not flag personal names', () => {
    expect(detectRole('john@company.com')).toBeNull();
    expect(detectRole('jane.doe@company.com')).toBeNull();
    expect(detectRole('j.smith@company.com')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(detectRole('INFO@company.com')).toBe('info');
    expect(detectRole('ADMIN@company.com')).toBe('admin');
  });

  it('has a substantial prefix database', () => {
    expect(getRolePrefixCount()).toBeGreaterThan(70);
  });

  it('returns null for invalid input', () => {
    expect(detectRole('')).toBeNull();
    expect(detectRole('no-at-sign')).toBeNull();
  });
});
