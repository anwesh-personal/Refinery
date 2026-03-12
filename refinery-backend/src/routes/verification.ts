import { Router } from 'express';
import * as verifyService from '../services/verification.js';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';

const router = Router();

// All verification routes require authentication
router.use(requireAuth);

// ═══════════════════════════════════════════════════════════════
// Verification API Routes — Production
// Supports both Verify550 API and Built-In Native Engine
// ═══════════════════════════════════════════════════════════════

// GET /api/verification/stats
// Returns aggregate verification statistics across all leads
router.get('/stats', async (_req, res) => {
  try {
    const stats = await verifyService.getVerificationStats();
    res.json(stats);
  } catch (e: any) {
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
    const { segmentId, engine = 'verify550' } = req.body;
    if (!segmentId || typeof segmentId !== 'string') {
      return res.status(400).json({ error: 'segmentId (string) is required' });
    }
    if (engine !== 'verify550' && engine !== 'builtin') {
      return res.status(400).json({ error: "engine must be 'verify550' or 'builtin'" });
    }

    const batchId = await verifyService.startBatch(segmentId, engine);
    res.json({ batchId, message: 'Verification batch started', engine });
  } catch (e: any) {
    // Config errors return 422, everything else 500
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
    const { 
      // Verify550
      endpoint, apiKey, batchSize, concurrency,
      // Builtin Engine
      builtinHeloDomain, builtinFromEmail, builtinConcurrency,
      builtinTimeout, builtinEnableCatchAll, builtinMinInterval,
      builtinPort, builtinMaxPerDomain
    } = req.body;

    const updated = await verifyService.saveConfig({ 
      endpoint, apiKey, batchSize, concurrency,
      builtinHeloDomain, builtinFromEmail, builtinConcurrency,
      builtinTimeout, builtinEnableCatchAll, builtinMinInterval,
      builtinPort, builtinMaxPerDomain
    });
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

export default router;
