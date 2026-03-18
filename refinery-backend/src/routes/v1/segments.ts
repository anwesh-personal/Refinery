import { Router } from 'express';
import { requireScope } from '../../middleware/apiKeyAuth.js';
import * as segService from '../../services/segments.js';

// ═══════════════════════════════════════════════════════════════
// v1 Segment Endpoints — API-key authenticated (auth applied in index.ts)
// GET    /api/v1/segments            — list all segments
// GET    /api/v1/segments/:id        — get single segment
// POST   /api/v1/segments            — create a segment
// PUT    /api/v1/segments/:id        — update a segment
// POST   /api/v1/segments/:id/execute — execute (tag contacts)
// GET    /api/v1/segments/:id/contacts — get contacts in segment
// DELETE /api/v1/segments/:id        — delete a segment
// ═══════════════════════════════════════════════════════════════

const router = Router();

// GET /api/v1/segments
router.get('/', requireScope('segments:read'), async (_req, res) => {
  try {
    const segments = await segService.listSegments();
    res.json({ data: segments });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// GET /api/v1/segments/:id
router.get('/:id', requireScope('segments:read'), async (req, res) => {
  try {
    const id = String(req.params.id);
    const seg = await segService.getSegment(id);
    if (!seg) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Segment not found' } });
    }
    res.json({ data: seg });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// POST /api/v1/segments
router.post('/', requireScope('segments:write'), async (req, res) => {
  try {
    const { name, niche, client_name, filter_query } = req.body;

    if (!name || !filter_query) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'name and filter_query are required' },
      });
    }

    const id = await segService.createSegment({
      name,
      niche,
      clientName: client_name,
      filterQuery: filter_query,
    });

    res.status(201).json({ data: { id, name } });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// PUT /api/v1/segments/:id
router.put('/:id', requireScope('segments:write'), async (req, res) => {
  try {
    const id = String(req.params.id);
    const { name, niche, client_name, filter_query } = req.body;

    await segService.updateSegment(id, {
      name,
      niche,
      clientName: client_name,
      filterQuery: filter_query,
    });

    res.json({ data: { updated: true, id } });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// POST /api/v1/segments/:id/execute
router.post('/:id/execute', requireScope('segments:write'), async (req, res) => {
  try {
    const id = String(req.params.id);
    const count = await segService.executeSegment(id);
    res.json({ data: { executed: true, id, contact_count: count } });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// GET /api/v1/segments/:id/contacts
router.get('/:id/contacts', requireScope('segments:read'), async (req, res) => {
  try {
    const id = String(req.params.id);
    const rows = await segService.exportSegmentLeads(id);
    res.json({
      data: rows,
      meta: { count: rows.length, segment_id: id },
    });
  } catch (e: any) {
    if (e.message.includes('not found')) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: e.message } });
    }
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// DELETE /api/v1/segments/:id
router.delete('/:id', requireScope('segments:write'), async (req, res) => {
  try {
    const id = String(req.params.id);
    await segService.deleteSegment(id);
    res.json({ data: { deleted: true, id } });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// POST /api/v1/segments/preview — preview without saving
router.post('/preview', requireScope('segments:read'), async (req, res) => {
  try {
    const { filter_query } = req.body;
    if (!filter_query) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'filter_query is required' },
      });
    }
    const result = await segService.previewSegment(filter_query);
    res.json({ data: result });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

export default router;
