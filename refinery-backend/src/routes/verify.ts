import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import { getRequestUser } from '../types/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { supabaseAdmin } from '../services/supabaseAdmin.js';
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

/** Escape a string for safe interpolation into a ClickHouse single-quoted string literal.
 *  Order matters: backslashes first, then quotes, then null bytes. */
function chEscapeString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\0/g, '');
}

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

    // Store job in ClickHouse (including source emails for retry/resume)
    await insertRows('pipeline_jobs', [{
      id: jobId,
      total_emails: emails.length,
      status: 'processing',
      config_json: JSON.stringify({ checks, smtp, severityWeights, thresholds }),
      source_emails_json: JSON.stringify(emails),
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

        // Store results — pass max_query_size from Server Config (UI-configurable)
        const maxQuerySize = await getConfigInt(CONFIG_KEYS.CH_MAX_QUERY_SIZE);
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
            results_json = '${chEscapeString(JSON.stringify(result.results))}',
            completed_at = now()
          WHERE id = '${jobId}'
        `, { max_query_size: maxQuerySize });

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
// User-scoped job listing:
//   superadmin → all jobs
//   others → own jobs + jobs shared with them

router.get('/jobs', async (req, res) => {
  try {
    const user = getRequestUser(req);
    const authReq = req as any;
    const role = authReq.authUser?.role || 'member';

    // Fetch all recent jobs from ClickHouse
    const allJobs = await chQuery<any>(`
      SELECT id, total_emails, processed_count, safe_count, risky_count, rejected_count,
             uncertain_count, duplicates_removed, typos_fixed, status, error_message,
             started_at, completed_at, performed_by, performed_by_name
      FROM pipeline_jobs
      ORDER BY started_at DESC
      LIMIT 50
    `);

    if (role === 'superadmin') {
      // Superadmins see everything — mark ownership
      const enriched = allJobs.map((j: any) => ({
        ...j,
        _access: j.performed_by === user.id ? 'owner' : 'superadmin',
        _owner_name: j.performed_by_name || 'Unknown',
        _permissions: { can_read: true, can_vault: true, can_download: true },
      }));
      return res.json(enriched);
    }

    // Non-superadmin: filter to own jobs + shared jobs
    // 1. Get job IDs shared with this user (with granular permissions)
    const { data: shares } = await supabaseAdmin
      .from('pipeline_job_shares')
      .select('job_id, permissions')
      .eq('shared_with_id', user.id);

    const sharedJobIds = new Set((shares || []).map(s => s.job_id));
    const sharedPermsMap = new Map((shares || []).map(s => [s.job_id, s.permissions]));

    // 2. Filter: own jobs + shared jobs
    const filtered = allJobs
      .filter((j: any) => j.performed_by === user.id || sharedJobIds.has(j.id))
      .map((j: any) => {
        const isOwner = j.performed_by === user.id;
        const sharePerms = sharedPermsMap.get(j.id) || {};
        return {
          ...j,
          _access: isOwner ? 'owner' : 'shared',
          _owner_name: j.performed_by_name || 'Unknown',
          // Owners get full permissions; shared users get what was granted
          _permissions: isOwner
            ? { can_read: true, can_vault: true, can_download: true }
            : { can_read: sharePerms.can_read ?? true, can_vault: sharePerms.can_vault ?? false, can_download: sharePerms.can_download ?? false },
        };
      });

    res.json(filtered);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/verify/jobs/:id ───
// Get job status and progress. Results only included when ?include=results.
// For 100K+ jobs, results_json can be 100MB+ — never load it unless needed.

router.get('/jobs/:id', async (req, res) => {
  try {
    // Access check: owner, shared, or superadmin
    const user = getRequestUser(req);
    const authReq = req as any;
    const role = authReq.authUser?.role || 'member';
    const access = await canAccessJob(user.id, role, req.params.id);
    if (!access) return res.status(403).json({ error: 'No access to this job' });

    const includeResults = (req.query.include as string)?.includes('results');

    const columns = [
      'id', 'total_emails', 'processed_count', 'safe_count', 'risky_count', 'rejected_count',
      'uncertain_count', 'duplicates_removed', 'typos_fixed', 'status', 'error_message',
      'started_at', 'completed_at',
    ];
    if (includeResults) columns.push('results_json');

    const [job] = await chQuery<any>(`
      SELECT ${columns.join(', ')}
      FROM pipeline_jobs
      WHERE id = '${req.params.id}'
      LIMIT 1
    `);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const response: any = { ...job };

    // Only parse results if explicitly requested
    if (includeResults && job.status === 'complete' && job.results_json) {
      try {
        let allResults = JSON.parse(job.results_json);
        response.totalResults = allResults.length;

        // Server-side pagination — default 500, max 2000
        const limit = Math.min(parseInt(req.query.limit as string) || 500, 2000);
        const offset = parseInt(req.query.offset as string) || 0;

        // Optional classification filter
        const classFilter = req.query.classification as string;
        if (classFilter && classFilter !== 'all') {
          allResults = allResults.filter((r: any) => r.classification === classFilter);
          response.filteredTotal = allResults.length;
        }

        response.results = allResults.slice(offset, offset + limit);
        response.pagination = { limit, offset, total: response.filteredTotal ?? response.totalResults };
      } catch { response.results = []; response.totalResults = 0; }
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
// Query params: ?classifications=safe,uncertain&maxRiskScore=50

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

    let allResults: any[];
    try { allResults = JSON.parse(job.results_json); } catch { return res.status(500).json({ error: 'Corrupt results data' }); }

    // Parse filter query params
    const classificationsParam = req.query.classifications as string | undefined;
    const maxRiskParam = req.query.maxRiskScore as string | undefined;
    const allowedClassifications = classificationsParam ? classificationsParam.split(',') : ['safe', 'uncertain', 'risky', 'reject'];
    const maxRisk = maxRiskParam ? Number(maxRiskParam) : Infinity;

    // Filter results
    const results = allResults.filter((r: any) =>
      allowedClassifications.includes(r.classification) &&
      (r.riskScore ?? 0) <= maxRisk
    );

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

    const filterSuffix = classificationsParam ? `-${allowedClassifications.join('+')}` : '-all';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="verification-${req.params.id}${filterSuffix}.csv"`);
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

// ─── POST /api/verify/jobs/:id/save-to-vault ───
// Save verified results as separate CSV files per classification to MinIO 'verified-leads' bucket.
// Each checked classification becomes its own file: e.g. MyLeads_safe_2026-03-29.csv
// Body: { customName: string, classifications: string[], maxRiskScore?: number }

import { S3Client, CreateBucketCommand, HeadBucketCommand, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { env } from '../config/env.js';
import { Readable } from 'stream';

function getStorageClient(): S3Client {
  return new S3Client({
    region: 'us-east-1',
    endpoint: env.objectStorage.endpoint,
    credentials: {
      accessKeyId: env.objectStorage.accessKey,
      secretAccessKey: env.objectStorage.secretKey,
    },
    forcePathStyle: true,
  });
}

const VERIFIED_BUCKET = 'verified-leads';

/** Build a CSV row from a pipeline result */
function resultToCsvRow(r: any): string {
  const cols = [
    `"${(r.email || '').replace(/"/g, '""')}"`,
    r.classification || '',
    r.riskScore ?? '',
    `"${(r.originalEmail || r.email || '').replace(/"/g, '""')}"`,
    r.checks?.syntax ? (r.checks.syntax.passed ? 'pass' : 'fail') : '',
    r.checks?.typoFixed ? (r.checks.typoFixed.corrected ? 'yes' : 'no') : '',
    r.checks?.disposable == null ? '' : (r.checks.disposable ? 'yes' : 'no'),
    r.checks?.roleBased?.detected ? r.checks.roleBased.prefix : '',
    r.checks?.freeProvider?.detected ? r.checks.freeProvider.category : '',
    r.checks?.mxValid?.valid != null ? (r.checks.mxValid.valid ? 'yes' : 'no') : '',
    r.checks?.catchAll != null ? (r.checks.catchAll ? 'yes' : 'no') : '',
    r.checks?.domainAuth ? (r.checks.domainAuth.spf ? 'yes' : 'no') : '',
    r.checks?.domainAuth ? (r.checks.domainAuth.dmarc ? 'yes' : 'no') : '',
    r.checks?.dnsbl ? (r.checks.dnsbl.listed ? r.checks.dnsbl.listings.join(';') : 'clean') : '',
    r.checks?.domainAge ? (r.checks.domainAge.ageDays >= 0 ? r.checks.domainAge.ageDays : '') : '',
    r.checks?.smtpResult ? r.checks.smtpResult.status : '',
    r.checks?.smtpResult ? `"${(r.checks.smtpResult.response || '').replace(/"/g, '""')}"` : '',
    r.checks?.smtpResult ? (r.checks.smtpResult.starttls ? 'yes' : 'no') : '',
  ];
  return cols.join(',');
}

const CSV_HEADERS = 'email,classification,risk_score,original_email,syntax,typo_fixed,disposable,role_based,free_provider,mx_valid,catch_all,spf,dmarc,dnsbl,domain_age_days,smtp_status,smtp_response,starttls';

async function ensureBucket(client: S3Client): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: VERIFIED_BUCKET }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: VERIFIED_BUCKET }));
  }
}

