import { Router } from 'express';
import * as segService from '../services/segments.js';
import { validateSegmentFilter } from '../services/segments.js';
import { getRequestUser } from '../types/auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// All segment routes require authentication for proper user attribution
router.use(requireAuth);

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
    const user = getRequestUser(req);
    const id = await segService.createSegment({ name, niche, clientName, filterQuery }, user.id, user.name);
    res.json({ id });
  } catch (e: any) {
    res.status(500).json({ error: e.message, suggestion: (e as any).suggestion });
  }
});

// POST /api/segments/validate  { filterQuery } — live syntax check without saving
router.post('/validate', async (req, res) => {
  try {
    const { filterQuery } = req.body;
    if (!filterQuery) return res.status(400).json({ error: 'filterQuery is required' });
    const result = await validateSegmentFilter(filterQuery);
    res.json(result);
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
    res.status(500).json({ error: e.message, suggestion: (e as any).suggestion });
  }
});

// PUT /api/segments/:id  { name?, niche?, clientName?, filterQuery? }
router.put('/:id', async (req, res) => {
  try {
    const { name, niche, clientName, filterQuery } = req.body;
    await segService.updateSegment(req.params.id, { name, niche, clientName, filterQuery });
    res.json({ ok: true });
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

// GET /api/segments/:id/export
router.get('/:id/export', async (req, res) => {
  try {
    const rows = await segService.exportSegmentLeads(req.params.id);
    const user = getRequestUser(req);
    console.log(`[Export] Segment ${req.params.id} exported by ${user.name} (${user.id}) \u2014 ${rows.length} rows`);
    res.json({ rows, count: rows.length });
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
