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
  catch_all: z.number().min(0).max(100).optional(),
  role_based: z.number().min(0).max(100).optional(),
  free_provider: z.number().min(0).max(100).optional(),
  typo_detected: z.number().min(0).max(100).optional(),
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

    const header = 'email,classification,risk_score,syntax,disposable,role_based,free_provider,mx_valid,smtp_status,catch_all\n';
    const rows = results.map(r => {
      const cols = [
        `"${r.email.replace(/"/g, '""')}"`,
        r.classification,
        r.riskScore,
        r.checks.syntax ? (r.checks.syntax.passed ? 'pass' : 'fail') : 'skipped',
        r.checks.disposable === null ? 'skipped' : (r.checks.disposable ? 'yes' : 'no'),
        r.checks.roleBased === null ? 'skipped' : (r.checks.roleBased.detected ? r.checks.roleBased.prefix : 'no'),
        r.checks.freeProvider === null ? 'skipped' : (r.checks.freeProvider.detected ? r.checks.freeProvider.category : 'no'),
        r.checks.mxValid === null ? 'skipped' : (r.checks.mxValid.valid ? 'valid' : 'invalid'),
        r.checks.smtpResult === null ? 'skipped' : r.checks.smtpResult.status,
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

export default router;
