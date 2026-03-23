import { Router } from 'express';
import * as targetService from '../services/targets.js';
import * as audienceSync from '../services/audience-sync.js';
import { getRequestUser } from '../types/auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// All target routes require authentication for proper user attribution
router.use(requireAuth);

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
    const user = getRequestUser(req);
    console.log(`[Export] Target list ${req.params.id} exported by ${user.name} (${user.id}) — ${count} emails`);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="target-list-${req.params.id}.csv"`);
    res.send(csv);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/targets/:id/dedup-check — check overlap with recently pushed lists
router.post('/:id/dedup-check', async (req, res) => {
  try {
    const list = (await targetService.listTargetLists()).find((l: any) => l.id === req.params.id);
    if (!list) return res.status(404).json({ error: 'Target list not found' });
    const days = req.body.days || 7;
    const result = await audienceSync.checkDedupOverlap((list as any).segment_id, req.params.id, days);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/targets/columns — available ClickHouse columns for mapping
router.get('/columns', async (_req, res) => {
  try {
    const columns = await audienceSync.getAvailableColumns();
    res.json(columns);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/targets/:id/preview — preview audience before pushing
router.post('/:id/preview', async (req, res) => {
  try {
    const list = (await targetService.listTargetLists()).find((l: any) => l.id === req.params.id);
    if (!list) return res.status(404).json({ error: 'Target list not found' });

    const { columns, limit, offset, excludeRoleBased, excludeFreeProviders } = req.body;
    const result = await audienceSync.previewAudience(
      (list as any).segment_id,
      columns || [],
      { limit, offset, excludeRoleBased, excludeFreeProviders },
    );
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/targets/:id/push — push audience to MTA
router.post('/:id/push', async (req, res) => {
  try {
    const list = (await targetService.listTargetLists()).find((l: any) => l.id === req.params.id);
    if (!list) return res.status(404).json({ error: 'Target list not found' });

    const { columnMappings, excludeRoleBased, excludeFreeProviders } = req.body;
    if (!columnMappings || !Array.isArray(columnMappings) || columnMappings.length === 0) {
      return res.status(400).json({ error: 'columnMappings[] is required' });
    }

    const user = getRequestUser(req);
    console.log(`[Push] Target ${req.params.id} pushed by ${user.name} (${user.id})`);

    const result = await audienceSync.pushToMTA({
      targetListId: req.params.id,
      listName: (list as any).name,
      segmentId: (list as any).segment_id,
      columnMappings,
      excludeRoleBased,
      excludeFreeProviders,
    });

    res.json(result);
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
