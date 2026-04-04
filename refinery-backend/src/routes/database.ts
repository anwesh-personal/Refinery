import { Router } from 'express';
import * as dbService from '../services/database.js';
import { getRequestUser } from '../types/auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

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

// POST /api/database/facets  { search, filters, advancedFilters, facetColumns? }
// Returns top values + counts for key columns within the current filtered result set.
// Powers the drill-down UI — click a value to add it as a filter.
router.post('/facets', async (req, res) => {
  try {
    const { facetColumns, ...browseParams } = req.body;
    const result = await dbService.getFacets(browseParams, facetColumns);
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
    if (!rows.length) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="export-${Date.now()}-empty.csv"`);
      return res.send('No data found\n');
    }
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
    const user = getRequestUser(req);
    console.log(`[Export] Database CSV exported by ${user.name} (${user.id}) \u2014 ${rows.length} rows`);
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
    const user = getRequestUser(req);
    console.log(`[Database] Bulk delete: ${count} rows by ${user.name} (${user.id})`);
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

// POST /api/database/find-replace-preview — count affected rows without executing
router.post('/find-replace-preview', async (req, res) => {
  try {
    const { column, findValue, matchMode = 'exact' } = req.body;
    if (!column || findValue === undefined) {
      return res.status(400).json({ error: 'column and findValue are required' });
    }
    const { query: q } = await import('../db/clickhouse.js');
    const allColumns = await dbService.getTableColumns();
    if (!allColumns.includes(column)) return res.status(400).json({ error: `Invalid column: ${column}` });

    const escFind = findValue.replace(/'/g, "\\'");
    const whereClause = matchMode === 'contains'
      ? `lower(toString(\`${column}\`)) LIKE lower('%${escFind}%')`
      : `\`${column}\` = '${escFind}'`;

    const [{ cnt }] = await q<{ cnt: string }>(`SELECT count() as cnt FROM ${dbService.TABLE_NAME} WHERE ${whereClause}`);
    res.json({ updated: Number(cnt) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/database/find-replace — bulk update values in a column
router.post('/find-replace', async (req, res) => {
  try {
    const { column, findValue, replaceValue, matchMode = 'exact' } = req.body;
    if (!column || findValue === undefined || replaceValue === undefined) {
      return res.status(400).json({ error: 'column, findValue, and replaceValue are required' });
    }
    const { query: q, command: cmd } = await import('../db/clickhouse.js');
    const allColumns = await dbService.getTableColumns();
    if (!allColumns.includes(column)) return res.status(400).json({ error: `Invalid column: ${column}` });

    const escFind = findValue.replace(/'/g, "\\'");
    const escReplace = replaceValue.replace(/'/g, "\\'");

    const whereClause = matchMode === 'contains'
      ? `lower(toString(\`${column}\`)) LIKE lower('%${escFind}%')`
      : `\`${column}\` = '${escFind}'`;

    // Count affected rows
    const [{ cnt }] = await q<{ cnt: string }>(`SELECT count() as cnt FROM ${dbService.TABLE_NAME} WHERE ${whereClause}`);
    const count = Number(cnt);
    if (count === 0) return res.json({ updated: 0 });

    // Execute update
    const updateExpr = matchMode === 'contains'
      ? `replaceAll(\`${column}\`, '${escFind}', '${escReplace}')`
      : `'${escReplace}'`;
    await cmd(`ALTER TABLE ${dbService.TABLE_NAME} UPDATE \`${column}\` = ${updateExpr} WHERE ${whereClause}`);
    const user = getRequestUser(req);
    console.log(`[Database] Find-replace: ${count} rows in '${column}' (${matchMode}) by ${user.name} (${user.id})`);
    res.json({ updated: count, column, from: findValue, to: replaceValue, matchMode });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/database/duplicates — find duplicate values in a column
router.post('/duplicates', async (req, res) => {
  try {
    const { column, limit = 50 } = req.body;
    if (!column) return res.status(400).json({ error: 'column is required' });
    const { query: q } = await import('../db/clickhouse.js');
    const allColumns = await dbService.getTableColumns();
    if (!allColumns.includes(column)) return res.status(400).json({ error: `Invalid column: ${column}` });

    const rows = await q<{ value: string; cnt: string }>(
      `SELECT toString(\`${column}\`) as value, count() as cnt 
       FROM ${dbService.TABLE_NAME} 
       WHERE \`${column}\` IS NOT NULL AND toString(\`${column}\`) != ''
       GROUP BY value HAVING cnt > 1 
       ORDER BY cnt DESC LIMIT ${Math.min(Number(limit), 200)}`
    );
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
