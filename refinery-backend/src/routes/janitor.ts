import { Router } from 'express';
import * as janitor from '../services/janitor.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// GET /api/janitor/columns — available columns for dropdowns
router.get('/columns', async (_req, res) => {
  try {
    const columns = await janitor.getColumns();
    res.json(columns);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/janitor/jobs — ingestion jobs for source filter
router.get('/jobs', async (_req, res) => {
  try {
    const jobs = await janitor.getIngestionJobs();
    res.json(jobs);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/janitor/preview — dry run, returns affected row count + samples
router.post('/preview', async (req, res) => {
  try {
    const result = await janitor.previewCleanup(req.body);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/janitor/execute — actually delete the rows
router.post('/execute', async (req, res) => {
  try {
    const result = await janitor.executeCleanup(req.body);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
