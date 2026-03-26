import { validateSyntax, fixTypos, deduplicateEmails } from './engine/syntaxValidator.js';
import { isDisposable } from './engine/disposableDomains.js';
import { detectRole } from './engine/roleDetector.js';
import { isFreeProvider, classifyProvider } from './engine/freeProviders.js';
import { resolveMx } from './engine/mxResolver.js';
import { probeEmail, type SmtpProbeResult } from './engine/smtpProbe.js';
import { checkDomainAuth, type DomainAuthResult } from './engine/domainAuth.js';
import { checkMxDnsbl, type DnsblResult } from './engine/dnsbl.js';
import { checkDomainAge, type DomainAgeResult } from './engine/domainAge.js';
import { acquireSlot, releaseSlot, applyBackoff, resetBackoff, setLimits } from './engine/rateLimiter.js';
import { genId, sleep } from '../utils/helpers.js';

// ═══════════════════════════════════════════════════════════════
// Standalone Verification Pipeline — Direct email list processing
//
// Unlike the batch engine (verification.ts) which works on
// ClickHouse segments, this processes uploaded email lists
// with granular per-check control.
//
// Each check can be independently enabled/disabled.
// Results include per-check detail for full transparency.
// ═══════════════════════════════════════════════════════════════

/** Which checks the user wants to run */
export interface CheckConfig {
  /** Validate email syntax (RFC 5322) */
  syntax: boolean;
  /** Attempt to fix common domain typos (gmial → gmail) */
  typoFix: boolean;
  /** Remove duplicate emails from the list */
  deduplicate: boolean;
  /** Flag disposable/throwaway email domains */
  disposable: boolean;
  /** Flag role-based addresses (info@, admin@, etc.) */
  roleBased: boolean;
  /** Flag free email providers (Gmail, Yahoo, etc.) */
  freeProvider: boolean;
  /** Verify domain has MX records (DNS check) */
  mxLookup: boolean;
  /** SMTP RCPT TO verification (most accurate, slowest) */
  smtpVerify: boolean;
  /** Detect catch-all domains */
  catchAll: boolean;
}

export const DEFAULT_CHECK_CONFIG: CheckConfig = {
  syntax: true,
  typoFix: true,
  deduplicate: true,
  disposable: true,
  roleBased: true,
  freeProvider: true,
  mxLookup: true,
  smtpVerify: true,
  catchAll: true,
};

/** SMTP engine parameters */
export interface SmtpConfig {
  heloDomain: string;
  fromEmail: string;
  concurrency: number;
  timeout: number;
  port: number;
  minIntervalMs: number;
  maxConcurrentPerDomain: number;
}

export const DEFAULT_SMTP_CONFIG: SmtpConfig = {
  heloDomain: 'mail.refinery.local',
  fromEmail: 'verify@refinery.local',
  concurrency: 10,
  timeout: 15_000,
  port: 25,
  minIntervalMs: 2_000,
  maxConcurrentPerDomain: 2,
};

/** Severity scoring — user-configurable weights per check */
export interface SeverityWeights {
  syntax_invalid: number;     // Default: 100 (instant reject)
  disposable: number;         // Default: 90
  no_mx: number;              // Default: 85
  smtp_invalid: number;       // Default: 100 (instant reject)
  smtp_risky: number;         // Default: 50
  smtp_greylisted: number;    // Default: 40 (after retry)
  smtp_mailbox_full: number;  // Default: 60
  catch_all: number;          // Default: 30
  role_based: number;         // Default: 20
  free_provider: number;      // Default: 10
  typo_detected: number;      // Default: 5 (after fix)
  no_spf: number;             // Default: 15
  no_dmarc: number;           // Default: 10
  dnsbl_listed: number;       // Default: 70
  new_domain: number;         // Default: 40
}

