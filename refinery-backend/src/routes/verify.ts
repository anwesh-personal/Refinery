import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import { getRequestUser } from '../types/auth.js';
import {
  runPipeline,
  PipelineCancelledError,
  DEFAULT_CHECK_CONFIG,
  DEFAULT_SMTP_CONFIG,
  DEFAULT_SEVERITY_WEIGHTS,
  DEFAULT_SEVERITY_THRESHOLDS,
  type PipelineResult,
} from '../services/standaloneVerifier.js';
import { getConfigInt, CONFIG_KEYS } from '../services/config.js';

// ── Active Job Controllers — allows cancellation of running jobs ──
const activeJobs = new Map<string, AbortController>();

// ═══════════════════════════════════════════════════════════════
// Standalone Verify Routes — Direct email list verification
//
// POST /api/verify          Upload + verify email list
// GET  /api/verify/defaults Get default config for all checks
// ═══════════════════════════════════════════════════════════════

const router = Router();
router.use(requireAuth);

// ─── Zod Schemas ───

const CheckConfigSchema = z.object({
  syntax: z.boolean().default(true),
  typoFix: z.boolean().default(true),
  deduplicate: z.boolean().default(true),
  disposable: z.boolean().default(true),
  roleBased: z.boolean().default(true),
  freeProvider: z.boolean().default(true),
  mxLookup: z.boolean().default(true),
  smtpVerify: z.boolean().default(true),
  catchAll: z.boolean().default(true),
}).partial();

const SmtpConfigSchema = z.object({
  heloDomain: z.string().optional(),
  fromEmail: z.string().optional(),
  concurrency: z.number().min(1).max(50).optional(),
  timeout: z.number().min(1000).max(60000).optional(),
  port: z.number().min(1).max(65535).optional(),
  minIntervalMs: z.number().min(100).max(30000).optional(),
  maxConcurrentPerDomain: z.number().min(1).max(20).optional(),
}).partial();

const SeverityWeightsSchema = z.object({
  syntax_invalid: z.number().min(0).max(100).optional(),
  disposable: z.number().min(0).max(100).optional(),
  no_mx: z.number().min(0).max(100).optional(),
  smtp_invalid: z.number().min(0).max(100).optional(),
  smtp_risky: z.number().min(0).max(100).optional(),
  smtp_greylisted: z.number().min(0).max(100).optional(),
  smtp_mailbox_full: z.number().min(0).max(100).optional(),
  catch_all: z.number().min(0).max(100).optional(),
  role_based: z.number().min(0).max(100).optional(),
  free_provider: z.number().min(0).max(100).optional(),
  typo_detected: z.number().min(0).max(100).optional(),
  no_spf: z.number().min(0).max(100).optional(),
  no_dmarc: z.number().min(0).max(100).optional(),
  dnsbl_listed: z.number().min(0).max(100).optional(),
  new_domain: z.number().min(0).max(100).optional(),
}).partial();

const ThresholdsSchema = z.object({
  reject: z.number().min(0).max(100).optional(),
  risky: z.number().min(0).max(100).optional(),
  uncertain: z.number().min(0).max(100).optional(),
}).partial();

const VerifyRequestSchema = z.object({
  emails: z.array(z.string()).min(1, 'At least 1 email required'),
  checks: CheckConfigSchema.optional(),
  smtp: SmtpConfigSchema.optional(),
  severityWeights: SeverityWeightsSchema.optional(),
  thresholds: ThresholdsSchema.optional(),
});

// ─── POST /api/verify ───
// Upload and verify a list of emails with granular check control.

