import { Router } from 'express';
import * as targetService from '../services/targets.js';

const router = Router();

// GET /api/targets/stats
router.get('/stats', async (_req, res) => {
  try {
    const stats = await targetService.getTargetStats();
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/targets
router.get('/', async (_req, res) => {
  try {
    const lists = await targetService.listTargetLists();
    res.json(lists);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/targets  { name, segmentId, exportFormat? }
router.post('/', async (req, res) => {
  try {
    const { name, segmentId, exportFormat } = req.body;
    if (!name || !segmentId) return res.status(400).json({ error: 'name and segmentId are required' });
    const id = await targetService.createTargetList({ name, segmentId, exportFormat });
    res.json({ id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/targets/:id/export
router.get('/:id/export', async (req, res) => {
  try {
    const { csv, count } = await targetService.exportTargetList(req.params.id);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="target-list-${req.params.id}.csv"`);
    res.send(csv);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/targets/:id
router.delete('/:id', async (req, res) => {
  try {
    await targetService.deleteTargetList(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
