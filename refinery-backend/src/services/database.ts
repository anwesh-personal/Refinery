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
