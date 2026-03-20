import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import {
  runPipeline,
  DEFAULT_CHECK_CONFIG,
  DEFAULT_SMTP_CONFIG,
  DEFAULT_SEVERITY_WEIGHTS,
  DEFAULT_SEVERITY_THRESHOLDS,
  type PipelineResult,
} from '../services/standaloneVerifier.js';

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
  emails: z.array(z.string()).min(1, 'At least 1 email required').max(50_000, 'Max 50,000 emails per request'),
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

router.get('/defaults', (_req, res) => {
  res.json({
    checks: DEFAULT_CHECK_CONFIG,
    smtp: DEFAULT_SMTP_CONFIG,
    severityWeights: DEFAULT_SEVERITY_WEIGHTS,
    thresholds: DEFAULT_SEVERITY_THRESHOLDS,
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
    const jobId = genId();

    // Store job in ClickHouse
    await insertRows('pipeline_jobs', [{
      id: jobId,
      total_emails: emails.length,
      status: 'processing',
      config_json: JSON.stringify({ checks, smtp, severityWeights, thresholds }),
    }]);

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
          // Progress callback — update ClickHouse periodically
          async (processed, total) => {
            try {
              await chCommand(`
                ALTER TABLE pipeline_jobs UPDATE
                  processed_count = ${processed}
                WHERE id = '${jobId}'
              `);
            } catch { /* ignore progress update failures */ }
          },
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
        console.error(`[Pipeline] Job ${jobId} failed:`, err.message);
        await chCommand(`
          ALTER TABLE pipeline_jobs UPDATE
            status = 'failed',
            error_message = '${(err.message || 'Unknown error').replace(/'/g, "\\'").substring(0, 500)}'
          WHERE id = '${jobId}'
        `).catch(() => { });
      }
    })();

    // Return immediately
    res.json({ jobId, totalEmails: emails.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

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

export default router;
