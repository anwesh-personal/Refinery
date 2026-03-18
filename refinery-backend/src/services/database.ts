import { query, command, ping } from '../db/clickhouse.js';
import { env } from '../config/env.js';

/** Run a user SQL query (read-only, with safety checks) */
export async function executeQuery(sql: string): Promise<{ rows: Record<string, unknown>[]; elapsed: number }> {
  // Safety: only allow SELECT
  const normalized = sql.trim().toUpperCase();
  if (!normalized.startsWith('SELECT')) {
    throw new Error('Only SELECT queries are allowed from the UI.');
  }

  // Enforce a limit to avoid dumping 269M rows
  if (!normalized.includes('LIMIT')) {
    sql = sql.replace(/;?\s*$/, '') + ' LIMIT 1000';
  }

  const start = Date.now();
  const rows = await query(sql);
  const elapsed = Date.now() - start;

  return { rows, elapsed };
}

/** Get database stats */
export async function getDatabaseStats() {
  const [tableStats] = await query<{
    total_rows: string;
    total_bytes: string;
    table_count: string;
  }>(`
    SELECT
      sum(rows) as total_rows,
      sum(bytes_on_disk) as total_bytes,
      count() as table_count
    FROM system.parts
    WHERE database = currentDatabase() AND active
  `);

  const [queryCount] = await query<{ cnt: string }>(`
    SELECT count() as cnt FROM system.query_log
    WHERE event_date = today() AND type = 'QueryFinish'
  `).catch(() => [{ cnt: '0' }]);

  return {
    totalRows: tableStats?.total_rows || '0',
    totalBytes: tableStats?.total_bytes || '0',
    tableCount: tableStats?.table_count || '0',
    queriesToday: queryCount?.cnt || '0',
  };
}

/** List all tables and their row counts */
export async function listTables() {
  return query(`
    SELECT
      table,
      sum(rows) as rows,
      sum(bytes_on_disk) as bytes_on_disk,
      max(modification_time) as last_modified
    FROM system.parts
    WHERE database = currentDatabase() AND active
    GROUP BY table
    ORDER BY table
  `);
}

/** Health check */
export async function checkHealth() {
  const ok = await ping();
  return { clickhouse: ok };
}

// ── Dynamic column discovery ──
// Internal columns (metadata) that should appear last
const INTERNAL_COLS = new Set(['_ingestion_job_id', '_ingested_at', '_segment_ids', '_verification_status', '_verified_at']);

// Cache columns for 60 seconds to avoid hitting system.columns on every request
let columnsCache: string[] = [];
let columnsCacheTimestamp = 0;
const COLUMNS_CACHE_TTL = 60_000;

/** Fetch all column names for universal_person from ClickHouse */
async function getTableColumns(): Promise<string[]> {
  const now = Date.now();
  if (columnsCache.length > 0 && now - columnsCacheTimestamp < COLUMNS_CACHE_TTL) {
    return columnsCache;
  }
  const rows = await query<{ name: string }>(`
    SELECT name FROM system.columns
    WHERE database = '${env.clickhouse.database}' AND table = 'universal_person'
    ORDER BY position
  `);
  columnsCache = rows.map(r => r.name);
  columnsCacheTimestamp = now;
  return columnsCache;
}

/** Get columns exposed to the API */
export async function getAvailableColumns(): Promise<string[]> {
  return getTableColumns();
}

export interface BrowseParams {
  search?: string;
  filters?: Record<string, string>;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  columns?: string[];
}

/** Browse data with filters, search, pagination — no SQL required */
export async function browseData(params: BrowseParams) {
  const {
    search = '',
    filters = {},
    page = 1,
    pageSize = 50,
    sortBy,
    sortDir = 'asc',
  } = params;

  const allColumns = await getTableColumns();
  const allowedSet = new Set(allColumns);

  // Default columns: show data-bearing columns first, then internal
  const defaultCols = allColumns.filter(c => !INTERNAL_COLS.has(c)).slice(0, 12);

  // Validate & sanitize requested columns
  const selectCols = (params.columns?.length ? params.columns : defaultCols)
    .filter(c => allowedSet.has(c));

  if (selectCols.length === 0) {
    throw new Error('No valid columns to select');
  }

  // Build WHERE clauses
  const conditions: string[] = [];

  // Search — search across all string-like columns that are in selectCols
  if (search.trim()) {
    const escaped = search.trim().replace(/'/g, "\\'");
    const searchClauses = selectCols
      .map(col => `lower(coalesce(toString(\`${col}\`), '')) LIKE lower('%${escaped}%')`)
      .join(' OR ');
    conditions.push(`(${searchClauses})`);
  }

  // Filters
  for (const [col, val] of Object.entries(filters)) {
    if (!allowedSet.has(col) || !val) continue;
    const escaped = val.replace(/'/g, "\\'");
    conditions.push(`\`${col}\` = '${escaped}'`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Validate sort column
  const safeSortBy = (sortBy && allowedSet.has(sortBy)) ? `\`${sortBy}\`` : `\`${selectCols[0]}\``;
  const safeSortDir = sortDir === 'desc' ? 'DESC' : 'ASC';

  // Clamp page size
  const safePageSize = Math.min(Math.max(pageSize, 10), 200);
  const offset = (Math.max(page, 1) - 1) * safePageSize;

  const start = Date.now();

  // Get total count
  const [countResult] = await query<{ cnt: string }>(
    `SELECT count() as cnt FROM universal_person ${whereClause}`
  );
  const total = Number(countResult?.cnt || 0);

  // Get rows — backtick-escape all column names for safety
  const escapedCols = selectCols.map(c => `\`${c}\``).join(', ');
  const rows = await query(
    `SELECT ${escapedCols} FROM universal_person ${whereClause}
     ORDER BY ${safeSortBy} ${safeSortDir}
     LIMIT ${safePageSize} OFFSET ${offset}`
  );

  const elapsed = Date.now() - start;

  return { rows, total, page, pageSize: safePageSize, elapsed };
}

/** Get distinct values for a filter column (for populating dropdowns) */
export async function getFilterOptions(column: string): Promise<string[]> {
  const allColumns = await getTableColumns();
  if (!allColumns.includes(column)) {
    throw new Error(`Column '${column}' is not a valid column`);
  }

  const rows = await query<{ val: string }>(
    `SELECT DISTINCT \`${column}\` as val FROM universal_person
     WHERE \`${column}\` IS NOT NULL AND toString(\`${column}\`) != ''
     ORDER BY val
     LIMIT 200`
  );

  return rows.map(r => r.val);
}

/** Get filterable columns — dynamically returns all non-internal columns */
export async function getFilterableColumns(): Promise<string[]> {
  const allColumns = await getTableColumns();
  return allColumns.filter(c => !INTERNAL_COLS.has(c));
}

