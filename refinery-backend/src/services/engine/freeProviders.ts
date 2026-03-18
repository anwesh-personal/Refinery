// ═══════════════════════════════════════════════════════════════
// Free Provider Detector — Identifies free/consumer email services
//
// Emails from free providers (Gmail, Yahoo, Hotmail) are
// typically personal addresses, not business. In B2B contexts
// these have lower value and higher risk for cold outreach.
//
// This is NOT a block list — it's a classification aid.
// The user decides whether to include or exclude them.
// ═══════════════════════════════════════════════════════════════

const FREE_PROVIDERS = new Set([
  // ── Tier 1: Billions of users ──
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'yahoo.ca', 'yahoo.com.au',
  'yahoo.fr', 'yahoo.de', 'yahoo.it', 'yahoo.es', 'yahoo.co.jp',
  'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de',
  'hotmail.it', 'hotmail.es', 'live.com', 'live.co.uk', 'live.fr',
  'msn.com', 'passport.com',

  // ── Tier 2: Hundreds of millions ──
  'aol.com', 'aol.co.uk',
  'icloud.com', 'me.com', 'mac.com',
  'mail.com', 'email.com',
  'zoho.com', 'zohomail.com',
  'protonmail.com', 'protonmail.ch', 'proton.me', 'pm.me',
  'tutanota.com', 'tutamail.com', 'tuta.io',
  'gmx.com', 'gmx.net', 'gmx.de', 'gmx.at', 'gmx.ch',
  'web.de', 'freenet.de', 't-online.de',

  // ── Tier 3: Regional free providers ──
  'yandex.com', 'yandex.ru', 'ya.ru',
  'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru',
  'qq.com', '163.com', '126.com', 'sina.com', 'sohu.com',
  'naver.com', 'daum.net', 'hanmail.net',
  'rediffmail.com', 'sify.com',
  'uol.com.br', 'bol.com.br', 'terra.com.br',
  'laposte.net', 'orange.fr', 'sfr.fr', 'free.fr',
  'virgilio.it', 'libero.it', 'tiscali.it', 'alice.it',
  'rambler.ru', 'ukr.net', 'bigmir.net',
  'wp.pl', 'onet.pl', 'interia.pl', 'o2.pl',
  'centrum.cz', 'seznam.cz', 'atlas.cz',

  // ── Tier 4: ISP-based free email ──
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net',
  'charter.net', 'cox.net', 'earthlink.net', 'juno.com',
  'bellsouth.net', 'optonline.net', 'windstream.net',
  'btinternet.com', 'sky.com', 'talktalk.net', 'ntlworld.com',
  'virginmedia.com', 'blueyonder.co.uk',
  'rogers.com', 'shaw.ca', 'telus.net', 'sympatico.ca',
  'bigpond.com', 'optusnet.com.au', 'tpg.com.au',

  // ── Privacy-focused ──
  'fastmail.com', 'fastmail.fm',
  'hushmail.com', 'hush.com',
  'runbox.com', 'mailfence.com',
  'startmail.com', 'posteo.de', 'mailbox.org',
  'disroot.org', 'riseup.net',
]);

/**
 * Check if an email domain is a known free/consumer provider.
 */
export function isFreeProvider(domain: string): boolean {
  return FREE_PROVIDERS.has(domain.toLowerCase().trim());
}

/**
 * Classify a free provider into a category.
 */
export function classifyProvider(domain: string): 'major' | 'regional' | 'isp' | 'privacy' | null {
  const d = domain.toLowerCase().trim();
  if (!FREE_PROVIDERS.has(d)) return null;

  // Major global providers
  if (['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
    'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com'].includes(d) ||
    d.startsWith('yahoo.') || d.startsWith('hotmail.') || d.startsWith('live.')) {
    return 'major';
  }

  // Privacy-focused
  if (['protonmail.com', 'protonmail.ch', 'proton.me', 'pm.me', 'tutanota.com',
    'tuta.io', 'hushmail.com', 'fastmail.com', 'mailfence.com', 'startmail.com',
    'posteo.de', 'mailbox.org', 'disroot.org', 'riseup.net'].includes(d)) {
    return 'privacy';
  }

  // ISP
  if (['comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'charter.net',
    'cox.net', 'earthlink.net', 'bellsouth.net', 'btinternet.com', 'sky.com',
    'rogers.com', 'shaw.ca', 'bigpond.com'].includes(d)) {
    return 'isp';
  }

  return 'regional';
}

/** Total number of known free providers */
export function getFreeProviderCount(): number {
  return FREE_PROVIDERS.size;
}
