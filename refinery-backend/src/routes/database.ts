import { Router } from 'express';
import * as dbService from '../services/database.js';

const router = Router();

// GET /api/database/stats
router.get('/stats', async (_req, res) => {
  try {
    const stats = await dbService.getDatabaseStats();
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/database/tables
router.get('/tables', async (_req, res) => {
  try {
    const tables = await dbService.listTables();
    res.json(tables);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/database/query  { sql: "..." }
router.post('/query', async (req, res) => {
  try {
    const { sql } = req.body;
    if (!sql) return res.status(400).json({ error: 'sql is required' });
    const result = await dbService.executeQuery(sql);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/database/health
router.get('/health', async (_req, res) => {
  try {
    const health = await dbService.checkHealth();
    res.json(health);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
