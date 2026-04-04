import { Router } from 'express';
import * as ingestionService from '../services/ingestion.js';
import { query as q, command as cmd, streamCSV } from '../db/clickhouse.js';
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

// GET /api/ingestion/sources — returns completed ingestion jobs for the Data Source dropdown
// Used by the Data Explorer to let users scope searches to a specific ingested file
router.get('/sources', async (_req, res) => {
  try {
    const jobs = await q<{
      id: string; file_name: string; rows_ingested: string; completed_at: string;
    }>(`
      SELECT id, file_name, rows_ingested, completed_at
      FROM ingestion_jobs
      WHERE status = 'complete' AND rows_ingested > 0
      ORDER BY completed_at DESC
      LIMIT 200
    `);
    const sources = jobs.map(j => ({
      id: j.id,
      label: `${j.file_name.replace(/\.[^/.]+$/, '').slice(0, 40)} (${Number(j.rows_ingested).toLocaleString()} rows, ${new Date(j.completed_at).toLocaleDateString()})`,
    }));
    res.json(sources);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/check-duplicates  { sourceKeys: ["..."] }
router.post('/check-duplicates', async (req, res) => {
  try {
    const { sourceKeys } = req.body;
    if (!sourceKeys || !Array.isArray(sourceKeys)) return res.status(400).json({ error: 'sourceKeys array is required' });
    const duplicates = await ingestionService.checkDuplicates(sourceKeys);
    res.json({ duplicates, hasDuplicates: duplicates.length > 0 });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/file-statuses  { sourceKeys: ["..."] }
router.post('/file-statuses', async (req, res) => {
  try {
    const { sourceKeys } = req.body;
    if (!sourceKeys || !Array.isArray(sourceKeys)) return res.status(400).json({ error: 'sourceKeys array is required' });
    const statuses = await ingestionService.getFileStatuses(sourceKeys);
    res.json({ statuses });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/start  { sourceKey, sourceId?, force? }
router.post('/start', async (req, res) => {
  try {
    const { sourceKey, sourceId, force } = req.body;
    if (!sourceKey) return res.status(400).json({ error: 'sourceKey is required' });
    const user = getRequestUser(req);
    const jobId = await ingestionService.startIngestionJob(sourceKey, sourceId, user.id, user.name, !!force);
    res.json({ jobId });
  } catch (e: any) {
    if (e.code === 'DUPLICATE_INGESTION') {
      return res.status(409).json({ error: e.message, code: e.code, duplicate: e.duplicate });
    }
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/start-bulk  { sourceKeys, sourceId?, force? }
router.post('/start-bulk', async (req, res) => {
  try {
    const { sourceKeys, sourceId, force } = req.body;
    if (!sourceKeys || !Array.isArray(sourceKeys) || sourceKeys.length === 0) {
      return res.status(400).json({ error: 'sourceKeys array is required' });
    }
    const user = getRequestUser(req);
    const result = await ingestionService.startBulkIngestion(sourceKeys, sourceId, user.id, user.name, !!force);
    res.json({ jobIds: result.jobIds, count: result.jobIds.length, skipped: result.skipped });
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
    const { sourceId, prefix, startDate, endDate, force } = req.body;
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
      return res.json({ jobIds: [], count: 0, skipped: [], message: 'No files found in the specified date range.' });
    }

    const user = getRequestUser(req);
    const result = await ingestionService.startBulkIngestion(
      matchingFiles.map(f => f.key),
      sourceId,
      user.id,
      user.name,
      !!force,
    );

    res.json({ jobIds: result.jobIds, count: result.jobIds.length, skipped: result.skipped, filesMatched: matchingFiles.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/clear-jobs  { status: "failed" | "complete" | "cancelled" | "rolled_back" | "all" }
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
    } else if (status === 'rolled_back') {
      condition = "status = 'rolled_back'";
    } else if (status === 'all') {
      condition = "status IN ('failed', 'complete', 'cancelled', 'rolled_back')";
    } else {
      return res.status(400).json({ error: 'status must be "failed", "complete", "cancelled", "rolled_back", or "all"' });
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

// POST /api/ingestion/cancel-running â€” mark all in-flight jobs as cancelled
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

// POST /api/ingestion/:id/rollback â€” instantly delete all leads from this job

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

// POST /api/ingestion/:id/retry — reset a failed job and re-run it in-place
router.post('/:id/retry', async (req, res) => {
  try {
    const user = getRequestUser(req);
    const jobId = req.params.id;

    // Look up the original job
    const [job] = await q<{ source_key: string; source_bucket: string; status: string; rows_ingested: string }>(
      `SELECT source_key, source_bucket, status, rows_ingested FROM ingestion_jobs WHERE id = '${esc(jobId)}' LIMIT 1`
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!['failed', 'cancelled', 'rolled_back'].includes(job.status)) {
      return res.status(400).json({ error: `Cannot retry a job with status '${job.status}'. Only failed, cancelled, or rolled-back jobs can be retried.` });
    }

    // 1. Delete any partial rows from the failed attempt to prevent duplicates
    const partialRows = Number(job.rows_ingested) || 0;
    if (partialRows > 0) {
      await cmd(`ALTER TABLE universal_person DELETE WHERE _ingestion_job_id = '${esc(jobId)}'`);
      console.log(`[Ingestion] Retry ${jobId}: cleaned ${partialRows} partial rows before retry`);
    }

    // 2. Reset the job record in-place (started_at is a key column — cannot be updated)
    await cmd(`
      ALTER TABLE ingestion_jobs UPDATE 
        status = 'pending', 
        error_message = NULL, 
        rows_ingested = 0,
        performed_by = '${esc(user.id)}',
        performed_by_name = '${esc(user.name)}'
      WHERE id = '${esc(jobId)}'
    `);

    // 3. Find matching S3 source and re-queue the pipeline
    const [source] = await q<{ id: string }>(`SELECT id FROM s3_sources WHERE bucket = '${esc(job.source_bucket)}' AND is_active = 1 LIMIT 1`);
    
    // Re-run the pipeline using the existing job ID
    await ingestionService.retryIngestionJob(jobId, job.source_key, source?.id);

    console.log(`[Ingestion] Retry ${jobId}: re-queued by ${user.name}`);
    res.json({ ok: true, jobId, cleaned: partialRows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ingestion/:id/data — browse rows ingested by this job
router.get('/:id/data', async (req, res) => {
  try {
    const jobId = req.params.id;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 50, 10), 1000);
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

    // Fetch rows â€” select all non-internal columns
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

// GET /api/ingestion/:id/export — download all rows from this job as streaming CSV
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

    const exportLimit = Number(req.query.limit) || 0; // 0 = unlimited

    const sql = `
      SELECT ${selectCols} FROM universal_person
      WHERE _ingestion_job_id = '${esc(jobId)}'
      ${exportLimit > 0 ? `LIMIT ${exportLimit}` : ''}
    `;

    const user = getRequestUser(req);
    const safeName = job.file_name.replace(/[^a-zA-Z0-9._-]/g, '_');
    console.log(`[Ingestion] Streaming export job=${jobId} (${job.file_name}) by ${user.name}`);

    // Stream CSV directly from ClickHouse — zero Node.js memory usage
    const stream = await streamCSV(sql);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="job-${safeName}-${Date.now()}.csv"`);
    res.setHeader('Transfer-Encoding', 'chunked');

    let hasData = false;
    for await (const rows of stream) {
      for (const row of rows) {
        hasData = true;
        res.write(row.text);
        res.write('\n');
      }
    }

    if (!hasData) {
      res.write('No data found\n');
    }

    res.end();
    console.log(`[Ingestion] Streaming export complete for job=${jobId}`);
  } catch (e: any) {
    if (res.headersSent) {
      console.error(`[Ingestion] Streaming export error (headers sent): ${e.message}`);
      res.end();
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

// ────────────────── Helper: determine if a ClickHouse type is string-like
function isStringType(chType: string): boolean {
  const t = chType.replace(/^Nullable\(/, '').replace(/\)$/, '').replace(/^LowCardinality\(/, '').replace(/\)$/, '');
  return t.startsWith('String') || t.startsWith('FixedString') || t === 'UUID';
}

// Helper: build a type-aware "non-empty" condition for a column
function nonEmptyCondition(colName: string, chType: string): string {
  const escaped = `\`${colName}\``;
  if (isStringType(chType)) {
    return `${escaped} != ''`;
  }
  if (chType.startsWith('Nullable(')) {
    return `${escaped} IS NOT NULL`;
  }
  // Non-nullable numeric types: treat 0 as empty
  return `${escaped} != 0`;
}

// Helper: build a type-aware anyIf expression for merging
function anyIfExpr(colName: string, chType: string): string {
  const escaped = `\`${colName}\``;
  const cond = nonEmptyCondition(colName, chType);
  return `anyIf(${escaped}, ${cond}) as ${escaped}`;
}

/**
 * Priority-aware merge expression.
 * If priorityJobIds is provided, generates a COALESCE chain:
 *   COALESCE(anyIf(col, cond AND job='first'), anyIf(col, cond AND job='second'), ..., anyIf(col, cond))
 * First file in the priority list wins when multiple files have non-empty values for the same key.
 * Falls back to simple anyIf when no priority is set.
 */
function prioritizedMergeExpr(colName: string, chType: string, priorityJobIds?: string[]): string {
  if (!priorityJobIds || priorityJobIds.length === 0) {
    return anyIfExpr(colName, chType);
  }
  const escaped = `\`${colName}\``;
  const cond = nonEmptyCondition(colName, chType);
  const parts = priorityJobIds.map(jid =>
    `anyIf(${escaped}, ${cond} AND _ingestion_job_id = '${esc(jid)}')`
  );
  // Fallback: any non-empty value from any source (covers edge cases)
  parts.push(`anyIf(${escaped}, ${cond})`);
  return `COALESCE(${parts.join(', ')}) as ${escaped}`;
}

// ═══════════════════════════════════════════════════════════════
// MERGE PLAYGROUND — Selective multi-file consolidation system
// ═══════════════════════════════════════════════════════════════

const INTERNAL_COLS = new Set([
  '_ingestion_job_id', '_ingested_at', '_segment_ids',
  '_verification_status', '_verified_at', '_v550_category',
  '_bounced', '_source_file_name',
]);



/** Get non-internal data columns from universal_person */
async function getDataColumns(): Promise<{ name: string; type: string }[]> {
  const colRows = await q<{ name: string; type: string }>(`
    SELECT name, type FROM system.columns
    WHERE database = currentDatabase() AND table = 'universal_person'
    ORDER BY position
  `);
  return colRows.filter(c => !INTERNAL_COLS.has(c.name));
}

// GET /api/ingestion/merge/sources — list completed jobs with column schemas
router.get('/merge/sources', async (_req, res) => {
  try {
    const jobs = await q<{
      id: string; file_name: string; rows_ingested: string;
      completed_at: string; source_key: string;
    }>(`
      SELECT id, file_name, rows_ingested, completed_at, source_key
      FROM ingestion_jobs WHERE status = 'complete'
      ORDER BY completed_at DESC
    `);
    if (jobs.length === 0) return res.json({ sources: [] });

    const dataCols = await getDataColumns();
    const sources = await Promise.all(jobs.map(async (job) => {
      const checkParts = dataCols.map(col => {
        const cond = nonEmptyCondition(col.name, col.type);
        return `countIf(${cond}) as \`_f_${col.name}\``;
      });
      const [fillResult] = await q<Record<string, string>>(`
        SELECT ${checkParts.join(', ')} FROM universal_person
        WHERE _ingestion_job_id = '${esc(job.id)}'
      `);
      const populatedColumns = dataCols
        .filter(col => Number(fillResult?.[`_f_${col.name}`] || 0) > 0)
        .map(col => col.name);
      return {
        jobId: job.id, fileName: job.file_name, sourceKey: job.source_key,
        rowCount: Number(job.rows_ingested), completedAt: job.completed_at,
        columns: populatedColumns, columnCount: populatedColumns.length,
      };
    }));
    res.json({ sources, allColumns: dataCols.map(c => c.name) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ingestion/merge/common-keys?jobIds=id1,id2,id3
router.get('/merge/common-keys', async (req, res) => {
  try {
    const jobIdsRaw = (req.query.jobIds as string || '').split(',').filter(Boolean);
    if (jobIdsRaw.length < 2) return res.status(400).json({ error: 'At least 2 jobIds required' });
    const jobIdsSafe = jobIdsRaw.map(id => esc(id.trim()));
    const jobIdsSQL = jobIdsSafe.map(id => `'${id}'`).join(',');

    const jobMeta = await q<{ id: string; file_name: string }>(`
      SELECT id, file_name FROM ingestion_jobs WHERE id IN (${jobIdsSQL})
    `);
    const jobNameMap = new Map(jobMeta.map(j => [j.id, j.file_name]));
    const dataCols = await getDataColumns();
    const candidates: { column: string; type: string; filesPresent: number; totalFiles: number; perFile: { jobId: string; fileName: string; uniqueValues: number; fillRate: number }[]; overlapCount: number; overlapRate: number; recommendation: string }[] = [];

    for (const col of dataCols) {
      const cond = nonEmptyCondition(col.name, col.type);
      const perJobStats = await q<{
        job_id: string; unique_vals: string; total_rows: string; filled_rows: string;
      }>(`
        SELECT _ingestion_job_id as job_id,
          countDistinct(if(${cond}, toString(\`${col.name}\`), NULL)) as unique_vals,
          count() as total_rows, countIf(${cond}) as filled_rows
        FROM universal_person WHERE _ingestion_job_id IN (${jobIdsSQL})
        GROUP BY _ingestion_job_id
      `);
      const jobsWithData = perJobStats.filter(s => Number(s.unique_vals) > 0);
      if (jobsWithData.length < 2) continue;

      const [overlapRow] = await q<{ overlap_count: string }>(`
        SELECT count() as overlap_count FROM (
          SELECT toString(\`${col.name}\`) as val FROM universal_person
          WHERE _ingestion_job_id IN (${jobIdsSQL}) AND ${cond}
          GROUP BY val HAVING countDistinct(_ingestion_job_id) >= 2
        )
      `);
      const overlapCount = Number(overlapRow?.overlap_count || 0);
      const maxUnique = Math.max(...jobsWithData.map(s => Number(s.unique_vals)));
      const overlapRate = maxUnique > 0 ? Math.round(overlapCount / maxUnique * 1000) / 10 : 0;

      candidates.push({
        column: col.name, type: col.type,
        filesPresent: jobsWithData.length, totalFiles: jobIdsSafe.length,
        perFile: jobsWithData.map(s => ({
          jobId: s.job_id, fileName: jobNameMap.get(s.job_id) || s.job_id,
          uniqueValues: Number(s.unique_vals),
          fillRate: Number(s.total_rows) > 0 ? Math.round(Number(s.filled_rows) / Number(s.total_rows) * 1000) / 10 : 0,
        })),
        overlapCount, overlapRate,
        recommendation: overlapRate >= 70 ? 'excellent' : overlapRate >= 30 ? 'good' : 'poor',
      });
    }
    candidates.sort((a, b) => {
      const order: Record<string, number> = { excellent: 0, good: 1, poor: 2 };
      if (order[a.recommendation] !== order[b.recommendation]) return order[a.recommendation] - order[b.recommendation];
      return b.overlapRate - a.overlapRate;
    });
    res.json({ candidates, totalFiles: jobIdsSafe.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ingestion/merge/preview-selective
router.get('/merge/preview-selective', async (req, res) => {
  try {
    const jobIdsRaw = (req.query.jobIds as string || '').split(',').filter(Boolean);
    const mergeKey = req.query.key as string;
    const excludeColsRaw = (req.query.excludeCols as string || '').split(',').filter(Boolean);
    if (jobIdsRaw.length < 2) return res.status(400).json({ error: 'At least 2 jobIds required' });
    if (!mergeKey) return res.status(400).json({ error: 'key parameter required' });

    const jobIdsSQL = jobIdsRaw.map(id => `'${esc(id.trim())}'`).join(',');
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 50, 10), 1000);
    const search = (req.query.search as string || '').trim();
    const sortBy = req.query.sortBy as string || '';
    const sortDir = req.query.sortDir === 'desc' ? 'DESC' : 'ASC';
    const offset = (page - 1) * pageSize;

    const dataCols = await getDataColumns();
    const allCols = dataCols.map(c => c.name);
    const colTypeMap = new Map(dataCols.map(c => [c.name, c.type]));
    if (!allCols.includes(mergeKey)) return res.status(400).json({ error: `Column '${mergeKey}' not found` });

    const excludeSet = new Set(excludeColsRaw);
    const activeCols = dataCols.filter(c => !excludeSet.has(c.name));
    const mergeKeyType = colTypeMap.get(mergeKey) || 'String';
    const mergeKeyCond = nonEmptyCondition(mergeKey, mergeKeyType);
    const jobFilter = `_ingestion_job_id IN (${jobIdsSQL})`;

    // Parse priority order: comma-separated job IDs, first = highest priority
    const priorityRaw = (req.query.priority as string || '').split(',').filter(Boolean);
    const priorityJobIds = priorityRaw.length > 0 ? priorityRaw.map(id => id.trim()) : undefined;

    const selectParts = activeCols.map(col =>
      col.name === mergeKey ? `\`${col.name}\`` : prioritizedMergeExpr(col.name, col.type, priorityJobIds)
    );

    const baseQuery = `
      SELECT ${selectParts.join(', ')} FROM universal_person
      WHERE ${jobFilter} AND ${mergeKeyCond}
      GROUP BY \`${mergeKey}\`
    `;

    let wrappedQuery = baseQuery;
    if (search) {
      const escaped = esc(search);
      const searchCols = activeCols.slice(0, 6).map(c => c.name);
      const clauses = searchCols.map(c => `lower(toString(\`${c}\`)) LIKE lower('%${escaped}%')`).join(' OR ');
      wrappedQuery = `SELECT * FROM (${baseQuery}) WHERE ${clauses}`;
    }

    const [countResult] = await q<{ cnt: string }>(`SELECT count() as cnt FROM (${wrappedQuery})`);
    const total = Number(countResult?.cnt || 0);
    const [beforeCount] = await q<{ cnt: string }>(`SELECT count() as cnt FROM universal_person WHERE ${jobFilter} AND ${mergeKeyCond}`);
    const totalBefore = Number(beforeCount?.cnt || 0);
    const [orphanCount] = await q<{ cnt: string }>(`SELECT count() as cnt FROM universal_person WHERE ${jobFilter} AND NOT (${mergeKeyCond})`);
    const orphanRows = Number(orphanCount?.cnt || 0);

    const safeSortBy = (sortBy && allCols.includes(sortBy)) ? `\`${sortBy}\`` : `\`${mergeKey}\``;
    const rows = await q(`
      SELECT * FROM (${wrappedQuery})
      ORDER BY ${safeSortBy} ${sortDir}
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    res.json({
      columns: activeCols.map(c => c.name), mergeKey, rows, total, totalBefore, orphanRows,
      reduction: totalBefore > 0 ? Math.round((1 - total / totalBefore) * 100) : 0,
      page, pageSize,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ingestion/merge/conflict-sample
// Analyzes overlapping keys to find column-level value conflicts across files.
// Returns samples showing what each file has and who wins based on priority.
// This data feeds both the visual conflict preview and future AI analysis.
router.get('/merge/conflict-sample', async (req, res) => {
  try {
    const jobIdsRaw = (req.query.jobIds as string || '').split(',').filter(Boolean);
    const mergeKey = req.query.key as string;
    const priorityRaw = (req.query.priority as string || '').split(',').filter(Boolean);
    if (jobIdsRaw.length < 2 || !mergeKey) return res.status(400).json({ error: 'jobIds and key required' });

    const jobIdsSQL = jobIdsRaw.map(id => `'${esc(id.trim())}'`).join(',');
    const dataCols = await getDataColumns();
    const mergeKeyType = dataCols.find(c => c.name === mergeKey)?.type || 'String';
    const mergeKeyCond = nonEmptyCondition(mergeKey, mergeKeyType);

    // 1. Find keys present in 2+ files (these are the merge candidates with potential conflicts)
    const sharedKeys = await q<{ kv: string }>(`
      SELECT \`${esc(mergeKey)}\` as kv FROM universal_person
      WHERE _ingestion_job_id IN (${jobIdsSQL}) AND ${mergeKeyCond}
      GROUP BY kv HAVING countDistinct(_ingestion_job_id) > 1
      LIMIT 50
    `);

    if (!sharedKeys.length) return res.json({ totalConflictKeys: 0, totalConflictCells: 0, samples: [] });

    // 2. Fetch per-file raw values for those shared keys
    const keyVals = sharedKeys.map(k => `'${esc(String(k.kv))}'`).join(',');
    const nonInternalCols = dataCols.filter(c => !INTERNAL_COLS.has(c.name)).map(c => c.name);
    const selectCols = [...nonInternalCols.map(c => `\`${c}\``), '_ingestion_job_id'].join(', ');

    const rawRows = await q<Record<string, any>>(`
      SELECT ${selectCols} FROM universal_person
      WHERE \`${esc(mergeKey)}\` IN (${keyVals}) AND _ingestion_job_id IN (${jobIdsSQL})
      ORDER BY \`${esc(mergeKey)}\`, _ingestion_job_id
    `);

    // 3. Group by key value
    const grouped = new Map<string, Record<string, any>[]>();
    for (const row of rawRows) {
      const kv = String(row[mergeKey] ?? '');
      if (!grouped.has(kv)) grouped.set(kv, []);
      grouped.get(kv)!.push(row);
    }

    // 4. Detect column-level conflicts and resolve with priority
    const priority = priorityRaw.length > 0 ? priorityRaw : jobIdsRaw;
    let totalConflictKeys = 0;
    let totalConflictCells = 0;
    const samples: any[] = [];

    for (const [keyValue, rows] of grouped) {
      const conflicts: any[] = [];

      for (const col of nonInternalCols) {
        if (col === mergeKey) continue;

        // Collect non-empty values per file
        const nonEmptyVals = new Map<string, string>();
        for (const row of rows) {
          const val = row[col] != null ? String(row[col]) : '';
          if (val) nonEmptyVals.set(row._ingestion_job_id, val);
        }

        // Only a conflict if 2+ files have DIFFERENT non-empty values
        if (nonEmptyVals.size < 2) continue;
        const uniqueVals = new Set(nonEmptyVals.values());
        if (uniqueVals.size < 2) continue;

        totalConflictCells++;

        // Resolve: first file in priority order with a non-empty value wins
        let resolvedValue = '', resolvedFromJobId = '';
        for (const jid of priority) {
          if (nonEmptyVals.has(jid)) {
            resolvedValue = nonEmptyVals.get(jid)!;
            resolvedFromJobId = jid;
            break;
          }
        }

        conflicts.push({
          column: col,
          perFile: Array.from(nonEmptyVals.entries()).map(([jid, val]) => ({ jobId: jid, value: val })),
          resolvedValue,
          resolvedFromJobId,
        });
      }

      if (conflicts.length > 0) {
        totalConflictKeys++;
        if (samples.length < 10) samples.push({ keyValue, conflicts });
      }
    }

    res.json({ totalConflictKeys, totalConflictCells, samples });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/merge/execute-selective
router.post('/merge/execute-selective', async (req, res) => {
  try {
    const { jobIds, key, excludeColumns, priorityJobIds } = req.body as {
      jobIds: string[]; key: string; excludeColumns?: string[]; priorityJobIds?: string[];
    };
    if (!jobIds || jobIds.length < 2) return res.status(400).json({ error: 'At least 2 jobIds required' });
    if (!key) return res.status(400).json({ error: 'key parameter required' });

    const user = getRequestUser(req);
    const jobIdsSQL = jobIds.map(id => `'${esc(id)}'`).join(',');
    const jobFilter = `_ingestion_job_id IN (${jobIdsSQL})`;

    const dataCols = await getDataColumns();
    const allCols = dataCols.map(c => c.name);
    if (!allCols.includes(key)) return res.status(400).json({ error: `Column '${key}' not found` });

    const colRows = await q<{ name: string }>(`
      SELECT name FROM system.columns
      WHERE database = currentDatabase() AND table = 'universal_person'
      ORDER BY position
    `);
    const internalColNames = colRows.filter(c => INTERNAL_COLS.has(c.name)).map(c => c.name);

    const excludeSet = new Set(excludeColumns || []);
    const activeCols = dataCols.filter(c => !excludeSet.has(c.name));
    const mergeKeyType = dataCols.find(c => c.name === key)?.type || 'String';
    const mergeKeyCond = nonEmptyCondition(key, mergeKeyType);

    const [beforeRow] = await q<{ cnt: string }>(`SELECT count() as cnt FROM universal_person`);
    const totalBefore = Number(beforeRow?.cnt || 0);

    console.log(`[Merge] Selective materialization key='${key}' by ${user.name} — jobs: ${jobIds.length}`);

    const resolvedPriority = priorityJobIds && priorityJobIds.length > 0 ? priorityJobIds : undefined;

    const selectParts = [
      ...activeCols.map(col => col.name === key ? `\`${col.name}\`` : prioritizedMergeExpr(col.name, col.type, resolvedPriority)),
      ...internalColNames.map(col => `any(\`${col}\`) as \`${col}\``),
    ];
    const allColsQuoted = [...activeCols.map(c => c.name), ...internalColNames].map(c => `\`${c}\``).join(', ');

    const tmpTable = `_merge_tmp_${Date.now()}`;
    await cmd(`CREATE TABLE ${tmpTable} AS universal_person`);

    try {
      await cmd(`INSERT INTO ${tmpTable} (${allColsQuoted})
        SELECT ${selectParts.join(', ')} FROM universal_person
        WHERE ${jobFilter} AND ${mergeKeyCond} GROUP BY \`${key}\``);

      await cmd(`INSERT INTO ${tmpTable}
        SELECT * FROM universal_person WHERE ${jobFilter} AND NOT (${mergeKeyCond})`);

      await cmd(`INSERT INTO ${tmpTable}
        SELECT * FROM universal_person WHERE NOT (${jobFilter})`);

      await cmd(`EXCHANGE TABLES universal_person AND ${tmpTable}`);
      await cmd(`DROP TABLE IF EXISTS ${tmpTable}`);

      const [afterRow] = await q<{ cnt: string }>(`SELECT count() as cnt FROM universal_person`);
      const totalAfter = Number(afterRow?.cnt || 0);

      console.log(`[Merge] Complete — ${totalBefore} → ${totalAfter} rows`);
      const reductionPercent = totalBefore > 0 ? Math.round((1 - totalAfter / totalBefore) * 100) : 0;
      res.json({
        success: true, mergeKey: key, totalBefore, totalAfter,
        rowsConsolidated: totalBefore - totalAfter,
        reductionPercent,
        filesCount: jobIds.length,
        priorityApplied: !!resolvedPriority,
        performedBy: user.name,
        performedAt: new Date().toISOString(),
      });
    } catch (innerErr: any) {
      await cmd(`DROP TABLE IF EXISTS ${tmpTable}`).catch(() => {});
      throw innerErr;
    }
  } catch (e: any) {
    console.error(`[Merge] Failed:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ingestion/merge/export-selective — STREAMING CSV export
router.get('/merge/export-selective', async (req, res) => {
  try {
    const jobIdsRaw = (req.query.jobIds as string || '').split(',').filter(Boolean);
    const mergeKey = req.query.key as string;
    if (jobIdsRaw.length < 2 || !mergeKey) return res.status(400).json({ error: 'jobIds and key required' });

    const jobIdsSQL = jobIdsRaw.map(id => `'${esc(id.trim())}'`).join(',');
    const dataCols = await getDataColumns();
    const mergeKeyType = dataCols.find(c => c.name === mergeKey)?.type || 'String';
    const mergeKeyCond = nonEmptyCondition(mergeKey, mergeKeyType);

    // Parse excluded columns
    const excludeColsRaw = (req.query.excludeCols as string || '').split(',').filter(Boolean);
    const excludeSet = new Set(excludeColsRaw);
    const activeCols = excludeSet.size > 0 ? dataCols.filter(c => !excludeSet.has(c.name)) : dataCols;

    // Parse priority order for conflict resolution
    const priorityRaw = (req.query.priority as string || '').split(',').filter(Boolean);
    const priorityJobIds = priorityRaw.length > 0 ? priorityRaw.map(id => id.trim()) : undefined;

    const selectParts = activeCols.map(col =>
      col.name === mergeKey ? `\`${col.name}\`` : prioritizedMergeExpr(col.name, col.type, priorityJobIds)
    );

    const exportLimit = Number(req.query.limit) || 0;

    const sql = `
      SELECT ${selectParts.join(', ')} FROM universal_person
      WHERE _ingestion_job_id IN (${jobIdsSQL}) AND ${mergeKeyCond}
      GROUP BY \`${mergeKey}\` ${exportLimit > 0 ? `LIMIT ${exportLimit}` : ''}
    `;

    const user = getRequestUser(req);
    console.log(`[Merge] Streaming export key='${mergeKey}' by ${user.name} — SQL length: ${sql.length}`);

    // Stream CSV directly from ClickHouse — zero Node.js memory usage
    const stream = await streamCSV(sql);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="merged-${mergeKey}-${Date.now()}.csv"`);
    res.setHeader('Transfer-Encoding', 'chunked');

    let hasData = false;
    for await (const rows of stream) {
      for (const row of rows) {
        hasData = true;
        res.write(row.text);
        res.write('\n');
      }
    }

    if (!hasData) {
      res.write('No data found\n');
    }

    res.end();
    console.log(`[Merge] Streaming export complete for key='${mergeKey}'`);
  } catch (e: any) {
    // If headers already sent, we can't send JSON error
    if (res.headersSent) {
      console.error(`[Merge] Streaming export error (headers sent): ${e.message}`);
      res.end();
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

export default router;

