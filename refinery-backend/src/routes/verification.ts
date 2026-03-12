import { Router } from 'express';
import * as verifyService from '../services/verification.js';
import { command, query } from '../db/clickhouse.js';

const router = Router();

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
router.post('/start', async (req, res) => {
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
router.post('/cancel/:id', async (req, res) => {
  try {
    await verifyService.cancelBatch(req.params.id);
    res.json({ message: 'Batch cancellation requested' });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/verification/test
// Test the Verify550 API connection
router.post('/test', async (_req, res) => {
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
router.post('/config', async (req, res) => {
  try {
    const { endpoint, apiKey, batchSize, concurrency } = req.body;
    const configs: { key: string; value: string; isSecret: number }[] = [];

    if (endpoint !== undefined) configs.push({ key: 'verify550_endpoint', value: String(endpoint), isSecret: 0 });
    if (apiKey !== undefined) configs.push({ key: 'verify550_api_key', value: String(apiKey), isSecret: 1 });
    if (batchSize !== undefined) configs.push({ key: 'verify550_batch_size', value: String(Number(batchSize) || 5000), isSecret: 0 });
    if (concurrency !== undefined) configs.push({ key: 'verify550_concurrency', value: String(Number(concurrency) || 3), isSecret: 0 });

    if (configs.length === 0) {
      return res.status(400).json({ error: 'No configuration values provided' });
    }

    // Upsert each config value (ReplacingMergeTree handles dedup)
    for (const cfg of configs) {
      await command(`
        INSERT INTO system_config (config_key, config_value, is_secret, updated_at)
        VALUES ('${cfg.key}', '${cfg.value.replace(/'/g, "''")}', ${cfg.isSecret}, now())
      `);
    }

    res.json({ message: 'Configuration saved', updated: configs.map(c => c.key) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/verification/config
// Get current Verify550 configuration (API key is masked)
router.get('/config', async (_req, res) => {
  try {
    const rows = await query<{ config_key: string; config_value: string; is_secret: number }>(`
      SELECT config_key, config_value, is_secret FROM system_config
      WHERE config_key LIKE 'verify550_%'
      FINAL
    `);

    const config: Record<string, string> = {};
    for (const row of rows) {
      // Mask secret values
      if (Number(row.is_secret) === 1 && row.config_value) {
        config[row.config_key] = row.config_value.slice(0, 8) + '••••••••';
      } else {
        config[row.config_key] = row.config_value;
      }
    }

    res.json(config);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
