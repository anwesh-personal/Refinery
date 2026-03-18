import { query, command } from '../db/clickhouse.js';
import { env } from '../config/env.js';

/** Escape a string value for safe insertion into ClickHouse SQL */
function escVal(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Validate that a column name actually exists in the target table. Prevents SQL injection via column names. */
let _cachedColumns: Set<string> | null = null;
async function getValidColumns(): Promise<Set<string>> {
  if (_cachedColumns) return _cachedColumns;
  const cols = await query<{ name: string }>(`
    SELECT name FROM system.columns
    WHERE database = '${escVal(DB)}' AND table = '${TABLE}'
  `);
  _cachedColumns = new Set(cols.map(c => c.name));
  // Bust cache after 5 minutes so schema changes are picked up
  setTimeout(() => { _cachedColumns = null; }, 5 * 60 * 1000);
  return _cachedColumns;
}

function assertValidColumnName(col: string) {
  // Basic sanity: only allow alphanumeric, underscore, and dot
  if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(col)) {
    throw new Error(`Invalid column name: "${col}"`);
  }
}

/** Quote a column name safely for ClickHouse SQL */
function quoteCol(col: string): string {
  assertValidColumnName(col);
  return `\`${col}\``;
}

/* ── Types ── */
export interface CleanupRule {
  type: 'date_range' | 'missing_email' | 'keyword' | 'source' | 'duplicates' | 'empty_columns';
  date_from?: string;
  date_to?: string;
  email_columns?: string[];
  column?: string;
  keyword?: string;
  source_key?: string;
  job_id?: string;
  dedup_column?: string;
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

/* ── Constants ── */
const DB = env.clickhouse.database;
const TABLE = 'universal_person';

/* ── WHERE clause builder ── */
async function buildWhereClause(rule: CleanupRule): Promise<string> {
  const validCols = await getValidColumns();

  switch (rule.type) {
    case 'date_range': {
      const parts: string[] = [];
      if (rule.date_from) parts.push(`_ingestion_timestamp >= '${escVal(rule.date_from)}'`);
      if (rule.date_to) parts.push(`_ingestion_timestamp <= '${escVal(rule.date_to)}'`);
      if (parts.length === 0) throw new Error('date_range requires at least date_from or date_to');
      return parts.join(' AND ');
    }

    case 'missing_email': {
      const cols = rule.email_columns?.length
        ? rule.email_columns
        : ['email', 'email_address', 'work_email', 'personal_email'];
      // Only use columns that actually exist in the table
      const existing = cols.filter(c => validCols.has(c));
      if (existing.length === 0) throw new Error('None of the specified email columns exist in the table');
      return existing.map(c => `(${quoteCol(c)} IS NULL OR toString(${quoteCol(c)}) = '')`).join(' AND ');
    }

    case 'keyword': {
      if (!rule.column || !rule.keyword) throw new Error('keyword rule requires column and keyword');
      if (!validCols.has(rule.column)) throw new Error(`Column "${rule.column}" does not exist`);
      return `positionCaseInsensitive(toString(${quoteCol(rule.column)}), '${escVal(rule.keyword)}') > 0`;
    }

    case 'source': {
      if (rule.job_id) return `_ingestion_job_id = '${escVal(rule.job_id)}'`;
      if (rule.source_key) return `_ingestion_job_id IN (SELECT id FROM ingestion_jobs WHERE source_key LIKE '%${escVal(rule.source_key)}%')`;
      throw new Error('source rule requires job_id or source_key');
    }

    case 'duplicates': {
      const col = rule.dedup_column || 'email';
      if (!validCols.has(col)) throw new Error(`Column "${col}" does not exist`);
      const qc = quoteCol(col);
      return `(${qc}, _ingestion_timestamp) NOT IN (
        SELECT ${qc}, min(_ingestion_timestamp)
        FROM ${TABLE}
        WHERE ${qc} IS NOT NULL AND toString(${qc}) != ''
        GROUP BY ${qc}
      ) AND ${qc} IS NOT NULL AND toString(${qc}) != ''`;
    }

    case 'empty_columns': {
      if (!rule.columns?.length) throw new Error('empty_columns requires columns list');
      const existing = rule.columns.filter(c => validCols.has(c));
      if (existing.length === 0) throw new Error('None of the specified columns exist in the table');
      return existing.map(c => `(${quoteCol(c)} IS NULL OR toString(${quoteCol(c)}) = '')`).join(' AND ');
    }

    default:
      throw new Error(`Unknown cleanup rule type: ${(rule as any).type}`);
  }
}

/* ── Preview (dry run) ── */
export async function previewCleanup(rule: CleanupRule): Promise<CleanupPreview> {
  const where = await buildWhereClause(rule);

  const [countResult] = await query<{ cnt: string }>(`SELECT count() as cnt FROM ${TABLE} WHERE ${where}`);
  const affectedRows = parseInt(countResult?.cnt || '0', 10);

  const sampleRows = await query(`SELECT * FROM ${TABLE} WHERE ${where} LIMIT 10`);

  return { rule, affectedRows, sampleRows };
}

/* ── Execute cleanup ── */
export async function executeCleanup(rule: CleanupRule): Promise<CleanupResult> {
  const where = await buildWhereClause(rule);

  const [countResult] = await query<{ cnt: string }>(`SELECT count() as cnt FROM ${TABLE} WHERE ${where}`);
  const deletedRows = parseInt(countResult?.cnt || '0', 10);

  await command(`ALTER TABLE ${TABLE} DELETE WHERE ${where}`);
  console.log(`[Janitor] Deleted ${deletedRows} rows (rule: ${rule.type})`);

  return { rule, deletedRows };
}

/* ── Get available columns for UI dropdowns ── */
export async function getColumns(): Promise<string[]> {
  const cols = await query<{ name: string }>(`
    SELECT name FROM system.columns
    WHERE database = '${escVal(DB)}' AND table = '${TABLE}'
    ORDER BY name
  `);
  return cols.map(c => c.name);
}

/* ── Get ingestion job IDs for source filter ── */
export async function getIngestionJobs(): Promise<{ id: string; file_name: string; started_at: string }[]> {
  return query(`SELECT id, file_name, started_at FROM ingestion_jobs ORDER BY started_at DESC LIMIT 200`);
}
