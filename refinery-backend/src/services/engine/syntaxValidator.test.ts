import { describe, it, expect } from 'vitest';
import { validateSyntax, fixTypos, deduplicateEmails } from './syntaxValidator.js';

describe('syntaxValidator', () => {
  describe('validateSyntax', () => {
    it('validates correct emails', () => {
      expect(validateSyntax('user@example.com').valid).toBe(true);
      expect(validateSyntax('first.last@company.io').valid).toBe(true);
      expect(validateSyntax('user+tag@gmail.com').valid).toBe(true);
    });

    it('rejects empty input', () => {
      const r = validateSyntax('');
      expect(r.valid).toBe(false);
      expect(r.issues).toContain('empty');
    });

    it('rejects invalid format', () => {
      expect(validateSyntax('not-an-email').valid).toBe(false);
      expect(validateSyntax('@domain.com').valid).toBe(false);
      expect(validateSyntax('user@').valid).toBe(false);
    });

    it('normalizes to lowercase', () => {
      expect(validateSyntax('USER@EXAMPLE.COM').normalized).toBe('user@example.com');
    });

    it('trims whitespace', () => {
      expect(validateSyntax('  user@example.com  ').normalized).toBe('user@example.com');
    });

    it('detects consecutive dots', () => {
      const r = validateSyntax('user..name@example.com');
      expect(r.issues).toContain('consecutive_dots');
    });

    it('strips plus addressing in strict mode', () => {
      const r = validateSyntax('user+tag@gmail.com', true);
      expect(r.normalized).toBe('user@gmail.com');
      expect(r.issues).toContain('plus_addressing');
    });

    it('keeps plus addressing in non-strict mode', () => {
      const r = validateSyntax('user+tag@gmail.com', false);
      expect(r.normalized).toBe('user+tag@gmail.com');
    });
  });

  describe('fixTypos', () => {
    it('fixes common Gmail typos', () => {
      expect(fixTypos('user@gmial.com').corrected).toBe('user@gmail.com');
      expect(fixTypos('user@gmal.com').corrected).toBe('user@gmail.com');
      expect(fixTypos('user@gamil.com').corrected).toBe('user@gmail.com');
    });

    it('fixes Yahoo typos', () => {
      expect(fixTypos('user@yahooo.com').corrected).toBe('user@yahoo.com');
    });

    it('fixes Hotmail typos', () => {
      expect(fixTypos('user@hotmal.com').corrected).toBe('user@hotmail.com');
    });

    it('does not modify correct domains', () => {
      const r = fixTypos('user@gmail.com');
      expect(r.wasCorrected).toBe(false);
      expect(r.corrected).toBe('user@gmail.com');
    });

    it('does not modify unknown domains', () => {
      const r = fixTypos('user@company.io');
      expect(r.wasCorrected).toBe(false);
    });
  });

  describe('deduplicateEmails', () => {
    it('removes duplicates', () => {
      const r = deduplicateEmails(['a@b.com', 'c@d.com', 'a@b.com']);
      expect(r.unique).toEqual(['a@b.com', 'c@d.com']);
      expect(r.duplicatesRemoved).toBe(1);
    });

    it('is case-insensitive', () => {
      const r = deduplicateEmails(['User@Example.com', 'user@example.com']);
      expect(r.unique.length).toBe(1);
      expect(r.duplicatesRemoved).toBe(1);
    });

    it('preserves order', () => {
      const r = deduplicateEmails(['z@z.com', 'a@a.com', 'z@z.com', 'm@m.com']);
      expect(r.unique).toEqual(['z@z.com', 'a@a.com', 'm@m.com']);
    });

    it('handles empty list', () => {
      const r = deduplicateEmails([]);
      expect(r.unique).toEqual([]);
      expect(r.duplicatesRemoved).toBe(0);
    });
  });
});
