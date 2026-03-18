import { query, command } from '../db/clickhouse.js';
import { env } from '../config/env.js';

function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/* ── Types ── */
export interface CleanupRule {
  type: 'date_range' | 'missing_email' | 'keyword' | 'source' | 'duplicates' | 'empty_columns';
  // date_range
  date_from?: string;
  date_to?: string;
  // missing_email: no extra params — deletes rows where email columns are all null/empty
  email_columns?: string[];
  // keyword
  column?: string;
  keyword?: string;
  // source
  source_key?: string;
  job_id?: string;
  // duplicates
  dedup_column?: string;
  // empty_columns: columns that must all be empty for deletion
  columns?: string[];
}

export interface CleanupPreview {
  rule: CleanupRule;
  affectedRows: number;
  sampleRows: Record<string, unknown>[];
}

export interface CleanupResult {
  rule: CleanupRule;
  deletedRows: number;
}

/* ── Helpers ── */
const DB = env.clickhouse.database;
const TABLE = 'universal_person';

function buildWhereClause(rule: CleanupRule): string {
  switch (rule.type) {
    case 'date_range': {
      const parts: string[] = [];
      if (rule.date_from) parts.push(`_ingestion_timestamp >= '${esc(rule.date_from)}'`);
      if (rule.date_to) parts.push(`_ingestion_timestamp <= '${esc(rule.date_to)}'`);
      if (parts.length === 0) throw new Error('date_range requires at least date_from or date_to');
      return parts.join(' AND ');
    }
    case 'missing_email': {
      const cols = rule.email_columns?.length
        ? rule.email_columns
        : ['email', 'email_address', 'work_email', 'personal_email'];
      // All specified email columns must be null or empty
      return cols.map(c => `(${esc(c)} IS NULL OR toString(${esc(c)}) = '')`).join(' AND ');
    }
    case 'keyword': {
      if (!rule.column || !rule.keyword) throw new Error('keyword rule requires column and keyword');
      return `positionCaseInsensitive(toString(\`${esc(rule.column)}\`), '${esc(rule.keyword)}') > 0`;
    }
    case 'source': {
      if (rule.job_id) return `_ingestion_job_id = '${esc(rule.job_id)}'`;
      if (rule.source_key) return `_ingestion_job_id IN (SELECT id FROM ingestion_jobs WHERE source_key LIKE '%${esc(rule.source_key)}%')`;
      throw new Error('source rule requires job_id or source_key');
    }
    case 'duplicates': {
      const col = rule.dedup_column || 'email';
      // Keep the first occurrence (by _ingestion_timestamp), delete the rest
      return `(\`${esc(col)}\`, _ingestion_timestamp) NOT IN (
        SELECT \`${esc(col)}\`, min(_ingestion_timestamp)
        FROM ${TABLE}
        WHERE \`${esc(col)}\` IS NOT NULL AND toString(\`${esc(col)}\`) != ''
        GROUP BY \`${esc(col)}\`
      ) AND \`${esc(col)}\` IS NOT NULL AND toString(\`${esc(col)}\`) != ''`;
    }
    case 'empty_columns': {
      if (!rule.columns?.length) throw new Error('empty_columns requires columns list');
      return rule.columns.map(c => `(\`${esc(c)}\` IS NULL OR toString(\`${esc(c)}\`) = '')`).join(' AND ');
    }
    default:
      throw new Error(`Unknown cleanup rule type: ${(rule as any).type}`);
  }
}

/* ── Preview (dry run) ── */
export async function previewCleanup(rule: CleanupRule): Promise<CleanupPreview> {
  const where = buildWhereClause(rule);

  const [countResult] = await query<{ cnt: string }>(`SELECT count() as cnt FROM ${TABLE} WHERE ${where}`);
  const affectedRows = parseInt(countResult?.cnt || '0', 10);

  const sampleRows = await query(`SELECT * FROM ${TABLE} WHERE ${where} LIMIT 10`);

  return { rule, affectedRows, sampleRows };
}

/* ── Execute cleanup ── */
export async function executeCleanup(rule: CleanupRule): Promise<CleanupResult> {
  const where = buildWhereClause(rule);

  // Get count first
  const [countResult] = await query<{ cnt: string }>(`SELECT count() as cnt FROM ${TABLE} WHERE ${where}`);
  const deletedRows = parseInt(countResult?.cnt || '0', 10);

  // Execute the delete
  await command(`ALTER TABLE ${TABLE} DELETE WHERE ${where}`);
  console.log(`[Janitor] Deleted ${deletedRows} rows (rule: ${rule.type})`);

  return { rule, deletedRows };
}

/* ── Get available columns for UI dropdowns ── */
export async function getColumns(): Promise<string[]> {
  const cols = await query<{ name: string }>(`
    SELECT name FROM system.columns
    WHERE database = '${esc(DB)}' AND table = '${TABLE}'
    ORDER BY name
  `);
  return cols.map(c => c.name);
}

/* ── Get ingestion job IDs for source filter ── */
export async function getIngestionJobs(): Promise<{ id: string; file_name: string; started_at: string }[]> {
  return query(`SELECT id, file_name, started_at FROM ingestion_jobs ORDER BY started_at DESC LIMIT 100`);
}

/* ── Table stats ── */
export async function getTableStats(): Promise<{ totalRows: number; totalBytes: number }> {
  const [row] = await query<{ cnt: string; bytes: string }>(`
    SELECT count() as cnt, sum(length(toString(*))) as bytes FROM ${TABLE}
  `).catch(() => [{ cnt: '0', bytes: '0' }]);
  return {
    totalRows: parseInt(row?.cnt || '0', 10),
    totalBytes: parseInt(row?.bytes || '0', 10),
  };
}
