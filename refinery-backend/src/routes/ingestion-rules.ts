import { Router } from 'express';
import * as rules from '../services/ingestion-rules.js';

const router = Router();

// GET /api/ingestion-rules
router.get('/', async (_req, res) => {
  try {
    const list = await rules.listRules();
    res.json(list);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ingestion-rules/:id
router.get('/:id', async (req, res) => {
  try {
    const rule = await rules.getRule(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion-rules
router.post('/', async (req, res) => {
  try {
    const { source_id, label } = req.body;
    if (!source_id || !label) return res.status(400).json({ error: 'source_id and label are required' });
    const id = await rules.createRule(req.body);
    res.json({ id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/ingestion-rules/:id
router.put('/:id', async (req, res) => {
  try {
    await rules.updateRule(req.params.id, req.body);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/ingestion-rules/:id
router.delete('/:id', async (req, res) => {
  try {
    await rules.deleteRule(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion-rules/:id/toggle
router.post('/:id/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    if (enabled === undefined) return res.status(400).json({ error: 'enabled is required' });
    await rules.toggleRule(req.params.id, !!enabled);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion-rules/:id/run
router.post('/:id/run', async (req, res) => {
  try {
    const result = await rules.executeRule(req.params.id);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
