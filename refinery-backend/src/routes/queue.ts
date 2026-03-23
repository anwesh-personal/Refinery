import { Router } from 'express';
import * as queueService from '../services/queue.js';
import { getMtaAdapter } from '../services/mta/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

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

// ─── Remote Campaign Management (via MTA Adapter) ───

// GET /api/queue/campaigns — list campaigns from MTA
router.get('/campaigns', async (req, res) => {
  try {
    const adapter = await getMtaAdapter();
    if (!adapter) return res.status(400).json({ error: 'No MTA provider configured' });
    const page = Number(req.query.page) || 1;
    const campaigns = await adapter.getCampaigns(page, 20);
    res.json(campaigns);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/queue/campaign — create a campaign in MTA
router.post('/campaign', async (req, res) => {
  try {
    const adapter = await getMtaAdapter();
    if (!adapter) return res.status(400).json({ error: 'No MTA provider configured' });

    const { name, list_id, subject, from_name, from_email, html_body, plain_text, reply_to } = req.body;
    if (!name || !list_id || !subject || !from_name || !from_email || !html_body) {
      return res.status(400).json({ error: 'name, list_id, subject, from_name, from_email, and html_body are required' });
    }

    const campaign = await adapter.createCampaign({
      name, list_id, subject, from_name, from_email, html_body, plain_text, reply_to,
    });
    res.status(201).json(campaign);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/queue/campaign/:id/send — trigger campaign sending
router.post('/campaign/:id/send', async (req, res) => {
  try {
    const adapter = await getMtaAdapter();
    if (!adapter) return res.status(400).json({ error: 'No MTA provider configured' });
    const result = await adapter.sendCampaign(req.params.id);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/queue/campaign/:id/pause — pause a running campaign
router.post('/campaign/:id/pause', async (req, res) => {
  try {
    const adapter = await getMtaAdapter();
    if (!adapter) return res.status(400).json({ error: 'No MTA provider configured' });
    const result = await adapter.pauseCampaign(req.params.id);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/queue/campaign/:id/stats — live stats from MTA
router.get('/campaign/:id/stats', async (req, res) => {
  try {
    const adapter = await getMtaAdapter();
    if (!adapter) return res.status(400).json({ error: 'No MTA provider configured' });
    const stats = await adapter.getCampaignStats(req.params.id);
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/queue/mta-lists — get lists from the MTA
router.get('/mta-lists', async (_req, res) => {
  try {
    const adapter = await getMtaAdapter();
    if (!adapter) return res.status(400).json({ error: 'No MTA provider configured' });
    const lists = await adapter.getLists();
    res.json(lists);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
