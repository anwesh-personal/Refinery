import { query, command, ping, streamCSV } from '../db/clickhouse.js';
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

  const [segmentCount] = await query<{ cnt: string }>(`
    SELECT count() as cnt FROM segments FINAL
  `).catch(() => [{ cnt: '0' }]);

  return {
    totalRows: tableStats?.total_rows || '0',
    totalBytes: tableStats?.total_bytes || '0',
    tableCount: tableStats?.table_count || '0',
    segmentCount: segmentCount?.cnt || '0',
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
const INTERNAL_COLS = new Set(['_ingestion_job_id', '_ingested_at', '_segment_ids', '_verification_status', '_verified_at', '_v550_category', '_bounced']);

// Cache columns for 60 seconds to avoid hitting system.columns on every request
let columnsCache: string[] = [];
let columnsCacheTimestamp = 0;
const COLUMNS_CACHE_TTL = 60_000;

/** Fetch all column names for universal_person from ClickHouse */
// Completeness threshold constants — single source of truth
export const COMPLETENESS_HIGH = 0.8;
export const COMPLETENESS_LOW = 0.4;
export const TABLE_NAME = 'universal_person';

export async function getTableColumns(): Promise<string[]> {
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

export interface AdvancedFilter {
  column: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'is_null' | 'is_not_null' | 'greater_than' | 'less_than' | 'between';
  value?: string;
}

export interface BrowseParams {
  search?: string;
  filters?: Record<string, string>;
  advancedFilters?: AdvancedFilter[];
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  columns?: string[];
  completenessFilter?: 'all' | 'high' | 'medium' | 'low';
  dataSourceIds?: string[];  // Multi-source filter: array of _ingestion_job_id values
}

// ─── Shared WHERE clause builder ────────────────────────────────────────
// Used by browseData, getFacets, and any future query that needs the same filter logic.
function buildWhereConditions(params: BrowseParams, allowedSet: Set<string>, selectCols?: string[]): string[] {
  const {
    search = '',
    filters = {},
    completenessFilter,
  } = params;

  const conditions: string[] = [];

  // ─── SMART SEARCH ─────────────────────────────────────────────────────
  // Always search across ALL relevant columns, not just visible ones.
  // Auto-detects intent: domain, email, phone, or general text search.
  if (search.trim()) {
    const raw = search.trim();
    const escaped = raw.replace(/'/g, "\\'");

    // Detect search intent from the input shape
    const isDomain = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw);
    const isEmail  = raw.includes('@');
    const isPhone  = /^[\d()+\-\s.]{7,}$/.test(raw);
    const isLinkedIn = raw.toLowerCase().includes('linkedin.com');

    // Build the searchable column sets — always validated against actual schema
    // Only sets that are used by intent-specific search paths:
    const DOMAIN_COLS  = ['business_email', 'personal_emails', 'additional_personal_emails', 'programmatic_business_emails', 'historical_programmatic_emails', 'company_domain', 'related_domains'].filter(c => allowedSet.has(c));
    const EMAIL_COLS   = ['business_email', 'personal_emails', 'additional_personal_emails', 'programmatic_business_emails', 'historical_programmatic_emails'].filter(c => allowedSet.has(c));
    const PHONE_COLS   = ['mobile_phone', 'direct_number', 'personal_phone', 'company_phone'].filter(c => allowedSet.has(c));
    const LINKEDIN_COLS= ['linkedin_url', 'company_linkedin_url'].filter(c => allowedSet.has(c));
    // General text search uses _search_text (bloom-filter indexed) — no column set needed

    if (isDomain) {
      // Domain search — targeted columns for precision
      const searchClauses = DOMAIN_COLS
        .map(col => `lower(coalesce(toString(\`${col}\`), '')) LIKE lower('%${escaped}%')`)
        .join(' OR ');
      if (searchClauses) conditions.push(`(${searchClauses})`);
    } else if (isEmail) {
      const searchClauses = EMAIL_COLS
        .map(col => `lower(coalesce(toString(\`${col}\`), '')) LIKE lower('%${escaped}%')`)
        .join(' OR ');
      if (searchClauses) conditions.push(`(${searchClauses})`);
    } else if (isPhone) {
      const searchClauses = PHONE_COLS
        .map(col => `lower(coalesce(toString(\`${col}\`), '')) LIKE lower('%${escaped}%')`)
        .join(' OR ');
      if (searchClauses) conditions.push(`(${searchClauses})`);
    } else if (isLinkedIn) {
      const searchClauses = LINKEDIN_COLS
        .map(col => `lower(coalesce(toString(\`${col}\`), '')) LIKE lower('%${escaped}%')`)
        .join(' OR ');
      if (searchClauses) conditions.push(`(${searchClauses})`);
    } else {
      // General text search — uses indexed _search_text column (ngrambf bloom filter)
      // 1 LIKE scan on 1 indexed column instead of 25 unindexed LIKE scans
      conditions.push(`_search_text LIKE '%${escaped.toLowerCase()}%'`);
    }
  }

  // Simple exact-match filters (legacy / dropdown support)
  for (const [col, val] of Object.entries(filters)) {
    if (!allowedSet.has(col) || !val) continue;
    const escaped = val.replace(/'/g, "\\'");
    conditions.push(`\`${col}\` = '${escaped}'`);
  }

  // Advanced filters with operators
  const advancedFilters = params.advancedFilters || [];
  for (const af of advancedFilters) {
    if (!allowedSet.has(af.column)) continue;
    const col = `\`${af.column}\``;
    const escaped = (af.value || '').replace(/'/g, "\\'");
    switch (af.operator) {
      case 'equals': conditions.push(`${col} = '${escaped}'`); break;
      case 'not_equals': conditions.push(`${col} != '${escaped}'`); break;
      case 'contains': conditions.push(`lower(coalesce(toString(${col}), '')) LIKE lower('%${escaped}%')`); break;
      case 'not_contains': conditions.push(`lower(coalesce(toString(${col}), '')) NOT LIKE lower('%${escaped}%')`); break;
      case 'starts_with': conditions.push(`lower(coalesce(toString(${col}), '')) LIKE lower('${escaped}%')`); break;
      case 'ends_with': conditions.push(`lower(coalesce(toString(${col}), '')) LIKE lower('%${escaped}')`); break;
      case 'is_null': conditions.push(`(${col} IS NULL OR toString(${col}) = '')`); break;
      case 'is_not_null': conditions.push(`(${col} IS NOT NULL AND toString(${col}) != '')`); break;
      case 'greater_than': conditions.push(`${col} > '${escaped}'`); break;
      case 'less_than': conditions.push(`${col} < '${escaped}'`); break;
      case 'between': {
        const parts = escaped.split(',').map(s => s.trim().replace(/'/g, "\\'"));
        if (parts.length === 2) {
          conditions.push(`${col} >= '${parts[0]}' AND ${col} <= '${parts[1]}'`);
        }
        break;
      }
    }
  }

  // Multi-source data filter — IN clause for multiple ingestion job IDs
  if (params.dataSourceIds && params.dataSourceIds.length > 0) {
    const escaped = params.dataSourceIds.map(id => `'${id.replace(/'/g, "\\'")}'`).join(', ');
    conditions.push(`\`_ingestion_job_id\` IN (${escaped})`);
  }

  // Completeness filter
  if (completenessFilter && completenessFilter !== 'all' && selectCols && selectCols.length > 0) {
    const filledExpr = selectCols.map(c => `if(\`${c}\` IS NOT NULL AND toString(\`${c}\`) != '', 1, 0)`).join(' + ');
    const totalCols = selectCols.length;
    if (completenessFilter === 'high') {
      conditions.push(`(${filledExpr}) / ${totalCols} > ${COMPLETENESS_HIGH}`);
    } else if (completenessFilter === 'medium') {
      conditions.push(`(${filledExpr}) / ${totalCols} > ${COMPLETENESS_LOW} AND (${filledExpr}) / ${totalCols} <= ${COMPLETENESS_HIGH}`);
    } else if (completenessFilter === 'low') {
      conditions.push(`(${filledExpr}) / ${totalCols} <= ${COMPLETENESS_LOW}`);
    }
  }

  return conditions;
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
    completenessFilter,
  } = params;

  const allColumns = await getTableColumns();
  const allowedSet = new Set(allColumns);

  // Default columns: curated priority list with emails up front
  const PRIORITY_COLS = [
    'first_name', 'last_name', 'business_email', 'personal_emails',
    'company_name', 'job_title_normalized', 'primary_industry',
    'personal_state', 'seniority_level', 'mobile_phone',
    'company_domain', 'linkedin_url',
  ];
  const priorityCols = PRIORITY_COLS.filter(c => allowedSet.has(c));
  const remaining = allColumns.filter(c => !INTERNAL_COLS.has(c) && !priorityCols.includes(c));
  const defaultCols = [...priorityCols, ...remaining].slice(0, 14);

  // Validate & sanitize requested columns
  const selectCols = (params.columns?.length ? params.columns : defaultCols)
    .filter(c => allowedSet.has(c));

  if (selectCols.length === 0) {
    throw new Error('No valid columns to select');
  }

  // Build WHERE using shared function
  const conditions = buildWhereConditions(params, allowedSet, selectCols);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Validate sort column
  const safeSortBy = (sortBy && allowedSet.has(sortBy)) ? `\`${sortBy}\`` : `\`${selectCols[0]}\``;
  const safeSortDir = sortDir === 'desc' ? 'DESC' : 'ASC';

  // Clamp page size
  const safePageSize = Math.min(Math.max(pageSize, 10), 5000);
  const offset = (Math.max(page, 1) - 1) * safePageSize;

  const start = Date.now();

  // Get total count (60s timeout — wide searches on 121M rows can exceed default 30s)
  const browseOpts = { timeoutMs: 60_000, settings: { max_execution_time: 60 } };
  const [countResult] = await query<{ cnt: string }>(
    `SELECT count() as cnt FROM universal_person ${whereClause}`,
    browseOpts
  );
  const total = Number(countResult?.cnt || 0);

  // Get rows — backtick-escape all column names for safety
  const escapedCols = selectCols.map(c => `\`${c}\``).join(', ');
  const rows = await query(
    `SELECT ${escapedCols} FROM universal_person ${whereClause}
     ORDER BY ${safeSortBy} ${safeSortDir}
     LIMIT ${safePageSize} OFFSET ${offset}`,
    browseOpts
  );

  const elapsed = Date.now() - start;

  return { rows, total, page, pageSize: safePageSize, elapsed };
}

// ─── Faceted Filter Counts ──────────────────────────────────────────────
// Returns top N values + counts for specified columns within the CURRENT filtered result set.
// This powers the drill-down UI — e.g. after searching pch.com, show "California (89), Texas (45)".
const FACET_COLUMNS = [
  'personal_state', 'seniority_level', 'primary_industry', 'department',
  'job_title_normalized', 'company_name', 'personal_country', 'gender',
];

export async function getFacets(params: BrowseParams, facetColumns?: string[]) {
  const allColumns = await getTableColumns();
  const allowedSet = new Set(allColumns);

  // Use provided facet columns or default set, always validated against schema
  const cols = (facetColumns?.length ? facetColumns : FACET_COLUMNS)
    .filter(c => allowedSet.has(c));

  if (cols.length === 0) return { facets: {} };

  // Build WHERE using the same shared function as browseData
  const conditions = buildWhereConditions(params, allowedSet);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Run all facet queries in parallel for speed
  const facetPromises = cols.map(async (col) => {
    try {
      // Add non-empty condition for this specific facet column
      const facetConditions = [...conditions, `\`${col}\` IS NOT NULL AND toString(\`${col}\`) != ''`];
      const facetWhere = `WHERE ${facetConditions.join(' AND ')}`;

      const rows = await query<{ val: string; cnt: string }>(`
        SELECT toString(\`${col}\`) as val, count() as cnt
        FROM universal_person
        ${facetWhere}
        GROUP BY val
        ORDER BY cnt DESC
        LIMIT 15
      `);
      return { column: col, values: rows.map(r => ({ value: r.val, count: Number(r.cnt) })) };
    } catch {
      return { column: col, values: [] };
    }
  });

  const results = await Promise.all(facetPromises);
  const facets: Record<string, { value: string; count: number }[]> = {};
  for (const r of results) {
    if (r.values.length > 0) facets[r.column] = r.values;
  }

  return { facets };
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

/** Get column stats — top N distinct values with counts */
export async function getColumnStats(column: string, limit = 20): Promise<{ value: string; count: string }[]> {
  const safeCol = column.replace(/[^a-zA-Z0-9_]/g, '');
  return query<{ value: string; count: string }>(`
    SELECT toString(${safeCol}) as value, count() as count
    FROM universal_person
    WHERE ${safeCol} IS NOT NULL AND toString(${safeCol}) != ''
    GROUP BY value
    ORDER BY count DESC
    LIMIT ${limit}
  `);
}

/** Bulk delete rows by up_id list */
export async function bulkDeleteRows(upIds: string[]): Promise<number> {
  if (!upIds.length || upIds.length > 10000) throw new Error('Invalid selection (max 10,000)');
  const escaped = upIds.map(id => `'${id.replace(/'/g, "\\'")}'`).join(',');
  await command(`ALTER TABLE universal_person DELETE WHERE up_id IN (${escaped})`);
  return upIds.length;
}

/** Get columns for a specific table */
export async function getTableColumnsFor(tableName: string): Promise<string[]> {
  const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
  const rows = await query<{ name: string }>(`
    SELECT name FROM system.columns
    WHERE database = currentDatabase() AND table = '${safeName}'
    ORDER BY position
  `);
  return rows.map(r => r.name);
}

/**
 * Streaming CSV export — returns a ClickHouse native CSV stream.
 * Zero memory footprint: ClickHouse generates CSV, Node.js just pipes it through.
 * 5-minute ClickHouse timeout for large filtered sets (millions of rows).
 */
export async function exportStreamCSV(params: BrowseParams) {
  const { sortBy, sortDir = 'asc' } = params;

  const allColumns = await getTableColumns();
  const allowedSet = new Set(allColumns);

  // Use the same priority columns and validation as browseData
  const PRIORITY_COLS = [
    'first_name', 'last_name', 'business_email', 'personal_emails',
    'company_name', 'job_title_normalized', 'primary_industry',
    'personal_state', 'seniority_level', 'mobile_phone',
    'company_domain', 'linkedin_url',
  ];
  const priorityCols = PRIORITY_COLS.filter(c => allowedSet.has(c));
  const remaining = allColumns.filter(c => !INTERNAL_COLS.has(c) && !priorityCols.includes(c));
  const defaultCols = [...priorityCols, ...remaining].slice(0, 14);

  const selectCols = (params.columns?.length ? params.columns : defaultCols)
    .filter(c => allowedSet.has(c));

  if (selectCols.length === 0) throw new Error('No valid columns to select');

  // Build WHERE using shared function (identical to browseData)
  const conditions = buildWhereConditions(params, allowedSet, selectCols);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Sort
  const safeSortBy = (sortBy && allowedSet.has(sortBy)) ? `\`${sortBy}\`` : `\`${selectCols[0]}\``;
  const safeSortDir = sortDir === 'desc' ? 'DESC' : 'ASC';

  const escapedCols = selectCols.map(c => `\`${c}\``).join(', ');

  // 5-minute timeout for large exports
  const sql = `SELECT ${escapedCols} FROM universal_person ${whereClause}
    ORDER BY ${safeSortBy} ${safeSortDir}`;

  const stream = await streamCSV(sql, { timeoutMs: 300_000 });
  return { stream, columns: selectCols };
}
