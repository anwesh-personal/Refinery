import { Router } from 'express';
import * as segService from '../services/segments.js';

const router = Router();

// GET /api/segments
router.get('/', async (_req, res) => {
  try {
    const segments = await segService.listSegments();
    res.json(segments);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/segments/:id
router.get('/:id', async (req, res) => {
  try {
    const seg = await segService.getSegment(req.params.id);
    if (!seg) return res.status(404).json({ error: 'Segment not found' });
    res.json(seg);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/segments  { name, niche?, clientName?, filterQuery }
router.post('/', async (req, res) => {
  try {
    const { name, niche, clientName, filterQuery } = req.body;
    if (!name || !filterQuery) return res.status(400).json({ error: 'name and filterQuery are required' });
    const id = await segService.createSegment({ name, niche, clientName, filterQuery });
    res.json({ id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/segments/preview  { filterQuery }
router.post('/preview', async (req, res) => {
  try {
    const { filterQuery } = req.body;
    if (!filterQuery) return res.status(400).json({ error: 'filterQuery is required' });
    const result = await segService.previewSegment(filterQuery);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/segments/:id/execute
router.post('/:id/execute', async (req, res) => {
  try {
    const count = await segService.executeSegment(req.params.id);
    res.json({ count });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/segments/:id
router.delete('/:id', async (req, res) => {
  try {
    await segService.deleteSegment(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
