import { Router } from 'express';
import * as ingestionService from '../services/ingestion.js';
import { query as q, command as cmd } from '../db/clickhouse.js';
import { getRequestUser } from '../types/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { esc } from '../utils/sanitize.js';

const router = Router();

// All ingestion routes require authentication for proper user attribution
router.use(requireAuth);

// GET /api/ingestion/stats
router.get('/stats', async (_req, res) => {
  try {
    const stats = await ingestionService.getIngestionStats();
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ingestion/jobs
router.get('/jobs', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 5000);
    const jobs = await ingestionService.getJobs(limit);
    res.json(jobs);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ingestion/source-files?prefix=...
router.get('/source-files', async (req, res) => {
  try {
    const files = await ingestionService.listSourceFiles(req.query.prefix as string, req.query.sourceId as string);
    res.json(files);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/start  { sourceKey: "..." }
router.post('/start', async (req, res) => {
  try {
    const { sourceKey, sourceId } = req.body;
    if (!sourceKey) return res.status(400).json({ error: 'sourceKey is required' });
    const user = getRequestUser(req);
    const jobId = await ingestionService.startIngestionJob(sourceKey, sourceId, user.id, user.name);
    res.json({ jobId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/start-bulk  { sourceKeys: ["..."], sourceId: "..." }
router.post('/start-bulk', async (req, res) => {
  try {
    const { sourceKeys, sourceId } = req.body;
    if (!sourceKeys || !Array.isArray(sourceKeys) || sourceKeys.length === 0) {
      return res.status(400).json({ error: 'sourceKeys array is required' });
    }
    const user = getRequestUser(req);
    const jobIds = await ingestionService.startBulkIngestion(sourceKeys, sourceId, user.id, user.name);
    res.json({ jobIds, count: jobIds.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/test-source
router.post('/test-source', async (_req, res) => {
  try {
    const result = await ingestionService.testSourceConnection();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/test-storage
router.post('/test-storage', async (_req, res) => {
  try {
    const result = await ingestionService.testStorageConnection();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ingestion/preview-file?sourceKey=...&sourceId=...&rows=20
router.get('/preview-file', async (req, res) => {
  try {
    const sourceKey = req.query.sourceKey as string;
    const sourceId = req.query.sourceId as string | undefined;
    const maxRows = Math.min(Number(req.query.rows) || 20, 100);

    if (!sourceKey) return res.status(400).json({ error: 'sourceKey is required' });

    const preview = await ingestionService.previewFile(sourceKey, sourceId, maxRows);
    res.json(preview);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/start-bulk-daterange
router.post('/start-bulk-daterange', async (req, res) => {
  try {
    const { sourceId, prefix, startDate, endDate } = req.body;
    if (!sourceId) return res.status(400).json({ error: 'sourceId is required' });
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    const listing = await ingestionService.listSourceFiles(prefix || '', sourceId);
    const matchingFiles = listing.files.filter(f => {
      if (!f.modified) return false;
      const fileDate = new Date(f.modified);
      return fileDate >= start && fileDate <= end;
    });

    if (matchingFiles.length === 0) {
      return res.json({ jobIds: [], count: 0, message: 'No files found in the specified date range.' });
    }

    const user = getRequestUser(req);
    const jobIds = await ingestionService.startBulkIngestion(
      matchingFiles.map(f => f.key),
      sourceId,
      user.id,
      user.name,
    );

    res.json({ jobIds, count: jobIds.length, filesMatched: matchingFiles.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/clear-jobs  { status: "failed" | "complete" | "all" }
router.post('/clear-jobs', async (req, res) => {
  try {
    const { status } = req.body;
    let condition: string;

    if (status === 'failed') {
      condition = "status = 'failed'";
    } else if (status === 'complete') {
      condition = "status = 'complete'";
    } else if (status === 'cancelled') {
      condition = "status = 'cancelled'";
    } else if (status === 'all') {
      condition = "status IN ('failed', 'complete', 'cancelled')";
    } else {
      return res.status(400).json({ error: 'status must be "failed", "complete", "cancelled", or "all"' });
    }

    const [{ cnt }] = await q<{ cnt: string }>(`SELECT count() as cnt FROM ingestion_jobs WHERE ${condition}`);
    await cmd(`ALTER TABLE ingestion_jobs DELETE WHERE ${condition}`);

    const user = getRequestUser(req);
    console.log(`[Ingestion] Clear jobs (${status}): ${cnt} deleted by ${user.name} (${user.id})`);

    res.json({ deleted: Number(cnt), status });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/cancel-running — mark all in-flight jobs as cancelled
router.post('/cancel-running', async (req, res) => {
  try {
    const [{ cnt }] = await q<{ cnt: string }>(`SELECT count() as cnt FROM ingestion_jobs WHERE status IN ('pending', 'downloading', 'uploading', 'ingesting')`);
    const user = getRequestUser(req);
    await cmd(`ALTER TABLE ingestion_jobs UPDATE status = 'cancelled', error_message = 'Cancelled by ${esc(user.name)}' WHERE status IN ('pending', 'downloading', 'uploading', 'ingesting')`);
    console.log(`[Ingestion] Cancel running: ${cnt} cancelled by ${esc(user.name)} (${user.id})`);
    res.json({ cancelled: Number(cnt) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/:id/rollback — instantly delete all leads from this job
router.post('/:id/rollback', async (req, res) => {
  try {
    const user = getRequestUser(req);
    const result = await ingestionService.rollbackJob(req.params.id, user.id, user.name);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/:id/archive  { days?: number }
router.post('/:id/archive', async (req, res) => {
  try {
    const days = Number(req.body.days) || 7;
    const user = getRequestUser(req);
    const result = await ingestionService.archiveJob(req.params.id, days, user.id, user.name);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ingestion/:id/data — browse rows ingested by this job
router.get('/:id/data', async (req, res) => {
  try {
    const jobId = req.params.id;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 50, 10), 500);
    const search = (req.query.search as string || '').trim();
    const sortBy = req.query.sortBy as string || '';
    const sortDir = (req.query.sortDir === 'desc' ? 'DESC' : 'ASC');
    const offset = (page - 1) * pageSize;

    // Verify job exists
    const [job] = await q<{ id: string; file_name: string; rows_ingested: string }>(`
      SELECT id, file_name, rows_ingested FROM ingestion_jobs WHERE id = '${esc(jobId)}' LIMIT 1
    `);
    if (!job) return res.status(404).json({ error: `Job ${jobId} not found` });

    // Discover columns in this job's data (excluding internal tracking cols)
    const colRows = await q<{ name: string }>(`
      SELECT name FROM system.columns
      WHERE database = currentDatabase() AND table = 'universal_person'
      ORDER BY position
    `);
    const internalCols = new Set(['_ingestion_job_id', '_ingested_at', '_segment_ids', '_verification_status', '_verified_at', '_v550_category', '_bounced', '_source_file_name']);
    const allCols = colRows.map(c => c.name).filter(c => !internalCols.has(c));

    // Build conditions
    const conditions: string[] = [`_ingestion_job_id = '${esc(jobId)}'`];
    if (search) {
      const escaped = search.replace(/'/g, "\\'");
      // Search across first 6 columns for performance
      const searchCols = allCols.slice(0, 6);
      const searchClauses = searchCols.map(c => `lower(coalesce(toString(\`${c}\`), '')) LIKE lower('%${escaped}%')`).join(' OR ');
      conditions.push(`(${searchClauses})`);
    }
    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Sort
    const safeSortBy = (sortBy && allCols.includes(sortBy)) ? `\`${sortBy}\`` : '`_ingested_at`';

    // Count
    const [countResult] = await q<{ cnt: string }>(`SELECT count() as cnt FROM universal_person ${whereClause}`);
    const total = Number(countResult?.cnt || 0);

    // Fetch rows — select all non-internal columns
    const selectCols = allCols.map(c => `\`${c}\``).join(', ');
    const rows = await q(`
      SELECT ${selectCols} FROM universal_person ${whereClause}
      ORDER BY ${safeSortBy} ${sortDir}
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    res.json({
      job: { id: job.id, file_name: job.file_name, rows_ingested: job.rows_ingested },
      columns: allCols,
      rows,
      total,
      page,
      pageSize,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ingestion/:id/export — download all rows from this job as CSV
router.get('/:id/export', async (req, res) => {
  try {
    const jobId = req.params.id;

    const [job] = await q<{ file_name: string }>(`
      SELECT file_name FROM ingestion_jobs WHERE id = '${esc(jobId)}' LIMIT 1
    `);
    if (!job) return res.status(404).json({ error: `Job ${jobId} not found` });

    // Get columns
    const colRows = await q<{ name: string }>(`
      SELECT name FROM system.columns
      WHERE database = currentDatabase() AND table = 'universal_person'
      ORDER BY position
    `);
    const internalCols = new Set(['_ingestion_job_id', '_ingested_at', '_segment_ids', '_verification_status', '_verified_at', '_v550_category', '_bounced', '_source_file_name']);
    const allCols = colRows.map(c => c.name).filter(c => !internalCols.has(c));
    const selectCols = allCols.map(c => `\`${c}\``).join(', ');

    const rows = await q(`
      SELECT ${selectCols} FROM universal_person
      WHERE _ingestion_job_id = '${esc(jobId)}'
      LIMIT 1000000
    `);

    if (!rows.length) return res.status(200).send('');

    const cols = Object.keys(rows[0]);
    const header = cols.join(',');
    const lines = rows.map((row: any) =>
      cols.map(c => {
        const v = row[c];
        if (v === null || v === undefined) return '';
        const s = String(v).replace(/"/g, '""');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
      }).join(',')
    );
    const csv = [header, ...lines].join('\n');

    const user = getRequestUser(req);
    const safeName = job.file_name.replace(/[^a-zA-Z0-9._-]/g, '_');
    console.log(`[Ingestion] Job data exported: ${jobId} (${job.file_name}) — ${rows.length} rows by ${user.name}`);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="job-${safeName}-${Date.now()}.csv"`);
    res.send(csv);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
