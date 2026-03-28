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

// GET /api/ingestion/:id/data â€” browse rows ingested by this job
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

// GET /api/ingestion/:id/export â€” download all rows from this job as CSV
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
    console.log(`[Ingestion] Job data exported: ${jobId} (${job.file_name}) â€” ${rows.length} rows by ${user.name}`);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="job-${safeName}-${Date.now()}.csv"`);
    res.send(csv);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”// Helper: determine if a ClickHouse type is string-like
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

// GET /api/ingestion/merge/keys â€” discover candidate merge key columns
router.get('/merge/keys', async (_req, res) => {
  try {
    // Get all non-internal columns
    const colRows = await q<{ name: string; type: string }>(` 
      SELECT name, type FROM system.columns
      WHERE database = currentDatabase() AND table = 'universal_person'
      ORDER BY position
    `);
    const internalCols = new Set([
      '_ingestion_job_id', '_ingested_at', '_segment_ids',
      '_verification_status', '_verified_at', '_v550_category',
      '_bounced', '_source_file_name',
    ]);
    const dataCols = colRows.filter(c => !internalCols.has(c.name));

    // For each column, check: how many distinct non-empty values, and across how many ingestion jobs
    const candidates: { name: string; type: string; distinctValues: number; jobsPresent: number; totalJobs: number; fillRate: number }[] = [];

    const [totalJobsRow] = await q<{ cnt: string }>(`SELECT countDistinct(_ingestion_job_id) as cnt FROM universal_person`);
    const totalJobs = Number(totalJobsRow?.cnt || 0);

    // Check top candidate columns (String/FixedString types with 'id' in name first, then others)
    const idCols = dataCols.filter(c => c.name.toLowerCase().includes('id'));
    const otherCols = dataCols.filter(c => !c.name.toLowerCase().includes('id') && isStringType(c.type));
    const colsToCheck = [...idCols, ...otherCols.slice(0, 20)]; // Limit to avoid heavy queries

    for (const col of colsToCheck) {
      const cond = nonEmptyCondition(col.name, col.type);
      const [stats] = await q<{ distinct_vals: string; jobs_present: string; fill_rate: string }>(`
        SELECT
          countDistinct(if(${cond}, toString(\`${col.name}\`), NULL)) as distinct_vals,
          countDistinct(if(${cond}, _ingestion_job_id, NULL)) as jobs_present,
          round(countIf(${cond}) / count() * 100, 1) as fill_rate
        FROM universal_person
      `);
      const dv = Number(stats?.distinct_vals || 0);
      const jp = Number(stats?.jobs_present || 0);
      const fr = Number(stats?.fill_rate || 0);

      if (dv > 0 && jp >= 1) {
        candidates.push({
          name: col.name,
          type: col.type,
          distinctValues: dv,
          jobsPresent: jp,
          totalJobs,
          fillRate: fr,
        });
      }
    }

    // Sort: columns present in most jobs first, then by distinct values
    candidates.sort((a, b) => {
      if (b.jobsPresent !== a.jobsPresent) return b.jobsPresent - a.jobsPresent;
      return b.distinctValues - a.distinctValues;
    });

    res.json({ candidates, totalJobs, totalColumns: dataCols.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ingestion/merge/preview â€” preview merged data
router.get('/merge/preview', async (req, res) => {
  try {
    const mergeKey = req.query.key as string;
    if (!mergeKey) return res.status(400).json({ error: 'key parameter required' });

    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 50, 10), 500);
    const search = (req.query.search as string || '').trim();
    const sortBy = req.query.sortBy as string || '';
    const sortDir = (req.query.sortDir === 'desc' ? 'DESC' : 'ASC');
    const offset = (page - 1) * pageSize;

    // Get all columns WITH types (needed for type-aware merge)
    const colRows = await q<{ name: string; type: string }>(`
      SELECT name, type FROM system.columns
      WHERE database = currentDatabase() AND table = 'universal_person'
      ORDER BY position
    `);
    const internalCols = new Set([
      '_ingestion_job_id', '_ingested_at', '_segment_ids',
      '_verification_status', '_verified_at', '_v550_category',
      '_bounced', '_source_file_name',
    ]);
    const dataCols = colRows.filter(c => !internalCols.has(c.name));
    const allCols = dataCols.map(c => c.name);
    const colTypeMap = new Map(dataCols.map(c => [c.name, c.type]));

    if (!allCols.includes(mergeKey)) {
      return res.status(400).json({ error: `Column '${mergeKey}' not found` });
    }

    // Build the merged SELECT with type-aware anyIf
    const mergeKeyType = colTypeMap.get(mergeKey) || 'String';
    const mergeKeyCond = nonEmptyCondition(mergeKey, mergeKeyType);
    const selectParts = dataCols.map(col => {
      if (col.name === mergeKey) return `\`${col.name}\``;
      return anyIfExpr(col.name, col.type);
    });

    const baseQuery = `
      SELECT ${selectParts.join(', ')}
      FROM universal_person
      WHERE ${mergeKeyCond}
      GROUP BY \`${mergeKey}\`
    `;

    // Search filter â€” wrap in subquery
    let wrappedQuery = baseQuery;
    if (search) {
      const escaped = search.replace(/'/g, "\\'");
      const searchCols = allCols.slice(0, 6);
      const searchClauses = searchCols.map(c => `lower(toString(\`${c}\`)) LIKE lower('%${escaped}%')`).join(' OR ');
      wrappedQuery = `SELECT * FROM (${baseQuery}) WHERE ${searchClauses}`;
    }

    // Count
    const [countResult] = await q<{ cnt: string }>(`SELECT count() as cnt FROM (${wrappedQuery})`);
    const total = Number(countResult?.cnt || 0);

    // Before-merge count
    const [beforeCount] = await q<{ cnt: string }>(`SELECT count() as cnt FROM universal_person WHERE ${mergeKeyCond}`);
    const totalBefore = Number(beforeCount?.cnt || 0);

    // Rows without key (will be excluded from merge)
    const [orphanCount] = await q<{ cnt: string }>(`SELECT count() as cnt FROM universal_person WHERE NOT (${mergeKeyCond})`);
    const orphanRows = Number(orphanCount?.cnt || 0);

    // Sort
    const safeSortBy = (sortBy && allCols.includes(sortBy)) ? `\`${sortBy}\`` : `\`${mergeKey}\``;

    // Fetch page
    const rows = await q(`
      SELECT * FROM (${wrappedQuery})
      ORDER BY ${safeSortBy} ${sortDir}
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    res.json({
      columns: allCols,
      mergeKey,
      rows,
      total,
      totalBefore,
      orphanRows,
      reduction: totalBefore > 0 ? Math.round((1 - total / totalBefore) * 100) : 0,
      page,
      pageSize,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/merge/execute — materialize the merged data
router.post('/merge/execute', async (req, res) => {
  try {
    const mergeKey = req.body.key as string;
    if (!mergeKey) return res.status(400).json({ error: 'key parameter required' });

    const user = getRequestUser(req);

    // Validate column exists — fetch types too
    const colRows = await q<{ name: string; type: string }>(`
      SELECT name, type FROM system.columns
      WHERE database = currentDatabase() AND table = 'universal_person'
      ORDER BY position
    `);
    const internalCols = new Set([
      '_ingestion_job_id', '_ingested_at', '_segment_ids',
      '_verification_status', '_verified_at', '_v550_category',
      '_bounced', '_source_file_name',
    ]);
    const dataCols = colRows.filter(c => !internalCols.has(c.name));
    const allCols = dataCols.map(c => c.name);
    const intCols = colRows.filter(c => internalCols.has(c.name));
    const internalColNames = intCols.map(c => c.name);

    if (!allCols.includes(mergeKey)) {
      return res.status(400).json({ error: `Column '${mergeKey}' not found` });
    }

    const mergeKeyType = dataCols.find(c => c.name === mergeKey)?.type || 'String';
    const mergeKeyCond = nonEmptyCondition(mergeKey, mergeKeyType);

    // Count before
    const [beforeRow] = await q<{ cnt: string }>(`SELECT count() as cnt FROM universal_person`);
    const totalBefore = Number(beforeRow?.cnt || 0);

    console.log(`[Merge] Starting materialization on key='${mergeKey}' by ${user.name} — ${totalBefore} rows before`);

    // Build merge SELECT with type-aware anyIf
    const selectParts = [
      ...dataCols.map(col => {
        if (col.name === mergeKey) return `\`${col.name}\``;
        return anyIfExpr(col.name, col.type);
      }),
      // Keep internal cols: use the latest values
      ...internalColNames.map(col => `any(\`${col}\`) as \`${col}\``),
    ];

    // Step 1: Create temp table with same structure
    const tmpTable = `_merge_tmp_${Date.now()}`;
    await cmd(`CREATE TABLE ${tmpTable} AS universal_person`);

    try {
      // Step 2: Insert merged rows (rows WITH the key)
      const allColsQuoted = [...allCols, ...internalColNames].map(c => `\`${c}\``).join(', ');
      await cmd(`
        INSERT INTO ${tmpTable} (${allColsQuoted})
        SELECT ${selectParts.join(', ')}
        FROM universal_person
        WHERE ${mergeKeyCond}
        GROUP BY \`${mergeKey}\`
      `);

      // Step 3: Insert orphan rows (rows WITHOUT the key — preserve as-is)
      await cmd(`
        INSERT INTO ${tmpTable}
        SELECT * FROM universal_person
        WHERE NOT (${mergeKeyCond})
      `);

      // Step 4: Atomic swap
      await cmd(`EXCHANGE TABLES universal_person AND ${tmpTable}`);

      // Step 5: Drop old table (now named tmpTable)
      await cmd(`DROP TABLE IF EXISTS ${tmpTable}`);

      // Count after
      const [afterRow] = await q<{ cnt: string }>(`SELECT count() as cnt FROM universal_person`);
      const totalAfter = Number(afterRow?.cnt || 0);

      console.log(`[Merge] Complete — ${totalBefore} → ${totalAfter} rows (${totalBefore - totalAfter} consolidated)`);

      res.json({
        success: true,
        mergeKey,
        totalBefore,
        totalAfter,
        rowsConsolidated: totalBefore - totalAfter,
        performedBy: user.name,
      });
    } catch (innerErr: any) {
      // Cleanup temp table on failure
      await cmd(`DROP TABLE IF EXISTS ${tmpTable}`).catch(() => {});
      throw innerErr;
    }
  } catch (e: any) {
    console.error(`[Merge] Failed:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ingestion/merge/export — export merged data as CSV (without materializing)
router.get('/merge/export', async (req, res) => {
  try {
    const mergeKey = req.query.key as string;
    if (!mergeKey) return res.status(400).json({ error: 'key parameter required' });

    const colRows = await q<{ name: string; type: string }>(`
      SELECT name, type FROM system.columns
      WHERE database = currentDatabase() AND table = 'universal_person'
      ORDER BY position
    `);
    const internalCols = new Set([
      '_ingestion_job_id', '_ingested_at', '_segment_ids',
      '_verification_status', '_verified_at', '_v550_category',
      '_bounced', '_source_file_name',
    ]);
    const dataCols = colRows.filter(c => !internalCols.has(c.name));
    const mergeKeyType = dataCols.find(c => c.name === mergeKey)?.type || 'String';
    const mergeKeyCond = nonEmptyCondition(mergeKey, mergeKeyType);

    const selectParts = dataCols.map(col => {
      if (col.name === mergeKey) return `\`${col.name}\``;
      return anyIfExpr(col.name, col.type);
    });

    const rows = await q(`
      SELECT ${selectParts.join(', ')}
      FROM universal_person
      WHERE ${mergeKeyCond}
      GROUP BY \`${mergeKey}\`
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
    console.log(`[Merge] Export on key='${mergeKey}' — ${rows.length} merged rows by ${user.name}`);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="merged-${mergeKey}-${Date.now()}.csv"`);
    res.send(csv);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
