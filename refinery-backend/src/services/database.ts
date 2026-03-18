import { query, command, ping } from '../db/clickhouse.js';

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

// ── Allowed columns for browse queries (whitelist for safety) ──
const ALLOWED_COLUMNS = new Set([
  'up_id', 'first_name', 'last_name', 'gender', 'age_range', 'married', 'children',
  'income_range', 'net_worth', 'homeowner', 'business_email', 'personal_emails',
  'mobile_phone', 'direct_number', 'personal_phone', 'linkedin_url',
  'personal_address', 'personal_city', 'personal_state', 'personal_zip', 'contact_country',
  'job_title', 'job_title_normalized', 'seniority_level', 'department',
  'professional_city', 'professional_state',
  'company_name', 'company_domain', 'company_phone',
  'company_city', 'company_state', 'company_country',
  'company_revenue', 'company_employee_count', 'primary_industry',
  'business_email_validation_status', '_ingestion_job_id', '_ingested_at',
  '_verification_status', '_verified_at',
]);

const SEARCHABLE_COLUMNS = [
  'first_name', 'last_name', 'business_email', 'personal_emails',
  'company_name', 'company_domain', 'job_title_normalized',
];

const FILTERABLE_COLUMNS = [
  'personal_state', 'primary_industry', 'seniority_level', 'department',
  'gender', 'income_range', 'homeowner', 'company_state',
  'business_email_validation_status', '_verification_status',
];

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
    sortBy = 'last_name',
    sortDir = 'asc',
  } = params;

  // Validate & sanitize columns
  const selectCols = (params.columns?.length ? params.columns : [
    'up_id', 'first_name', 'last_name', 'business_email', 'personal_emails',
    'mobile_phone', 'personal_state', 'personal_city',
    'job_title_normalized', 'seniority_level', 'company_name', 'primary_industry',
  ]).filter(c => ALLOWED_COLUMNS.has(c));

  // Build WHERE clauses
  const conditions: string[] = [];

  // Search
  if (search.trim()) {
    const escaped = search.trim().replace(/'/g, "\\'");
    const searchClauses = SEARCHABLE_COLUMNS
      .map(col => `lower(coalesce(${col}, '')) LIKE lower('%${escaped}%')`)
      .join(' OR ');
    conditions.push(`(${searchClauses})`);
  }

  // Filters
  for (const [col, val] of Object.entries(filters)) {
    if (!ALLOWED_COLUMNS.has(col) || !val) continue;
    const escaped = val.replace(/'/g, "\\'");
    conditions.push(`${col} = '${escaped}'`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Validate sort column
  const safeSortBy = ALLOWED_COLUMNS.has(sortBy) ? sortBy : 'last_name';
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

  // Get rows
  const rows = await query(
    `SELECT ${selectCols.join(', ')} FROM universal_person ${whereClause}
     ORDER BY ${safeSortBy} ${safeSortDir}
     LIMIT ${safePageSize} OFFSET ${offset}`
  );

  const elapsed = Date.now() - start;

  return { rows, total, page, pageSize: safePageSize, elapsed };
}

/** Get distinct values for a filter column (for populating dropdowns) */
export async function getFilterOptions(column: string): Promise<string[]> {
  if (!FILTERABLE_COLUMNS.includes(column)) {
    throw new Error(`Column '${column}' is not filterable`);
  }

  const rows = await query<{ val: string }>(
    `SELECT DISTINCT ${column} as val FROM universal_person
     WHERE ${column} IS NOT NULL AND ${column} != ''
     ORDER BY val
     LIMIT 200`
  );

  return rows.map(r => r.val);
}

/** Get available filterable columns */
export function getFilterableColumns() {
  return FILTERABLE_COLUMNS;
}

