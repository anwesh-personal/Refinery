import dns from 'dns';

// ═══════════════════════════════════════════════════════════════
// DNSBL Monitor — checks IPs & domains against major blacklists
// Uses DNS lookups (reverse-IP query against BL zones)
// ═══════════════════════════════════════════════════════════════

const IP_BLACKLISTS = [
  'zen.spamhaus.org',
  'bl.spamcop.net',
  'b.barracudacentral.org',
  'dnsbl.sorbs.net',
  'spam.dnsbl.sorbs.net',
  'dnsbl-1.uceprotect.net',
  'cbl.abuseat.org',
  'dnsbl.dronebl.org',
  'psbl.surriel.com',
  'db.wpbl.info',
  'truncate.gbudb.net',
  'dyna.spamrats.com',
  'noptr.spamrats.com',
  'all.s5h.net',
];

const DOMAIN_BLACKLISTS = [
  'dbl.spamhaus.org',
  'multi.surbl.org',
  'black.uribl.com',
  'rhsbl.sorbs.net',
  'multi.uribl.com',
];

export interface BlacklistResult {
  target: string;          // IP or domain checked
  type: 'ip' | 'domain';
  total_checked: number;
  listed_on: string[];     // BLs where it IS listed
  clean_on: string[];      // BLs where it's NOT listed
  is_clean: boolean;
  checked_at: string;
}

/** Reverse an IP for DNSBL lookup: 1.2.3.4 → 4.3.2.1 */
function reverseIp(ip: string): string {
  return ip.split('.').reverse().join('.');
}

/** Check a single IP or domain against a single blacklist */
async function checkSingleBL(query: string, timeout = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeout);
    dns.resolve4(query, (err) => {
      clearTimeout(timer);
      // If we get a result (A record), it means the IP/domain IS listed
      resolve(!err);
    });
  });
}

/** Check an IP against all IP-based blacklists */
export async function checkIpBlacklists(ip: string): Promise<BlacklistResult> {
  const reversed = reverseIp(ip);
  const listed: string[] = [];
  const clean: string[] = [];

  // Run all checks in parallel with timeout
  const results = await Promise.allSettled(
    IP_BLACKLISTS.map(async (bl) => {
      const isListed = await checkSingleBL(`${reversed}.${bl}`);
      return { bl, isListed };
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (result.value.isListed) {
        listed.push(result.value.bl);
      } else {
        clean.push(result.value.bl);
      }
    }
  }

  return {
    target: ip,
    type: 'ip',
    total_checked: IP_BLACKLISTS.length,
    listed_on: listed,
    clean_on: clean,
    is_clean: listed.length === 0,
    checked_at: new Date().toISOString(),
  };
}

/** Check a domain against domain-based blacklists */
export async function checkDomainBlacklists(domain: string): Promise<BlacklistResult> {
  const listed: string[] = [];
  const clean: string[] = [];

  const results = await Promise.allSettled(
    DOMAIN_BLACKLISTS.map(async (bl) => {
      const isListed = await checkSingleBL(`${domain}.${bl}`);
      return { bl, isListed };
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (result.value.isListed) {
        listed.push(result.value.bl);
      } else {
        clean.push(result.value.bl);
      }
    }
  }

  return {
    target: domain,
    type: 'domain',
    total_checked: DOMAIN_BLACKLISTS.length,
    listed_on: listed,
    clean_on: clean,
    is_clean: listed.length === 0,
    checked_at: new Date().toISOString(),
  };
}

/** Batch check multiple IPs and domains */
export async function checkAll(ips: string[], domains: string[]): Promise<BlacklistResult[]> {
  const checks = [
    ...ips.map(ip => checkIpBlacklists(ip)),
    ...domains.map(d => checkDomainBlacklists(d)),
  ];
  return Promise.all(checks);
}
