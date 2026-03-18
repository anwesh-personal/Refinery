// ═══════════════════════════════════════════════════════════════
// Role-Based Email Detector — Identifies generic/role addresses
//
// Role-based emails (info@, admin@, support@, sales@) are often
// monitored by multiple people or are shared mailboxes. They have
// lower engagement and higher complaint rates in marketing.
//
// B2B verification should flag but not reject these —
// they're valid but risky for cold outreach.
// ═══════════════════════════════════════════════════════════════

const ROLE_PREFIXES = new Set([
  // Administrative
  'admin', 'administrator', 'postmaster', 'hostmaster', 'webmaster',
  'sysadmin', 'root', 'it', 'tech', 'support', 'help', 'helpdesk',

  // Generic contact
  'info', 'information', 'contact', 'contactus', 'hello', 'hi',
  'office', 'mail', 'email', 'enquiry', 'inquiry', 'general',

  // Sales & business
  'sales', 'billing', 'accounts', 'accounting', 'finance', 'payments',
  'orders', 'purchasing', 'procurement', 'business', 'partnerships',
  'deals', 'revenue', 'commercial',

  // Marketing
  'marketing', 'press', 'media', 'pr', 'newsletter', 'news',
  'promotions', 'events', 'social', 'brand', 'advertising',

  // HR & recruitment
  'hr', 'hiring', 'jobs', 'careers', 'recruitment', 'talent',
  'people', 'team', 'staff',

  // Legal & compliance
  'legal', 'compliance', 'privacy', 'abuse', 'spam', 'security',
  'dmca', 'copyright', 'gdpr',

  // Customer service
  'service', 'customerservice', 'cs', 'feedback', 'complaints',
  'returns', 'refunds', 'warranty',

  // Operations
  'operations', 'ops', 'logistics', 'shipping', 'delivery',
  'dispatch', 'warehouse', 'fulfillment',

  // No-reply / system
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon',
  'bounce', 'bounced', 'undelivered', 'auto', 'automated', 'system',
  'notifications', 'alerts', 'daemon',

  // Reception
  'reception', 'frontdesk', 'concierge',

  // Education
  'registrar', 'admissions', 'alumni', 'library',
]);

/**
 * Check if an email is a role-based/generic address.
 * Returns the detected role prefix or null.
 */
export function detectRole(email: string): string | null {
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) return null;

  const local = email.substring(0, atIndex).toLowerCase().trim();

  // Exact match
  if (ROLE_PREFIXES.has(local)) return local;

  // Check with common separators stripped: info.us → info, sales_team → sales
  const stripped = local.replace(/[._-]/g, '');
  if (ROLE_PREFIXES.has(stripped)) return local;

  // Check if starts with a role prefix followed by separator
  for (const prefix of ROLE_PREFIXES) {
    if (local.startsWith(prefix + '.') || local.startsWith(prefix + '_') || local.startsWith(prefix + '-')) {
      return prefix;
    }
  }

  return null;
}

/** Get the total count of known role prefixes */
export function getRolePrefixCount(): number {
  return ROLE_PREFIXES.size;
}
