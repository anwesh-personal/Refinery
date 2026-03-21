import { Router } from 'express';
import { z } from 'zod';
import * as verifyService from '../services/verification.js';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import { getRequestUser } from '../types/auth.js';

const router = Router();

// All verification routes require authentication
router.use(requireAuth);

// ═══════════════════════════════════════════════════════════════
// Verification API Routes — Production
// Supports both Verify550 API and Built-In Native Engine
// ═══════════════════════════════════════════════════════════════

// ─── Zod Schemas ───

const StartBatchSchema = z.object({
  segmentId: z.string().min(1, 'segmentId is required').regex(/^[a-zA-Z0-9_-]+$/, 'segmentId must be alphanumeric'),
  engine: z.enum(['verify550', 'builtin']).default('builtin'),
});

const SaveConfigSchema = z.object({
  // Verify550
  endpoint: z.string().optional(),
  apiKey: z.string().optional(),
  batchSize: z.union([z.string(), z.number()]).optional(),
  concurrency: z.union([z.string(), z.number()]).optional(),
  // Builtin Engine
  builtinHeloDomain: z.string().optional(),
  builtinFromEmail: z.string().optional(),
  builtinConcurrency: z.union([z.string(), z.number()]).optional(),
  builtinTimeout: z.union([z.string(), z.number()]).optional(),
  builtinEnableCatchAll: z.union([z.string(), z.boolean()]).optional(),
  builtinMinInterval: z.union([z.string(), z.number()]).optional(),
  builtinPort: z.union([z.string(), z.number()]).optional(),
  builtinMaxPerDomain: z.union([z.string(), z.number()]).optional(),
}).refine(data => Object.values(data).some(v => v !== undefined), {
  message: 'At least one configuration field must be provided',
});

// ─── Helpers ───

/** Detect if an error is a ClickHouse connection failure (ECONNREFUSED, ETIMEDOUT, etc.) */
function isClickHouseDown(e: any): boolean {
  const msg = String(e?.message || e || '');
  return msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')
    || e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT';
}

// GET /api/verification/stats
// Returns aggregate verification statistics across all leads
router.get('/stats', async (_req, res) => {
  try {
    const stats = await verifyService.getVerificationStats();
    res.json(stats);
  } catch (e: any) {
    if (isClickHouseDown(e)) {
      return res.status(503).json({ error: 'Database unavailable' });
    }
    res.status(500).json({ error: e.message });
  }
});

// GET /api/verification/batches
// Returns recent verification batches
router.get('/batches', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const batches = await verifyService.listBatches(Math.min(limit, 200));
    res.json(batches);
  } catch (e: any) {
    if (isClickHouseDown(e)) {
      return res.status(503).json({ error: 'Database unavailable' });
    }
    res.status(500).json({ error: e.message });
  }
});

// GET /api/verification/batches/:id
// Returns a single batch by ID
router.get('/batches/:id', async (req, res) => {
  try {
    const batch = await verifyService.getBatch(req.params.id);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    res.json(batch);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/verification/start
// Start a new verification batch for a segment
// Body: { segmentId: string, engine?: 'verify550' | 'builtin' }
router.post('/start', requireSuperadmin, async (req, res) => {
  try {
    const parsed = StartBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    }
    const { segmentId, engine } = parsed.data;
    const user = getRequestUser(req);

    const batchId = await verifyService.startBatch(segmentId, engine, user.id, user.name);
    res.json({ batchId, message: 'Verification batch started', engine, startedBy: user.name });
  } catch (e: any) {
    const status = e.message?.includes('not configured') ? 422 : 500;
    res.status(status).json({ error: e.message });
  }
});

// POST /api/verification/cancel/:id
// Cancel a running verification batch
router.post('/cancel/:id', requireSuperadmin, async (req, res) => {
  try {
    await verifyService.cancelBatch(String(req.params.id));
    res.json({ message: 'Batch cancellation requested' });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/verification/test
// Test the Verify550 API connection
router.post('/test', requireSuperadmin, async (_req, res) => {
  try {
    const result = await verifyService.testConnection();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/verification/config
// Save verification configuration (Verify550 + Built-in engine)
// Body: { endpoint?, apiKey?, batchSize?, concurrency?, builtinHeloDomain?, builtinFromEmail?, builtinConcurrency?, builtinTimeout?, builtinEnableCatchAll?, builtinMinInterval?, builtinPort?, builtinMaxPerDomain? }
router.post('/config', requireSuperadmin, async (req, res) => {
  try {
    const parsed = SaveConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    }

    const updated = await verifyService.saveConfig(parsed.data);
    res.json({ message: 'Configuration saved', updated });
  } catch (e: any) {
    if (e.message.includes('No configuration')) {
      return res.status(400).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
});

// GET /api/verification/config
// Get current Verify550 configuration (API key is masked)
router.get('/config', async (_req, res) => {
  try {
    const config = await verifyService.getConfig();
    res.json(config);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/verification/batches/:id/export
// Export batch verification results as CSV
router.get('/batches/:id/export', requireSuperadmin, async (req, res) => {
  try {
    const batchId = String(req.params.id);
    if (!/^[a-zA-Z0-9_-]+$/.test(batchId)) {
      return res.status(400).json({ error: 'Invalid batch ID format' });
    }

    const results = await verifyService.exportBatchResults(batchId);
    const user = getRequestUser(req);
    console.log(`[Export] Verification batch ${batchId} exported by ${user.name} (${user.id}) — ${results.length} rows`);

    // Build CSV
    const header = 'email,status,verified_at\n';
    const rows = results.map(r =>
      `"${r.email.replace(/"/g, '""')}","${r.status}","${r.verified_at}"`
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="verification-${batchId.substring(0, 8)}.csv"`);
    res.send(header + rows);
  } catch (e: any) {
    const status = e.message.includes('not found') ? 404 : e.message.includes('still running') ? 409 : 500;
    res.status(status).json({ error: e.message });
  }
});

export default router;