export const DEFAULT_SEVERITY_WEIGHTS: SeverityWeights = {
  syntax_invalid: 100,
  disposable: 90,
  no_mx: 85,
  smtp_invalid: 100,
  smtp_risky: 50,
  smtp_greylisted: 40,
  smtp_mailbox_full: 60,
  catch_all: 30,
  role_based: 20,
  free_provider: 10,
  typo_detected: 5,
  no_spf: 15,
  no_dmarc: 10,
  dnsbl_listed: 70,
  new_domain: 40,
};

/** Severity thresholds — what score maps to what classification */
export interface SeverityThresholds {
  /** Score >= this = REJECT (default 80) */
  reject: number;
  /** Score >= this = RISKY (default 40) */
  risky: number;
  /** Score >= this = UNCERTAIN (default 15) */
  uncertain: number;
  /** Score < uncertain = SAFE */
}

export const DEFAULT_SEVERITY_THRESHOLDS: SeverityThresholds = {
  reject: 80,
  risky: 40,
  uncertain: 15,
};

/** Per-email result with full check detail */
export interface EmailCheckResult {
  email: string;
  originalEmail: string;

  // Overall classification
  classification: 'safe' | 'uncertain' | 'risky' | 'reject';
  riskScore: number;

  // Individual check results
  checks: {
    syntax: { passed: boolean; issues: string[] } | null;
    typoFixed: { corrected: boolean; original: string } | null;
    duplicate: boolean | null;
    disposable: boolean | null;
    roleBased: { detected: boolean; prefix: string | null } | null;
    freeProvider: { detected: boolean; category: string | null } | null;
    mxValid: { valid: boolean; mxCount: number; primaryMx: string | null } | null;
    smtpResult: { status: string; code: number; response: string; starttls: boolean } | null;
    catchAll: boolean | null;
    domainAuth: { spf: boolean; dmarc: boolean; authScore: number } | null;
    dnsbl: { listed: boolean; listings: string[]; ip: string } | null;
    domainAge: { ageDays: number; isNew: boolean; createdAt: string | null } | null;
  };
}

/** Full pipeline result */
export interface PipelineResult {
  id: string;
  startedAt: string;
  completedAt: string;
  totalInput: number;
  totalProcessed: number;
  duplicatesRemoved: number;
  typosFixed: number;

  // Counts by classification
  safe: number;
  uncertain: number;
  risky: number;
  rejected: number;

  // Detailed results
  results: EmailCheckResult[];

  // Config used (for reproducibility)
  checksEnabled: CheckConfig;
  severityWeights: SeverityWeights;
  thresholds: SeverityThresholds;
}

// ─── Pipeline Execution ───

/**
 * Run the full verification pipeline on a list of emails.
 * Each check can be independently enabled/disabled.
 * Returns granular per-email results with risk scoring.
 */
/** Thrown when the pipeline is cancelled via AbortSignal */
export class PipelineCancelledError extends Error {
  constructor(public readonly processedSoFar: number) {
    super(`Pipeline cancelled after processing ${processedSoFar} emails`);
    this.name = 'PipelineCancelledError';
  }
}

