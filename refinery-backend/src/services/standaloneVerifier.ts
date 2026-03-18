import { validateSyntax, fixTypos, deduplicateEmails } from './engine/syntaxValidator.js';
import { isDisposable } from './engine/disposableDomains.js';
import { detectRole } from './engine/roleDetector.js';
import { isFreeProvider, classifyProvider } from './engine/freeProviders.js';
import { resolveMx } from './engine/mxResolver.js';
import { probeEmail } from './engine/smtpProbe.js';
import { acquireSlot, releaseSlot, applyBackoff, resetBackoff, setLimits } from './engine/rateLimiter.js';
import { genId } from '../utils/helpers.js';

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
  catch_all: number;          // Default: 30
  role_based: number;         // Default: 20
  free_provider: number;      // Default: 10
  typo_detected: number;      // Default: 5 (after fix)
}

export const DEFAULT_SEVERITY_WEIGHTS: SeverityWeights = {
  syntax_invalid: 100,
  disposable: 90,
  no_mx: 85,
  smtp_invalid: 100,
  smtp_risky: 50,
  catch_all: 30,
  role_based: 20,
  free_provider: 10,
  typo_detected: 5,
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
    smtpResult: { status: string; code: number; response: string } | null;
    catchAll: boolean | null;
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
export async function runPipeline(
  emails: string[],
  checks: Partial<CheckConfig> = {},
  smtpConfig: Partial<SmtpConfig> = {},
  weights: Partial<SeverityWeights> = {},
  thresholds: Partial<SeverityThresholds> = {},
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
        const idx = domainIdx++;
        const [domain, indices] = domainEntries[idx];
        await processDomainChecks(domain, indices, results, cfg, smtp, w);
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
): Promise<void> {
  // ── MX Lookup ──
  let mxRecords: { exchange: string; priority: number }[] = [];

  if (cfg.mxLookup) {
    try {
      mxRecords = await resolveMx(domain);
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
    } catch {
      for (const idx of indices) {
        results[idx].checks.mxValid = { valid: false, mxCount: 0, primaryMx: null };
        results[idx].riskScore += weights.no_mx;
      }
    }
  }

  if (mxRecords.length === 0 && (cfg.smtpVerify || cfg.catchAll)) {
    // Can't do SMTP without MX records
    return;
  }

  // ── Catch-All Detection ──
  if (cfg.catchAll && mxRecords.length > 0) {
    const randomLocal = `xrfnry_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const probeAddr = `${randomLocal}@${domain}`;

    await acquireSlot(domain);
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

      // If catch-all, skip individual SMTP — we already know the domain accepts everything
      if (isCatchAll) {
        releaseSlot(domain);
        return;
      }
    } catch {
      for (const idx of indices) {
        results[idx].checks.catchAll = null; // Unknown
      }
    } finally {
      releaseSlot(domain);
    }
  }

  // ── Individual SMTP Verification ──
  if (cfg.smtpVerify && mxRecords.length > 0) {
    for (const idx of indices) {
      await acquireSlot(domain);
      try {
        // Try each MX host in priority order
        let lastResult: { status: 'valid' | 'invalid' | 'risky' | 'unknown'; code: number; response: string } = { status: 'unknown', code: 0, response: 'No MX reachable' };

        for (const mx of mxRecords) {
          try {
            const result = await probeEmail(mx.exchange, results[idx].email, {
              heloDomain: smtp.heloDomain,
              fromEmail: smtp.fromEmail,
              timeout: smtp.timeout,
              port: smtp.port,
            });
            lastResult = result;
            if (result.status === 'valid' || result.status === 'invalid') break;
          } catch {
            continue;
          }
        }

        results[idx].checks.smtpResult = {
          status: lastResult.status,
          code: lastResult.code,
          response: lastResult.response.substring(0, 200),
        };

        if (lastResult.status === 'invalid') {
          results[idx].riskScore += weights.smtp_invalid;
        } else if (lastResult.status === 'risky') {
          results[idx].riskScore += weights.smtp_risky;
        }

        // Adaptive backoff
        if (lastResult.status === 'risky' && lastResult.code >= 400 && lastResult.code < 500) {
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
