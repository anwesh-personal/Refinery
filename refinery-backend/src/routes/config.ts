import { Router } from 'express';
import * as configService from '../services/config.js';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import { loadIngestionConfig } from '../services/ingestion.js';
import { exec } from 'child_process';

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
    const ingestionKeys = [
      'ingestion.max_concurrent', 'ingestion.batch_size',
      'ingestion.max_auto_retries', 'ingestion.insert_timeout_sec', 'ingestion.recovery_delay_sec',
    ];
    if (entries.some((e: any) => ingestionKeys.includes(e.key))) {
      await loadIngestionConfig();
    }

    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/config/restart — Superadmin only: restart the PM2 process
// The response is sent BEFORE the restart so the client gets confirmation.
router.post('/restart', requireSuperadmin, async (req, res) => {
  try {
    const user = (req as any).user;
    const userName = user?.name || user?.email || 'Unknown';
    console.log(`[Server] ⚠ PM2 restart requested by ${userName}`);

    // Send response first
    res.json({ ok: true, message: 'Server restart initiated. The page will reconnect automatically.' });

    // Delay 500ms to ensure the HTTP response is flushed, then restart
    setTimeout(() => {
      exec('pm2 restart refinery-api', (err, _stdout, stderr) => {
        if (err) console.error('[Server] PM2 restart failed:', stderr);
      });
    }, 500);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