export async function runPipeline(
  emails: string[],
  checks: Partial<CheckConfig> = {},
  smtpConfig: Partial<SmtpConfig> = {},
  weights: Partial<SeverityWeights> = {},
  thresholds: Partial<SeverityThresholds> = {},
  onProgress?: (processed: number, total: number) => void,
  signal?: AbortSignal,
): Promise<PipelineResult> {
  const id = genId();
  const startedAt = new Date().toISOString();

  const cfg = { ...DEFAULT_CHECK_CONFIG, ...checks };
  const smtp = { ...DEFAULT_SMTP_CONFIG, ...smtpConfig };
  const w = { ...DEFAULT_SEVERITY_WEIGHTS, ...weights };
  const t = { ...DEFAULT_SEVERITY_THRESHOLDS, ...thresholds };

  // ── Phase 0: Dedup + Typo Fix ──
  let workingEmails = emails.map(e => e.trim().toLowerCase()).filter(Boolean);
  let duplicatesRemoved = 0;
  let typosFixed = 0;

  if (cfg.deduplicate) {
    const dedup = deduplicateEmails(workingEmails);
    workingEmails = dedup.unique;
    duplicatesRemoved = dedup.duplicatesRemoved;
  }

  if (cfg.typoFix) {
    workingEmails = workingEmails.map(e => {
      const fixed = fixTypos(e);
      if (fixed.wasCorrected) typosFixed++;
      return fixed.corrected;
    });
  }

  // ── Phase 1: Per-email checks (no network) ──
  const results: EmailCheckResult[] = [];

  for (const email of workingEmails) {
    const original = email;
    const result: EmailCheckResult = {
      email,
      originalEmail: original,
      classification: 'safe',
      riskScore: 0,
      checks: {
        syntax: null,
        typoFixed: null,
        duplicate: null,
        disposable: null,
        roleBased: null,
        freeProvider: null,
        mxValid: null,
        smtpResult: null,
        catchAll: null,
        domainAuth: null,
        dnsbl: null,
        domainAge: null,
      },
    };

    // Syntax
    if (cfg.syntax) {
      const syn = validateSyntax(email, true);
      result.checks.syntax = { passed: syn.valid, issues: syn.issues };
      result.email = syn.normalized;
      if (!syn.valid) {
        result.riskScore += w.syntax_invalid;
      }
    }

    // Domain extraction
    const atIdx = result.email.indexOf('@');
    const domain = atIdx > 0 ? result.email.substring(atIdx + 1) : '';

    // Disposable
    if (cfg.disposable && domain) {
      const disp = isDisposable(domain);
      result.checks.disposable = disp;
      if (disp) result.riskScore += w.disposable;
    }

    // Role-based
    if (cfg.roleBased) {
      const role = detectRole(result.email);
      result.checks.roleBased = { detected: !!role, prefix: role };
      if (role) result.riskScore += w.role_based;
    }

    // Free provider
    if (cfg.freeProvider && domain) {
      const free = isFreeProvider(domain);
      const cat = free ? classifyProvider(domain) : null;
      result.checks.freeProvider = { detected: free, category: cat };
      if (free) result.riskScore += w.free_provider;
    }

    results.push(result);
  }

  // Report Phase 1 progress
  if (onProgress) onProgress(results.length, workingEmails.length);

  // ── Phase 2: Domain-level checks (DNS) ──
  if (cfg.mxLookup || cfg.smtpVerify || cfg.catchAll) {
    // Group by domain
    const byDomain = new Map<string, number[]>();
    for (let i = 0; i < results.length; i++) {
      const atIdx = results[i].email.indexOf('@');
      if (atIdx <= 0) continue;
      const domain = results[i].email.substring(atIdx + 1);
      const list = byDomain.get(domain) || [];
      list.push(i);
      byDomain.set(domain, list);
    }

    // Set rate limits
    if (cfg.smtpVerify) {
      setLimits({
        minIntervalMs: smtp.minIntervalMs,
        maxConcurrentPerDomain: smtp.maxConcurrentPerDomain,
        globalMaxConcurrent: smtp.concurrency * 5,
      });
    }

    // Process domains concurrently
    const domainEntries = [...byDomain.entries()];
    let domainIdx = 0;
    const workerCount = Math.min(smtp.concurrency, domainEntries.length);

    const workers = Array.from({ length: workerCount }, async () => {
      while (domainIdx < domainEntries.length) {
        // Check for cancellation before each domain batch
        if (signal?.aborted) {
          const processed = domainEntries.slice(0, domainIdx).reduce((s, [, idxs]) => s + idxs.length, 0);
          throw new PipelineCancelledError(processed);
        }
        const idx = domainIdx++;
        const [domain, indices] = domainEntries[idx];

        // Per-domain hard timeout: 120s max per domain to prevent infinite blocking
        const DOMAIN_TIMEOUT_MS = 120_000;
        try {
          await Promise.race([
            processDomainChecks(domain, indices, results, cfg, smtp, w, signal),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error(`Domain timeout: ${domain}`)), DOMAIN_TIMEOUT_MS)
            ),
          ]);
        } catch (err: any) {
          if (err instanceof PipelineCancelledError) throw err;
          // Domain timed out or errored — mark all emails for this domain as unknown
          for (const i of indices) {
            if (!results[i].checks.smtpResult) {
              results[i].checks.smtpResult = { status: 'unknown', code: 0, response: `Skipped: ${err.message}`, starttls: false };
            }
          }
        }

        // Report progress per domain batch
        if (onProgress) {
          const processed = Math.min(domainEntries.slice(0, idx + 1).reduce((s, [, idxs]) => s + idxs.length, 0), workingEmails.length);
          onProgress(processed, workingEmails.length);
        }
      }
    });

    await Promise.all(workers);
  }

  // ── Phase 3: Classify ──
  let safe = 0, uncertain = 0, risky = 0, rejected = 0;

  for (const r of results) {
    if (r.riskScore >= t.reject) {
      r.classification = 'reject';
      rejected++;
    } else if (r.riskScore >= t.risky) {
      r.classification = 'risky';
      risky++;
    } else if (r.riskScore >= t.uncertain) {
      r.classification = 'uncertain';
      uncertain++;
    } else {
      r.classification = 'safe';
      safe++;
    }
  }

  return {
    id,
    startedAt,
    completedAt: new Date().toISOString(),
    totalInput: emails.length,
    totalProcessed: results.length,
    duplicatesRemoved,
    typosFixed,
    safe,
    uncertain,
    risky,
    rejected,
    results,
    checksEnabled: cfg,
    severityWeights: w,
    thresholds: t,
  };
}

