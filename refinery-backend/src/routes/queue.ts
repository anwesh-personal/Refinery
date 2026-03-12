import { Router } from 'express';
import * as queueService from '../services/queue.js';

const router = Router();

// GET /api/queue/stats
router.get('/stats', async (_req, res) => {
  try {
    const stats = await queueService.getQueueStats();
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/queue/jobs
router.get('/jobs', async (_req, res) => {
  try {
    const jobs = await queueService.listQueueJobs();
    res.json(jobs);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/queue/start  { targetListId }
router.post('/start', async (req, res) => {
  try {
    const { targetListId } = req.body;
    if (!targetListId) return res.status(400).json({ error: 'targetListId is required' });
    const jobId = await queueService.startQueueJob(targetListId);
    res.json({ jobId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/queue/:id/pause
router.post('/:id/pause', async (req, res) => {
  try {
    await queueService.pauseJob(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/queue/:id/resume
router.post('/:id/resume', async (req, res) => {
  try {
    await queueService.resumeJob(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