router.post('/', requireSuperadmin, async (req, res) => {
  try {
    const parsed = VerifyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    }

    const { emails, checks, smtp, severityWeights, thresholds } = parsed.data;

    // Enforce configurable limit from system_config (not hardcoded)
    const maxEmails = await getConfigInt(CONFIG_KEYS.PIPELINE_MAX_EMAILS);
    if (emails.length > maxEmails) {
      return res.status(400).json({
        error: `Max ${maxEmails.toLocaleString()} emails per request. You provided ${emails.length.toLocaleString()}. Configure this limit in Server Config → pipeline.max_emails_per_job.`,
      });
    }

    console.log(`[Verify] Starting pipeline: ${emails.length} emails, checks: ${JSON.stringify(checks || 'all')}`);

    const result = await runPipeline(
      emails,
      checks || {},
      smtp || {},
      severityWeights || {},
      thresholds || {},
    );

    console.log(`[Verify] Pipeline ${result.id} complete: ${result.safe} safe, ${result.risky} risky, ${result.rejected} rejected`);

    res.json(result);
  } catch (e: any) {
    console.error('[Verify] Pipeline error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/verify/defaults ───
// Returns all default configuration values for the UI.

router.get('/defaults', async (_req, res) => {
  const maxEmails = await getConfigInt(CONFIG_KEYS.PIPELINE_MAX_EMAILS);
  const segmentExportLimit = await getConfigInt(CONFIG_KEYS.SEGMENT_EXPORT_LIMIT);
  res.json({
    checks: DEFAULT_CHECK_CONFIG,
    smtp: DEFAULT_SMTP_CONFIG,
    severityWeights: DEFAULT_SEVERITY_WEIGHTS,
    thresholds: DEFAULT_SEVERITY_THRESHOLDS,
    limits: {
      maxEmailsPerJob: maxEmails,
      segmentExportLimit,
    },
  });
});

// ─── POST /api/verify/export ───
// Export pipeline results as CSV

router.post('/export', requireSuperadmin, async (req, res) => {
  try {
    const results: PipelineResult['results'] = req.body.results;
    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ error: 'results array is required' });
    }

    const header = 'email,classification,risk_score,syntax,disposable,role_based,free_provider,mx_valid,spf,dmarc,dnsbl_listed,domain_age_days,smtp_status,starttls,catch_all\n';
    const rows = results.map((r: any) => {
      const cols = [
        `"${r.email.replace(/"/g, '""')}"`,
        r.classification,
        r.riskScore,
        r.checks.syntax ? (r.checks.syntax.passed ? 'pass' : 'fail') : 'skipped',
        r.checks.disposable === null ? 'skipped' : (r.checks.disposable ? 'yes' : 'no'),
        r.checks.roleBased === null ? 'skipped' : (r.checks.roleBased.detected ? r.checks.roleBased.prefix : 'no'),
        r.checks.freeProvider === null ? 'skipped' : (r.checks.freeProvider.detected ? r.checks.freeProvider.category : 'no'),
        r.checks.mxValid === null ? 'skipped' : (r.checks.mxValid.valid ? 'valid' : 'invalid'),
        r.checks.domainAuth ? (r.checks.domainAuth.spf ? 'yes' : 'no') : 'skipped',
        r.checks.domainAuth ? (r.checks.domainAuth.dmarc ? 'yes' : 'no') : 'skipped',
        r.checks.dnsbl ? (r.checks.dnsbl.listed ? r.checks.dnsbl.listings.join(';') : 'clean') : 'skipped',
        r.checks.domainAge ? (r.checks.domainAge.ageDays >= 0 ? r.checks.domainAge.ageDays : 'unknown') : 'skipped',
        r.checks.smtpResult === null ? 'skipped' : r.checks.smtpResult.status,
        r.checks.smtpResult === null ? 'skipped' : (r.checks.smtpResult.starttls ? 'yes' : 'no'),
        r.checks.catchAll === null ? 'skipped' : (r.checks.catchAll ? 'yes' : 'no'),
      ];
      return cols.join(',');
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="verification-results.csv"');
    res.send(header + rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/verify/async ───
// Submit a verification job that runs in the background.
// Returns a jobId immediately. Poll /api/verify/jobs/:id for progress.

import { query as chQuery, command as chCommand, insertRows } from '../db/clickhouse.js';
import { genId } from '../utils/helpers.js';

router.post('/async', requireSuperadmin, async (req, res) => {
  try {
    const parsed = VerifyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    }

    const { emails, checks, smtp, severityWeights, thresholds } = parsed.data;

    // Enforce configurable limit from system_config
    const maxEmails = await getConfigInt(CONFIG_KEYS.PIPELINE_MAX_EMAILS);
    if (emails.length > maxEmails) {
      return res.status(400).json({
        error: `Max ${maxEmails.toLocaleString()} emails per job. You provided ${emails.length.toLocaleString()}. Configure this in Server Config → pipeline.max_emails_per_job.`,
      });
    }

    const jobId = genId();
    const user = getRequestUser(req);

    // Store job in ClickHouse
    await insertRows('pipeline_jobs', [{
      id: jobId,
      total_emails: emails.length,
      status: 'processing',
      config_json: JSON.stringify({ checks, smtp, severityWeights, thresholds }),
      performed_by: user.id,
      performed_by_name: user.name,
    }]);

    // Create AbortController for this job
    const controller = new AbortController();
    activeJobs.set(jobId, controller);

    // Run pipeline in background (not awaited)
    (async () => {
      try {
        console.log(`[Pipeline] Job ${jobId}: Starting ${emails.length} emails in background`);

        const result = await runPipeline(
          emails,
          checks || {},
          smtp || {},
          severityWeights || {},
          thresholds || {},
          async (processed, total) => {
            try {
              await chCommand(`
                ALTER TABLE pipeline_jobs UPDATE
                  processed_count = ${processed}
                WHERE id = '${jobId}'
              `);
            } catch { /* ignore progress update failures */ }
          },
          controller.signal,
        );

        // Store results
        await chCommand(`
          ALTER TABLE pipeline_jobs UPDATE
            processed_count = ${result.totalProcessed},
            safe_count = ${result.safe},
            risky_count = ${result.risky},
            rejected_count = ${result.rejected},
            uncertain_count = ${result.uncertain},
            duplicates_removed = ${result.duplicatesRemoved},
            typos_fixed = ${result.typosFixed},
            status = 'complete',
            results_json = '${JSON.stringify(result.results).replace(/'/g, "\\'")}',
            completed_at = now()
          WHERE id = '${jobId}'
        `);

        console.log(`[Pipeline] Job ${jobId}: Complete — ${result.safe} safe, ${result.risky} risky, ${result.rejected} rejected`);
      } catch (err: any) {
        if (err instanceof PipelineCancelledError) {
          console.log(`[Pipeline] Job ${jobId}: Cancelled at ${err.processedSoFar} emails`);
          await chCommand(`
            ALTER TABLE pipeline_jobs UPDATE
              status = 'cancelled',
              error_message = 'Cancelled by user after processing ${err.processedSoFar} emails'
            WHERE id = '${jobId}'
          `).catch(() => {});
        } else {
          console.error(`[Pipeline] Job ${jobId} failed:`, err.message);
          await chCommand(`
            ALTER TABLE pipeline_jobs UPDATE
              status = 'failed',
              error_message = '${(err.message || 'Unknown error').replace(/'/g, "\\'").substring(0, 500)}'
            WHERE id = '${jobId}'
          `).catch(() => { });
        }
      } finally {
        activeJobs.delete(jobId);
      }
    })();

    // Return immediately
    res.json({ jobId, totalEmails: emails.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
// ─── POST /api/verify/jobs/:id/cancel ───
// Cancel a running pipeline job.

router.post('/jobs/:id/cancel', requireSuperadmin, async (req, res) => {
  const jobId = req.params.id as string;
  const controller = activeJobs.get(jobId);
  if (!controller) {
    // Job is not running in this process — might be orphaned
    const [job] = await chQuery<any>(`
      SELECT status FROM pipeline_jobs WHERE id = '${jobId}' LIMIT 1
    `);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status === 'processing') {
      // Orphaned job — mark as cancelled directly
      await chCommand(`
        ALTER TABLE pipeline_jobs UPDATE
          status = 'cancelled',
          error_message = 'Cancelled (job was orphaned — no active process found)'
        WHERE id = '${jobId}'
      `);
      return res.json({ cancelled: true, note: 'Job was orphaned and has been marked cancelled' });
    }
    return res.status(400).json({ error: `Job is ${job.status}, not running` });
  }

  const user = getRequestUser(req);
  console.log(`[Pipeline] Job ${jobId}: Cancel requested by ${user.name}`);
  controller.abort();
  res.json({ cancelled: true });
});

// ─── Orphan Recovery ───
// On server startup, mark any "processing" jobs as failed.
// They were killed when the server restarted.

export async function recoverOrphanedJobs(): Promise<void> {
  try {
    const orphans = await chQuery<{ id: string }>(`
      SELECT id FROM pipeline_jobs WHERE status = 'processing'
    `);
    if (orphans.length > 0) {
      console.log(`[Pipeline] Found ${orphans.length} orphaned jobs — marking as failed`);
      await chCommand(`
        ALTER TABLE pipeline_jobs UPDATE
          status = 'failed',
          error_message = 'Server restarted while job was processing — resubmit to retry'
        WHERE status = 'processing'
      `);
    }
  } catch (err: any) {
    console.error('[Pipeline] Orphan recovery error:', err.message);
  }
}

// ─── GET /api/verify/jobs ───
// List recent pipeline jobs.

router.get('/jobs', requireSuperadmin, async (_req, res) => {
  try {
    const jobs = await chQuery(`
      SELECT id, total_emails, processed_count, safe_count, risky_count, rejected_count,
             uncertain_count, duplicates_removed, typos_fixed, status, error_message,
             started_at, completed_at
      FROM pipeline_jobs
      ORDER BY started_at DESC
      LIMIT 20
    `);
    res.json(jobs);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/verify/jobs/:id ───
// Get job status and progress. Results included when status = 'complete'.

router.get('/jobs/:id', requireSuperadmin, async (req, res) => {
  try {
    const [job] = await chQuery<any>(`
      SELECT id, total_emails, processed_count, safe_count, risky_count, rejected_count,
             uncertain_count, duplicates_removed, typos_fixed, status, error_message,
             results_json, started_at, completed_at
      FROM pipeline_jobs
      WHERE id = '${req.params.id}'
      LIMIT 1
    `);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Parse results_json if complete
    const response: any = { ...job };
    if (job.status === 'complete' && job.results_json) {
      try {
        response.results = JSON.parse(job.results_json);
      } catch { response.results = []; }
      delete response.results_json;
    } else {
      delete response.results_json;
    }

    res.json(response);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/verify/jobs/:id/download ───
// Download results CSV for a completed pipeline job.

router.get('/jobs/:id/download', requireSuperadmin, async (req, res) => {
  try {
    const [job] = await chQuery<any>(`
      SELECT id, results_json, total_emails, status
      FROM pipeline_jobs
      WHERE id = '${req.params.id}'
      LIMIT 1
    `);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'complete') return res.status(400).json({ error: 'Job not complete yet' });
    if (!job.results_json) return res.status(404).json({ error: 'No results stored for this job' });

    let results: any[];
    try { results = JSON.parse(job.results_json); } catch { return res.status(500).json({ error: 'Corrupt results data' }); }

    // Build CSV
    const headers = ['Email', 'Classification', 'Risk Score', 'Original Email', 'Syntax', 'Typo Fixed',
      'Disposable', 'Role Based', 'Free Provider', 'MX Valid', 'Catch All', 'SMTP Status', 'SMTP Response'];

    const rows = results.map((r: any) => [
      `"${(r.email || '').replace(/"/g, '""')}"`,
      r.classification || '',
      r.riskScore ?? '',
      `"${(r.originalEmail || r.email || '').replace(/"/g, '""')}"`,
      r.checks?.syntax ? (r.checks.syntax.passed ? 'pass' : 'fail') : 'skipped',
      r.checks?.typoFixed ? (r.checks.typoFixed.corrected ? 'yes' : 'no') : 'skipped',
      r.checks?.disposable === null || r.checks?.disposable === undefined ? 'skipped' : (r.checks.disposable ? 'yes' : 'no'),
      r.checks?.roleBased?.detected ? r.checks.roleBased.prefix : 'no',
      r.checks?.freeProvider?.detected ? r.checks.freeProvider.category : 'no',
      r.checks?.mxValid?.valid != null ? (r.checks.mxValid.valid ? 'yes' : 'no') : 'skipped',
      r.checks?.catchAll != null ? (r.checks.catchAll ? 'yes' : 'no') : 'skipped',
      r.checks?.smtpResult ? r.checks.smtpResult.status : 'skipped',
      r.checks?.smtpResult ? `"${(r.checks.smtpResult.response || '').replace(/"/g, '""')}"` : 'skipped',
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="verification-${req.params.id}.csv"`);
    res.send(csv);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/verify/jobs/:id/ingest ───
// Push results from a completed pipeline job into universal_person.
// Supports granular controls: classification filters, risk threshold, overwrite mode, dry-run.

interface IngestOptions {
  /** Which classifications to include (default: all) */
  classifications?: string[];
  /** Only include emails with riskScore <= this value (default: no limit) */
  maxRiskScore?: number;
  /** 'unverified_only' = skip already-verified, 'overwrite' = update all matches */
  mode?: 'unverified_only' | 'overwrite';
  /** If true, just count matches without updating */
  dryRun?: boolean;
}

router.post('/jobs/:id/ingest', requireSuperadmin, async (req, res) => {
  try {
    const [job] = await chQuery<any>(`
      SELECT id, results_json, status
      FROM pipeline_jobs
      WHERE id = '${req.params.id}'
      LIMIT 1
    `);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'complete') return res.status(400).json({ error: 'Job not complete yet' });
    if (!job.results_json) return res.status(404).json({ error: 'No results stored' });

    let allResults: any[];
    try { allResults = JSON.parse(job.results_json); } catch { return res.status(500).json({ error: 'Corrupt results data' }); }

    const opts: IngestOptions = req.body || {};
    const allowedClassifications = opts.classifications || ['safe', 'uncertain', 'risky', 'reject'];
    const maxRisk = opts.maxRiskScore ?? Infinity;
    const mode = opts.mode || 'unverified_only';
    const dryRun = opts.dryRun === true;

    // Filter results based on user selection
    const filtered = allResults.filter(r =>
      allowedClassifications.includes(r.classification) &&
      (r.riskScore ?? 0) <= maxRisk
    );

    const statusMap: Record<string, string> = { safe: 'valid', uncertain: 'risky', risky: 'risky', reject: 'invalid' };
    const user = getRequestUser(req);
    console.log(`[Ingest] User ${user.name} ingesting job ${req.params.id}: ${filtered.length}/${allResults.length} results (classifications: ${allowedClassifications.join(',')}, maxRisk: ${maxRisk}, mode: ${mode}, dryRun: ${dryRun})`);

    const BATCH = 500;
    let totalMatched = 0;
    let totalFiltered = filtered.length;
    let totalSkippedAlreadyVerified = 0;
    const counts: Record<string, number> = { valid: 0, risky: 0, invalid: 0 };

    // Group filtered results by target status
    const grouped = new Map<string, string[]>();
    for (const r of filtered) {
      const s = statusMap[r.classification] || 'risky';
      if (!grouped.has(s)) grouped.set(s, []);
      grouped.get(s)!.push((r.email || '').toLowerCase().trim());
    }

    for (const [status, emails] of grouped) {
      for (let i = 0; i < emails.length; i += BATCH) {
        const batch = emails.slice(i, i + BATCH);
        const emailList = batch.map(e => `'${e.replace(/'/g, "''")}'`).join(',');

        // Count total matches
        const [mc] = await chQuery<{ cnt: string }>(`
          SELECT count() as cnt FROM universal_person
          WHERE lower(business_email) IN (${emailList})
             OR lower(personal_emails) IN (${emailList})
        `);
        const matched = Number(mc?.cnt || 0);
        totalMatched += matched;
        counts[status] = (counts[status] || 0) + matched;

        if (!dryRun && matched > 0) {
          const whereClause = mode === 'unverified_only'
            ? `AND (_verification_status IS NULL OR _verification_status = '' OR _verification_status != '${status}')`
            : `AND (_verification_status IS NULL OR _verification_status != '${status}')`;

          // Count how many would be skipped in unverified_only mode
          if (mode === 'unverified_only') {
            const [skipCount] = await chQuery<{ cnt: string }>(`
              SELECT count() as cnt FROM universal_person
              WHERE (lower(business_email) IN (${emailList})
                 OR lower(personal_emails) IN (${emailList}))
                AND _verification_status IS NOT NULL
                AND _verification_status != ''
                AND _verification_status = '${status}'
            `);
            totalSkippedAlreadyVerified += Number(skipCount?.cnt || 0);
          }

          await chCommand(`
            ALTER TABLE universal_person UPDATE
              _verification_status = '${status}',
              _verified_at = now(),
              _bounced = ${status === 'invalid' ? 1 : 0}
            WHERE (lower(business_email) IN (${emailList})
               OR lower(personal_emails) IN (${emailList}))
              ${whereClause}
          `);
        }
      }
    }

    const summary = {
      totalInJob: allResults.length,
      totalAfterFilters: totalFiltered,
      totalMatchedInDB: totalMatched,
      skippedAlreadyVerified: totalSkippedAlreadyVerified,
      updated: counts,
      dryRun,
      filters: {
        classifications: allowedClassifications,
        maxRiskScore: maxRisk === Infinity ? null : maxRisk,
        mode,
      },
    };

    console.log(`[Ingest] ${dryRun ? 'DRY RUN' : 'Done'}: ${totalMatched}/${totalFiltered} matched. V:${counts.valid || 0} R:${counts.risky || 0} I:${counts.invalid || 0}`);
    res.json(summary);
  } catch (e: any) {
    console.error('[Ingest] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/verify/push-to-db ───
// Push Pipeline Studio results into ClickHouse.
// Maps pipeline classifications to _verification_status.

const PIPELINE_STATUS_MAP: Record<string, string> = {
  safe: 'valid',
  uncertain: 'risky',
  risky: 'risky',
  reject: 'invalid',
};

router.post('/push-to-db', requireSuperadmin, async (req, res) => {
  try {
    const { results } = req.body as {
      results: { email: string; classification: string; riskScore: number }[];
    };

    if (!results || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: 'results array is required' });
    }

    const user = getRequestUser(req);
    console.log(`[Pipeline→DB] User ${user.name} pushing ${results.length} results to ClickHouse`);

    const BATCH_SIZE = 500;
    let totalMatched = 0;
    const statusCounts: Record<string, number> = { valid: 0, risky: 0, invalid: 0 };

    // Group by classification for efficient batch processing
    const grouped = new Map<string, string[]>();
    for (const r of results) {
      const internalStatus = PIPELINE_STATUS_MAP[r.classification] || 'risky';
      if (!grouped.has(internalStatus)) grouped.set(internalStatus, []);
      grouped.get(internalStatus)!.push(r.email.toLowerCase().trim());
    }

    for (const [internalStatus, emails] of grouped) {
      for (let i = 0; i < emails.length; i += BATCH_SIZE) {
        const batch = emails.slice(i, i + BATCH_SIZE);
        const emailList = batch.map(e => `'${e.replace(/'/g, "''")}'`).join(',');

        // Count matches
        const [matchCount] = await chQuery<{ cnt: string }>(`
          SELECT count() as cnt FROM universal_person
          WHERE lower(business_email) IN (${emailList})
             OR lower(personal_emails) IN (${emailList})
        `);
        const matched = Number(matchCount?.cnt || 0);
        totalMatched += matched;
        statusCounts[internalStatus] = (statusCounts[internalStatus] || 0) + matched;

        // Update
        if (matched > 0) {
          const bouncedFlag = internalStatus === 'invalid' ? 1 : 0;
          await chCommand(`
            ALTER TABLE universal_person UPDATE
              _verification_status = '${internalStatus}',
              _verified_at = now(),
              _bounced = ${bouncedFlag}
            WHERE (lower(business_email) IN (${emailList})
               OR lower(personal_emails) IN (${emailList}))
              AND (_verification_status IS NULL
                OR _verification_status != '${internalStatus}')
          `);
        }
      }
    }

    console.log(`[Pipeline→DB] Complete: ${totalMatched} matched out of ${results.length}. V:${statusCounts.valid || 0} R:${statusCounts.risky || 0} I:${statusCounts.invalid || 0}`);
    res.json({
      totalProcessed: results.length,
      matched: totalMatched,
      updated: statusCounts,
    });
  } catch (e: any) {
    console.error('[Pipeline→DB] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
