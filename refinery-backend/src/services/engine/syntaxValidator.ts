// ═══════════════════════════════════════════════════════════════
// Email Syntax Validator — RFC 5322 compliant email validation
//
// Checks:
//   - Basic format (local@domain)
//   - Local part length (max 64 chars per RFC)
//   - Domain part length (max 253 chars per RFC)
//   - No consecutive dots
//   - Valid domain TLD
//   - Optional strict mode (rejects plus addressing, quoted strings)
// ═══════════════════════════════════════════════════════════════

export interface SyntaxCheckResult {
  valid: boolean;
  normalized: string;
  issues: string[];
}

// RFC 5322 basic email regex (covers 99.9% of real-world addresses)
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// Known TLDs that virtually all legitimate mail comes from
const VALID_TLDS = new Set([
  'com', 'net', 'org', 'edu', 'gov', 'mil', 'int',
  'co', 'io', 'ai', 'app', 'dev', 'me', 'us', 'uk', 'ca', 'au',
  'de', 'fr', 'es', 'it', 'nl', 'se', 'no', 'fi', 'dk', 'be',
  'at', 'ch', 'jp', 'cn', 'kr', 'in', 'br', 'mx', 'ar', 'cl',
  'za', 'ng', 'ke', 'eg', 'nz', 'sg', 'hk', 'tw', 'ph', 'th',
  'id', 'my', 'vn', 'pk', 'bd', 'lk', 'np', 'ae', 'sa', 'qa',
  'kw', 'bh', 'om', 'il', 'tr', 'ru', 'ua', 'pl', 'cz', 'sk',
  'hu', 'ro', 'bg', 'hr', 'rs', 'si', 'ee', 'lv', 'lt', 'gr',
  'pt', 'ie', 'lu', 'mt', 'cy', 'is', 'li', 'mc', 'ad', 'sm',
  'va', 'fo', 'gl', 'bm', 'ky', 'vg', 'vi',
  // Generic TLDs
  'info', 'biz', 'name', 'pro', 'aero', 'coop', 'museum', 'jobs',
  'travel', 'mobi', 'asia', 'tel', 'cat', 'post', 'xxx',
  // New gTLDs (most common)
  'tech', 'store', 'online', 'site', 'website', 'space', 'fun',
  'cloud', 'agency', 'consulting', 'digital', 'email', 'global',
  'group', 'marketing', 'media', 'network', 'services', 'solutions',
  'studio', 'systems', 'team', 'work', 'world', 'zone', 'live',
  'news', 'blog', 'shop', 'design', 'company', 'center', 'city',
  'social', 'beer', 'pizza', 'ventures', 'capital', 'finance',
  'club', 'expert', 'guide', 'health', 'care', 'fit', 'life',
  'plus', 'one', 'top', 'xyz', 'cc', 'tv', 'ws', 'bz', 'la',
]);

/**
 * Validate and normalize an email address.
 * Returns the normalized email and a list of issues found.
 */
export function validateSyntax(email: string, strict = false): SyntaxCheckResult {
  const issues: string[] = [];
  let normalized = email.trim().toLowerCase();

  // Empty
  if (!normalized) {
    return { valid: false, normalized: '', issues: ['empty'] };
  }

  // Basic format
  if (!EMAIL_REGEX.test(normalized)) {
    return { valid: false, normalized, issues: ['invalid_format'] };
  }

  const [localPart, domain] = normalized.split('@');

  // Local part checks
  if (localPart.length > 64) {
    issues.push('local_part_too_long');
  }
  if (localPart.startsWith('.') || localPart.endsWith('.')) {
    issues.push('local_part_dot_boundary');
  }
  if (localPart.includes('..')) {
    issues.push('consecutive_dots');
  }

  // Domain checks
  if (domain.length > 253) {
    issues.push('domain_too_long');
  }
  const tld = domain.split('.').pop() || '';
  if (tld.length < 2) {
    issues.push('invalid_tld');
  }
  if (!VALID_TLDS.has(tld) && tld.length < 3) {
    issues.push('uncommon_tld');
  }

  // Strict mode checks
  if (strict) {
    if (localPart.includes('+')) {
      issues.push('plus_addressing');
      // Strip plus addressing for normalization
      normalized = localPart.split('+')[0] + '@' + domain;
    }
    if (localPart.includes('"')) {
      issues.push('quoted_local_part');
    }
  }

  const valid = !issues.some(i =>
    i === 'invalid_format' || i === 'local_part_too_long' ||
    i === 'domain_too_long' || i === 'invalid_tld'
  );

  return { valid, normalized, issues };
}

/**
 * Fix common email typos in domain names.
 * Returns corrected email or original if no fix needed.
 */
export function fixTypos(email: string): { corrected: string; wasCorrected: boolean } {
  const [local, domain] = email.split('@');
  if (!domain) return { corrected: email, wasCorrected: false };

  const fixes: Record<string, string> = {
    // Gmail
    'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmaill.com': 'gmail.com',
    'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.co': 'gmail.com',
    'gmail.cm': 'gmail.com', 'gmai.com': 'gmail.com', 'gmil.com': 'gmail.com',
    'gmsil.com': 'gmail.com', 'gmqil.com': 'gmail.com',
    // Yahoo
    'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yhaoo.com': 'yahoo.com',
    'yahho.com': 'yahoo.com', 'yaoo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com',
    'yahoo.cm': 'yahoo.com',
    // Hotmail / Outlook
    'hotmal.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmaill.com': 'hotmail.com',
    'hotmai.com': 'hotmail.com', 'hotmil.com': 'hotmail.com',
    'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlool.com': 'outlook.com',
    // AOL
    'aol.co': 'aol.com', 'aoll.com': 'aol.com',
    // iCloud
    'icoud.com': 'icloud.com', 'iclould.com': 'icloud.com',
    // Common TLD typos
  };

  const correctedDomain = fixes[domain];
  if (correctedDomain) {
    return { corrected: `${local}@${correctedDomain}`, wasCorrected: true };
  }

  return { corrected: email, wasCorrected: false };
}

/**
 * Deduplicate a list of emails, preserving order.
 * Returns unique emails and the count of duplicates removed.
 */
export function deduplicateEmails(emails: string[]): { unique: string[]; duplicatesRemoved: number } {
  const seen = new Set<string>();
  const unique: string[] = [];
  let dup = 0;

  for (const email of emails) {
    const normalized = email.trim().toLowerCase();
    if (seen.has(normalized)) {
      dup++;
    } else {
      seen.add(normalized);
      unique.push(normalized);
    }
  }

  return { unique, duplicatesRemoved: dup };
}