router.post('/jobs/:id/save-to-vault', requireSuperadmin, async (req, res) => {
  try {
    const [job] = await chQuery<any>(`
      SELECT id, results_json, status, total_emails
      FROM pipeline_jobs
      WHERE id = '${req.params.id}'
      LIMIT 1
    `);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'complete') return res.status(400).json({ error: 'Job not complete yet' });
    if (!job.results_json) return res.status(404).json({ error: 'No results stored' });

    let allResults: any[];
    try { allResults = JSON.parse(job.results_json); } catch { return res.status(500).json({ error: 'Corrupt results data' }); }

    const { customName, classifications, maxRiskScore, emailType, excludeRoleBased, excludeCatchAll } = req.body || {};
    if (!customName || typeof customName !== 'string' || customName.trim().length === 0) {
      return res.status(400).json({ error: 'customName is required' });
    }
    if (!Array.isArray(classifications) || classifications.length === 0) {
      return res.status(400).json({ error: 'Select at least one classification' });
    }

    const maxRisk = typeof maxRiskScore === 'number' ? maxRiskScore : Infinity;
    const eType: 'all' | 'business' | 'free' = emailType || 'all';

    // Apply granular filters to ALL results before classification split
    const preFiltered = allResults.filter((r: any) => {
      // Risk score filter
      if ((r.riskScore ?? 0) > maxRisk) return false;

      // Email type filter (Business vs Free Provider)
      if (eType === 'business' && r.checks?.freeProvider?.detected === true) return false;
      if (eType === 'free' && r.checks?.freeProvider?.detected !== true) return false;

      // Role-based filter
      if (excludeRoleBased && r.checks?.roleBased?.detected === true) return false;

      // Catch-all filter
      if (excludeCatchAll && r.checks?.catchAll === true) return false;

      return true;
    });

    const safeName = customName.trim().replace(/[^a-zA-Z0-9._\- ]/g, '_').replace(/\s+/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    const client = getStorageClient();
    await ensureBucket(client);

    const user = getRequestUser(req);
    const savedFiles: Array<{ classification: string; fileName: string; count: number; sizeBytes: number }> = [];

    // Create one file PER classification
    for (const cls of classifications) {
      const rows = preFiltered.filter((r: any) => r.classification === cls);

      if (rows.length === 0) continue;

      const csvContent = [CSV_HEADERS, ...rows.map(resultToCsvRow)].join('\n');
      const fileName = `${safeName}_${cls}_${timestamp}.csv`;
      const sizeBytes = Buffer.byteLength(csvContent, 'utf-8');

      const upload = new Upload({
        client,
        params: {
          Bucket: VERIFIED_BUCKET,
          Key: fileName,
          Body: Readable.from(Buffer.from(csvContent, 'utf-8')),
          ContentType: 'text/csv',
        },
      });
      await upload.done();

      savedFiles.push({ classification: cls, fileName, count: rows.length, sizeBytes });
    }

    if (savedFiles.length === 0) {
      return res.status(400).json({ error: 'No results match the selected filters — nothing to save' });
    }

    const totalSaved = savedFiles.reduce((sum, f) => sum + f.count, 0);
    console.log(`[Vault] ${user.name} saved ${savedFiles.length} file(s) → ${VERIFIED_BUCKET} (${totalSaved} total leads, classifications: ${savedFiles.map(f => f.classification).join(',')})`);

    res.json({
      success: true,
      files: savedFiles,
      totalSaved,
      totalInJob: allResults.length,
      bucket: VERIFIED_BUCKET,
    });
  } catch (e: any) {
    console.error('[Vault] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/verify/verified-leads ───
// List all files in the verified-leads MinIO bucket.

router.get('/verified-leads', requireSuperadmin, async (_req, res) => {
  try {
    const client = getStorageClient();
    await ensureBucket(client);

    const files: Array<{ key: string; size: number; modified: string }> = [];
    let continuationToken: string | undefined;

    do {
      const resp = await client.send(new ListObjectsV2Command({
        Bucket: VERIFIED_BUCKET,
        MaxKeys: 1000,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      }));

      for (const obj of resp.Contents || []) {
        if (obj.Key) {
          files.push({
            key: obj.Key,
            size: obj.Size || 0,
            modified: obj.LastModified?.toISOString() || '',
          });
        }
      }

      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (continuationToken);

    // Sort newest first
    files.sort((a, b) => b.modified.localeCompare(a.modified));

    res.json({ bucket: VERIFIED_BUCKET, files });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/verify/verified-leads/download?key=xxx ───
// Download a file from the verified-leads bucket.

router.get('/verified-leads/download', requireSuperadmin, async (req, res) => {
  try {
    const key = req.query.key as string;
    if (!key) return res.status(400).json({ error: 'key query param is required' });

    const client = getStorageClient();
    const getResp = await client.send(new GetObjectCommand({
      Bucket: VERIFIED_BUCKET,
      Key: key,
    }));

    const safeName = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    if (getResp.ContentLength) res.setHeader('Content-Length', String(getResp.ContentLength));

    const body = getResp.Body as Readable;
    body.pipe(res);
  } catch (e: any) {
    if (!res.headersSent) {
      res.status(e.name === 'NoSuchKey' ? 404 : 500).json({ error: e.message });
    }
  }
});

// ─── DELETE /api/verify/verified-leads?key=xxx ───
// Delete a file from the verified-leads bucket.

router.delete('/verified-leads', requireSuperadmin, async (req, res) => {
  try {
    const key = req.query.key as string;
    if (!key) return res.status(400).json({ error: 'key query param is required' });

    const client = getStorageClient();
    await client.send(new DeleteObjectCommand({
      Bucket: VERIFIED_BUCKET,
      Key: key,
    }));

    const user = getRequestUser(req);
    console.log(`[Vault] ${user.name} deleted "${key}" from ${VERIFIED_BUCKET}`);
    res.json({ deleted: true, key });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/verify/jobs/clear ───
// Delete all failed and cancelled pipeline jobs from ClickHouse.

router.delete('/jobs/clear', requireSuperadmin, async (req, res) => {
  try {
    // Count first
    const [countResult] = await chQuery<{ cnt: string }>(`
      SELECT count() as cnt FROM pipeline_jobs
      WHERE status IN ('failed', 'cancelled')
    `);
    const count = Number(countResult?.cnt || 0);

    if (count === 0) {
      return res.json({ deleted: 0, message: 'No failed or cancelled jobs to clear' });
    }

    await chCommand(`
      ALTER TABLE pipeline_jobs DELETE
      WHERE status IN ('failed', 'cancelled')
    `);

    const user = getRequestUser(req);
    console.log(`[Pipeline] ${user.name} cleared ${count} failed/cancelled jobs`);
    res.json({ deleted: count });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});



// ─── POST /api/verify/jobs/:id/retry ───
// Retry a failed or cancelled job using stored source emails and config.

router.post('/jobs/:id/retry', requireSuperadmin, async (req, res) => {
  try {
    const [job] = await chQuery<any>(`
      SELECT id, status, source_emails_json, config_json
      FROM pipeline_jobs
      WHERE id = '${req.params.id}'
      LIMIT 1
    `);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!['failed', 'cancelled'].includes(job.status)) {
      return res.status(400).json({ error: `Cannot retry a ${job.status} job — only failed/cancelled jobs can be retried` });
    }
    if (!job.source_emails_json) {
      return res.status(400).json({ error: 'No source emails stored for this job — cannot retry (job was created before retry support was added)' });
    }

    let emails: string[];
    try { emails = JSON.parse(job.source_emails_json); } catch { return res.status(500).json({ error: 'Corrupt source email data' }); }

    let config: any = {};
    try { config = job.config_json ? JSON.parse(job.config_json) : {}; } catch { /* use defaults */ }

    // Check limits
    const maxEmails = await getConfigInt(CONFIG_KEYS.PIPELINE_MAX_EMAILS);
    if (emails.length > maxEmails) {
      return res.status(400).json({ error: `Source has ${emails.length.toLocaleString()} emails, exceeds limit of ${maxEmails.toLocaleString()}` });
    }

    // Create new job
    const newJobId = genId();
    const user = getRequestUser(req);

    await insertRows('pipeline_jobs', [{
      id: newJobId,
      total_emails: emails.length,
      status: 'processing',
      config_json: job.config_json || '{}',
      source_emails_json: job.source_emails_json,
      performed_by: user.id,
      performed_by_name: user.name,
    }]);

    const controller = new AbortController();
    activeJobs.set(newJobId, controller);

    // Run pipeline in background
    (async () => {
      try {
        console.log(`[Pipeline] Retry job ${newJobId} (from ${job.id}): ${emails.length} emails`);

        const result = await runPipeline(
          emails,
          config.checks || {},
          config.smtp || {},
          config.severityWeights || {},
          config.thresholds || {},
          async (processed, total) => {
            try {
              await chCommand(`
                ALTER TABLE pipeline_jobs UPDATE processed_count = ${processed} WHERE id = '${newJobId}'
              `);
            } catch { /* ignore */ }
          },
          controller.signal,
        );

        const retryMaxQuerySize = await getConfigInt(CONFIG_KEYS.CH_MAX_QUERY_SIZE);
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
            results_json = '${chEscapeString(JSON.stringify(result.results))}',
            completed_at = now()
          WHERE id = '${newJobId}'
        `, { max_query_size: retryMaxQuerySize });

        console.log(`[Pipeline] Retry job ${newJobId}: Complete — ${result.safe} safe, ${result.risky} risky, ${result.rejected} rejected`);
      } catch (err: any) {
        if (err instanceof PipelineCancelledError) {
          console.log(`[Pipeline] Retry job ${newJobId}: Cancelled at ${err.processedSoFar} emails`);
          await chCommand(`
            ALTER TABLE pipeline_jobs UPDATE status = 'cancelled',
              error_message = 'Cancelled by user after processing ${err.processedSoFar} emails'
            WHERE id = '${newJobId}'
          `).catch(() => {});
        } else {
          console.error(`[Pipeline] Retry job ${newJobId} failed:`, err.message);
          await chCommand(`
            ALTER TABLE pipeline_jobs UPDATE status = 'failed',
              error_message = '${(err.message || 'Unknown error').replace(/'/g, "\\\\'").substring(0, 500)}'
            WHERE id = '${newJobId}'
          `).catch(() => {});
        }
      } finally {
        activeJobs.delete(newJobId);
      }
    })();

    console.log(`[Pipeline] Retry queued: ${newJobId} from ${job.id} by ${user.name}`);
    res.json({ jobId: newJobId, totalEmails: emails.length, retryOf: job.id });
  } catch (e: any) {
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

// ─── POST /api/verify/jobs/:id/push-to-mta ───
// Push verified results to the active MTA as a subscriber list.
// Provider-agnostic — works with any MTAAdapter (MailWizz, SendGrid, etc.)
// Body: { listName?: string, existingListId?: string, classifications?: string[], maxRiskScore?: number }

import { getMtaAdapter } from '../services/mta/index.js';

router.post('/jobs/:id/push-to-mta', async (req, res) => {
  try {
    const user = getRequestUser(req);
    const authReq = req as any;
    const role = authReq.authUser?.role || 'member';
    const access = await canAccessJob(user.id, role, req.params.id);
    if (!access) return res.status(403).json({ error: 'No access to this job' });

    // Get the MTA adapter (provider-agnostic)
    const adapter = await getMtaAdapter();
    if (!adapter) {
      return res.status(400).json({ error: 'No MTA provider configured. Go to Server Config → MTA Providers to set one up.' });
    }

    // Load job results
    const [job] = await chQuery<any>(`
      SELECT id, results_json, status, total_emails
      FROM pipeline_jobs
      WHERE id = '${req.params.id}'
      LIMIT 1
    `);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'complete') return res.status(400).json({ error: 'Job not complete yet' });
    if (!job.results_json) return res.status(404).json({ error: 'No results stored' });

    let allResults: any[];
    try { allResults = JSON.parse(job.results_json); } catch { return res.status(500).json({ error: 'Corrupt results data' }); }

    const { listName, existingListId, classifications, maxRiskScore } = req.body || {};
    const allowedClassifications = classifications || ['safe', 'uncertain'];
    const maxRisk = typeof maxRiskScore === 'number' ? maxRiskScore : Infinity;

    // Filter results
    const filtered = allResults.filter((r: any) =>
      allowedClassifications.includes(r.classification) &&
      (r.riskScore ?? 0) <= maxRisk
    );

    if (filtered.length === 0) {
      return res.status(400).json({ error: 'No results match the selected filters — nothing to push' });
    }

    // Create or reuse list
    let listId = existingListId;
    let listCreated = false;
    if (!listId) {
      if (!listName || typeof listName !== 'string' || listName.trim().length === 0) {
        return res.status(400).json({ error: 'Provide either listName (new list) or existingListId' });
      }
      const newList = await adapter.createList(listName.trim());
      listId = newList.id;
      listCreated = true;
      console.log(`[MTA Push] Created list "${listName}" → ${listId}`);
    }

    // Build subscribers
    const subscribers = filtered.map((r: any) => ({
      email: r.email,
      first_name: '',
      last_name: '',
    }));

    // Push to MTA
    const result = await adapter.addSubscribers(listId!, subscribers);

    console.log(`[MTA Push] ${user.name} pushed ${result.added} subscribers to list ${listId} (${adapter.provider}). Failed: ${result.failed}`);

    res.json({
      provider: adapter.provider,
      listId,
      listCreated,
      totalFiltered: filtered.length,
      added: result.added,
      failed: result.failed,
      classifications: allowedClassifications,
    });
  } catch (e: any) {
    console.error('[MTA Push] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/verify/mta-lists ───
// Fetch available lists from the active MTA provider.

router.get('/mta-lists', async (_req, res) => {
  try {
    const adapter = await getMtaAdapter();
    if (!adapter) {
      return res.status(400).json({ error: 'No MTA provider configured' });
    }
    const lists = await adapter.getLists();
    res.json({ provider: adapter.provider, lists });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
// ═══════════════════════════════════════════════════════════════
// SHARING — Google Drive-style per-job access control
// ═══════════════════════════════════════════════════════════════



/**
 * Check if a user can access a specific pipeline job.
 * Access granted if: superadmin, job owner, or shared-with.
 */
async function canAccessJob(userId: string, role: string, jobId: string): Promise<'owner' | 'shared' | 'superadmin' | false> {
  if (role === 'superadmin') return 'superadmin';

  // Check ownership (ClickHouse)
  const [job] = await chQuery<{ performed_by: string }>(`
    SELECT performed_by FROM pipeline_jobs WHERE id = '${jobId}' LIMIT 1
  `);
  if (job?.performed_by === userId) return 'owner';

  // Check shares (Supabase)
  const { data: share } = await supabaseAdmin
    .from('pipeline_job_shares')
    .select('id')
    .eq('job_id', jobId)
    .eq('shared_with_id', userId)
    .maybeSingle();
  if (share) return 'shared';

  return false;
}

// ─── GET /api/verify/team ───
// List team members for the share picker (all profiles except current user).

router.get('/team', async (req, res) => {
  try {
    const user = getRequestUser(req);
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, role, avatar_url')
      .neq('id', user.id)
      .order('full_name');

    res.json(profiles || []);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/verify/jobs/:id/shares ───
// List who has access to a specific job.

router.get('/jobs/:id/shares', async (req, res) => {
  try {
    const user = getRequestUser(req);
    const authReq = req as unknown as AuthenticatedRequest;
    const access = await canAccessJob(user.id, authReq.authUser?.role || '', req.params.id);
    if (!access) return res.status(403).json({ error: 'No access to this job' });

    const { data: shares } = await supabaseAdmin
      .from('pipeline_job_shares')
      .select('id, shared_with_id, permissions, created_at, shared_by')
      .eq('job_id', req.params.id)
      .order('created_at');

    if (!shares || shares.length === 0) return res.json([]);

    // Enrich with profile info
    const userIds = [...new Set(shares.map(s => s.shared_with_id))];
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, avatar_url')
      .in('id', userIds);

    const profileMap = new Map((profiles || []).map(p => [p.id, p]));

    const enriched = shares.map(s => ({
      ...s,
      user: profileMap.get(s.shared_with_id) || { id: s.shared_with_id, full_name: 'Unknown', email: '' },
    }));

    res.json(enriched);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/verify/jobs/:id/share ───
// Share a job with one or more users.
// Body: { userIds: string[], permissions?: { can_read: bool, can_vault: bool, can_download: bool } }

router.post('/jobs/:id/share', async (req, res) => {
  try {
    const user = getRequestUser(req);
    const authReq = req as unknown as AuthenticatedRequest;
    const jobId = req.params.id;

    // Only owner or superadmin can share
    const access = await canAccessJob(user.id, authReq.authUser?.role || '', jobId);
    if (access !== 'owner' && access !== 'superadmin') {
      return res.status(403).json({ error: 'Only the job owner or superadmin can share' });
    }

    const { userIds, permissions } = req.body as {
      userIds: string[];
      permissions?: { can_read?: boolean; can_vault?: boolean; can_download?: boolean };
    };
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds array is required' });
    }

    // Default: read-only
    const perms = {
      can_read: permissions?.can_read !== false,
      can_vault: permissions?.can_vault === true,
      can_download: permissions?.can_download === true,
    };

    // Get the owner ID from ClickHouse
    const [job] = await chQuery<{ performed_by: string }>(`
      SELECT performed_by FROM pipeline_jobs WHERE id = '${jobId}' LIMIT 1
    `);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const ownerId = job.performed_by;

    // Upsert shares
    const inserts = userIds
      .filter(uid => uid !== ownerId)
      .map(uid => ({
        job_id: jobId,
        owner_id: ownerId,
        shared_with_id: uid,
        permissions: perms,
        shared_by: user.id,
      }));

    if (inserts.length === 0) {
      return res.json({ shared: 0 });
    }

    const { error } = await supabaseAdmin
      .from('pipeline_job_shares')
      .upsert(inserts, { onConflict: 'job_id,shared_with_id' });

    if (error) throw error;

    console.log(`[Share] ${user.name} shared job ${jobId} with ${inserts.length} user(s) (perms: ${JSON.stringify(perms)})`);
    res.json({ shared: inserts.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/verify/jobs/:id/share/:userId ───
// Revoke a user's access to a job.

router.delete('/jobs/:id/share/:userId', async (req, res) => {
  try {
    const user = getRequestUser(req);
    const authReq = req as unknown as AuthenticatedRequest;
    const jobId = req.params.id;
    const targetUserId = req.params.userId;

    const access = await canAccessJob(user.id, authReq.authUser?.role || '', jobId);
    if (access !== 'owner' && access !== 'superadmin') {
      return res.status(403).json({ error: 'Only the job owner or superadmin can revoke access' });
    }

    const { error } = await supabaseAdmin
      .from('pipeline_job_shares')
      .delete()
      .eq('job_id', jobId)
      .eq('shared_with_id', targetUserId);

    if (error) throw error;

    console.log(`[Share] ${user.name} revoked access for ${targetUserId} on job ${jobId}`);
    res.json({ revoked: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