// ─── Domain-Level Processing ───

async function processDomainChecks(
  domain: string,
  indices: number[],
  results: EmailCheckResult[],
  cfg: CheckConfig,
  smtp: SmtpConfig,
  weights: SeverityWeights,
  signal?: AbortSignal,
): Promise<void> {
  // ── Parallel: MX Lookup + SPF/DMARC + Domain Age ──
  let mxRecords: { exchange: string; priority: number }[] = [];
  let authResult: DomainAuthResult | null = null;
  let ageResult: DomainAgeResult | null = null;

  const [mxRes, authRes, ageRes] = await Promise.allSettled([
    cfg.mxLookup ? resolveMx(domain) : Promise.resolve([]),
    checkDomainAuth(domain),
    checkDomainAge(domain),
  ]);

  // MX results
  if (mxRes.status === 'fulfilled') {
    mxRecords = mxRes.value;
  }
  if (cfg.mxLookup) {
    for (const idx of indices) {
      results[idx].checks.mxValid = {
        valid: mxRecords.length > 0,
        mxCount: mxRecords.length,
        primaryMx: mxRecords[0]?.exchange || null,
      };
      if (mxRecords.length === 0) {
        results[idx].riskScore += weights.no_mx;
      }
    }
  }

  // SPF/DMARC results
  if (authRes.status === 'fulfilled') {
    authResult = authRes.value;
    for (const idx of indices) {
      results[idx].checks.domainAuth = {
        spf: authResult.spf.exists,
        dmarc: authResult.dmarc.exists,
        authScore: authResult.authScore,
      };
      if (!authResult.spf.exists) results[idx].riskScore += weights.no_spf;
      if (!authResult.dmarc.exists) results[idx].riskScore += weights.no_dmarc;
    }
  }

  // Domain age results
  if (ageRes.status === 'fulfilled') {
    ageResult = ageRes.value;
    for (const idx of indices) {
      results[idx].checks.domainAge = {
        ageDays: ageResult.ageDays,
        isNew: ageResult.isNew,
        createdAt: ageResult.createdAt,
      };
      if (ageResult.isNew) results[idx].riskScore += weights.new_domain;
    }
  }

  // ── DNSBL check (needs MX IP) ──
  if (mxRecords.length > 0) {
    try {
      const dnsblResult = await checkMxDnsbl(mxRecords[0].exchange);
      for (const idx of indices) {
        results[idx].checks.dnsbl = {
          listed: dnsblResult.listed,
          listings: dnsblResult.listings,
          ip: dnsblResult.ip,
        };
        if (dnsblResult.listed) results[idx].riskScore += weights.dnsbl_listed;
      }
    } catch {
      // DNSBL check failed — don't penalize
    }
  }

  if (mxRecords.length === 0 && (cfg.smtpVerify || cfg.catchAll)) {
    return;
  }

  // ── Catch-All Detection ──
  if (cfg.catchAll && mxRecords.length > 0) {
    const randomLocal = `xrfnry_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const probeAddr = `${randomLocal}@${domain}`;

    await acquireSlot(domain, signal);
    try {
      const result = await probeEmail(mxRecords[0].exchange, probeAddr, {
        heloDomain: smtp.heloDomain,
        fromEmail: smtp.fromEmail,
        timeout: smtp.timeout,
        port: smtp.port,
      });

      const isCatchAll = result.status === 'valid';
      for (const idx of indices) {
        results[idx].checks.catchAll = isCatchAll;
        if (isCatchAll) {
          results[idx].riskScore += weights.catch_all;
        }
      }

      if (isCatchAll) {
        // Catch-all domain — skip individual SMTP checks (they'd all return valid)
        return;
      }
    } catch {
      for (const idx of indices) {
        results[idx].checks.catchAll = null;
      }
    } finally {
      releaseSlot(domain);
    }
  }

  // ── Individual SMTP Verification (with greylisting retry) ──
  if (cfg.smtpVerify && mxRecords.length > 0) {
    for (const idx of indices) {
      // Check for cancellation before each SMTP probe
      if (signal?.aborted) return;
      await acquireSlot(domain, signal);
      try {
        let lastResult: SmtpProbeResult = { status: 'unknown', code: 0, response: 'No MX reachable', starttls: false };

        for (const mx of mxRecords) {
          try {
            const result = await probeEmail(mx.exchange, results[idx].email, {
              heloDomain: smtp.heloDomain,
              fromEmail: smtp.fromEmail,
              timeout: smtp.timeout,
              port: smtp.port,
            });
            lastResult = result;

            // Greylisting retry: if 450/451, wait 30s and try once more
            if (result.status === 'greylisted') {
              releaseSlot(domain);
              await sleep(30_000);
              await acquireSlot(domain);
              const retry = await probeEmail(mx.exchange, results[idx].email, {
                heloDomain: smtp.heloDomain,
                fromEmail: smtp.fromEmail,
                timeout: smtp.timeout,
                port: smtp.port,
              });
              lastResult = retry;
              // If still greylisted after retry, keep that status
            }

            if (result.status === 'valid' || result.status === 'invalid') break;
          } catch {
            continue;
          }
        }

        results[idx].checks.smtpResult = {
          status: lastResult.status,
          code: lastResult.code,
          response: lastResult.response.substring(0, 200),
          starttls: lastResult.starttls,
        };

        if (lastResult.status === 'invalid') {
          results[idx].riskScore += weights.smtp_invalid;
        } else if (lastResult.status === 'greylisted') {
          results[idx].riskScore += weights.smtp_greylisted;
        } else if (lastResult.status === 'mailbox_full') {
          results[idx].riskScore += weights.smtp_mailbox_full;
        } else if (lastResult.status === 'risky') {
          results[idx].riskScore += weights.smtp_risky;
        }

        // Adaptive backoff
        if (['risky', 'greylisted', 'mailbox_full'].includes(lastResult.status) && lastResult.code >= 400 && lastResult.code < 500) {
          applyBackoff(domain);
        } else if (lastResult.status === 'valid' || lastResult.status === 'invalid') {
          resetBackoff(domain);
        }
      } finally {
        releaseSlot(domain);
      }
    }
  }
}
