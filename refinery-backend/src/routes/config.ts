import { Router } from 'express';
import * as configService from '../services/config.js';
import { requireAuth } from '../middleware/auth.js';
import { loadIngestionConfig } from '../services/ingestion.js';

const router = Router();

router.use(requireAuth);

// GET /api/config
router.get('/', async (_req, res) => {
  try {
    const config = await configService.getAllConfig();
    res.json(config);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/config  { entries: [{ key, value, isSecret? }] }
router.post('/', async (req, res) => {
  try {
    const { entries } = req.body;
    if (!entries || !Array.isArray(entries)) return res.status(400).json({ error: 'entries array is required' });
    await configService.saveConfigBatch(entries);

    // Reload ingestion config if any ingestion keys were changed
    const ingestionKeys = ['ingestion.max_concurrent', 'ingestion.batch_size'];
    if (entries.some((e: any) => ingestionKeys.includes(e.key))) {
      await loadIngestionConfig();
    }

    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
