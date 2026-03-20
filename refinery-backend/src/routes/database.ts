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

// POST /api/database/browse  { search, filters, page, pageSize, sortBy, sortDir, columns }
router.post('/browse', async (req, res) => {
  try {
    const result = await dbService.browseData(req.body);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/database/filter-options/:column
router.get('/filter-options/:column', async (req, res) => {
  try {
    const options = await dbService.getFilterOptions(req.params.column);
    res.json(options);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/database/filterable-columns
router.get('/filterable-columns', async (_req, res) => {
  try {
    const cols = await dbService.getFilterableColumns();
    res.json(cols);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/database/columns
router.get('/columns', async (_req, res) => {
  try {
    const cols = await dbService.getAvailableColumns();
    res.json(cols);
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

// POST /api/database/export — same params as browse but returns CSV
router.post('/export', async (req, res) => {
  try {
    const result = await dbService.browseData({ ...req.body, page: 1, pageSize: 100000 });
    const rows = result.rows;
    if (!rows.length) return res.status(200).send('');
    const cols = Object.keys(rows[0]);
    const header = cols.join(',');
    const lines = rows.map(row =>
      cols.map(c => {
        const v = row[c];
        if (v === null || v === undefined) return '';
        const s = String(v).replace(/"/g, '""');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
      }).join(',')
    );
    const csv = [header, ...lines].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="export-${Date.now()}.csv"`);
    res.send(csv);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/database/column-stats/:column
router.get('/column-stats/:column', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const stats = await dbService.getColumnStats(req.params.column, limit);
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/database/bulk-delete  { upIds: string[] }
router.post('/bulk-delete', async (req, res) => {
  try {
    const { upIds } = req.body;
    if (!Array.isArray(upIds)) return res.status(400).json({ error: 'upIds must be an array' });
    const count = await dbService.bulkDeleteRows(upIds);
    res.json({ deleted: count });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/database/table-columns/:table
router.get('/table-columns/:table', async (req, res) => {
  try {
    const cols = await dbService.getTableColumnsFor(req.params.table);
    res.json(cols);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
