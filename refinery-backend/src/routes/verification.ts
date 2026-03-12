import { Router } from 'express';
import * as verifyService from '../services/verification.js';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';

const router = Router();

// All verification routes require authentication
router.use(requireAuth);

// ═══════════════════════════════════════════════════════════════
// Verify550 API Routes — Production
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
// Body: { segmentId: string }
router.post('/start', requireSuperadmin, async (req, res) => {
  try {
    const { segmentId } = req.body;
    if (!segmentId || typeof segmentId !== 'string') {
      return res.status(400).json({ error: 'segmentId (string) is required' });
    }

    const batchId = await verifyService.startBatch(segmentId);
    res.json({ batchId, message: 'Verification batch started' });
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
// Save Verify550 configuration to system_config
// Body: { endpoint?: string, apiKey?: string, batchSize?: number, concurrency?: number }
router.post('/config', requireSuperadmin, async (req, res) => {
  try {
    const { endpoint, apiKey, batchSize, concurrency } = req.body;
    const updated = await verifyService.saveConfig({ endpoint, apiKey, batchSize, concurrency });
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
