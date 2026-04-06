import { Router } from 'express';
import * as configService from '../services/config.js';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import { loadIngestionConfig } from '../services/ingestion.js';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const router = Router();

router.use(requireAuth);

// ── PM2 Runtime Sidecar ──────────────────────────────────────────
// ecosystem.config.cjs reads this file on startup to set Node heap
// size and PM2's max_memory_restart. Writing here + restarting PM2
// is the ONLY way to change memory limits at runtime.
const PM2_RUNTIME_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../pm2-runtime.json',
);

/** Write pm2-runtime.json so ecosystem.config.cjs picks up the new heap size */
async function syncPm2RuntimeConfig(): Promise<void> {
  const heapMb = await configService.getConfigInt('node.heap_size_mb', 12_288);
  const payload = { heapSizeMb: heapMb, updatedAt: new Date().toISOString() };
  await fs.promises.writeFile(PM2_RUNTIME_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`[Config] pm2-runtime.json written: heapSizeMb=${heapMb}`);
}

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

    // Sync PM2 sidecar if heap size was changed (takes effect on next restart)
    if (entries.some((e: any) => e.key === 'node.heap_size_mb')) {
      await syncPm2RuntimeConfig();
    }

    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/config/restart — Superadmin only: restart the PM2 process
// The response is sent BEFORE the restart so the client gets confirmation.
//
// Uses `pm2 delete + start + save` instead of `pm2 restart` to guarantee
// PM2 re-reads ecosystem.config.cjs (including the updated max_memory_restart
// from pm2-runtime.json). A plain `pm2 restart` reuses cached PM2 state
// and ignores changes to the ecosystem file — which is exactly what caused
// the ghost 2GB memory cap.
router.post('/restart', requireSuperadmin, async (req, res) => {
  try {
    const user = (req as any).user;
    const userName = user?.name || user?.email || 'Unknown';
    console.log(`[Server] ⚠ PM2 clean restart requested by ${userName}`);

    // Ensure sidecar is current before restart
    await syncPm2RuntimeConfig();

    // Send response first
    res.json({ ok: true, message: 'Server restart initiated. The page will reconnect automatically.' });

    // Delay 500ms to ensure the HTTP response is flushed, then clean restart
    // delete → start → save ensures PM2 re-reads ecosystem.config.cjs from scratch
    const ecosystemPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../ecosystem.config.cjs',
    );
    setTimeout(() => {
      const cmd = `pm2 delete refinery-api 2>/dev/null; cd ${path.dirname(ecosystemPath)} && pm2 start ecosystem.config.cjs && pm2 save`;
      exec(cmd, (err, stdout, stderr) => {
        if (err) console.error('[Server] PM2 clean restart failed:', stderr);
        else console.log('[Server] PM2 clean restart complete:', stdout.trim());
      });
    }, 500);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
