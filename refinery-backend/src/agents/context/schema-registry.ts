import { query } from '../../db/clickhouse.js';
import { supabaseAdmin } from '../../services/supabaseAdmin.js';

// ═══════════════════════════════════════════════════════════
// Schema Registry — Live schema discovery with TTL caching
// ═══════════════════════════════════════════════════════════

interface ColumnMeta {
  name: string;
  type: string;
  comment: string;
}

interface TableMeta {
  name: string;
  engine: string;
  columns: ColumnMeta[];
  rowCount: number;
}

export interface SchemaMap {
  clickhouse: Record<string, TableMeta>;
  supabase: Record<string, { columns: ColumnMeta[] }>;
  generatedAt: string;
}

// ── Cache ──
let cachedSchema: SchemaMap | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function isCacheValid(): boolean {
  return cachedSchema !== null && (Date.now() - cacheTimestamp) < CACHE_TTL_MS;
}

// ── ClickHouse schema discovery ──
async function discoverClickHouseSchema(): Promise<Record<string, TableMeta>> {
  const tables: Record<string, TableMeta> = {};

  const tableRows = await query<{ name: string; engine: string; total_rows: string }>(
    `SELECT name, engine, total_rows FROM system.tables WHERE database = currentDatabase() AND engine NOT IN ('View') ORDER BY name`
  );

  const colRows = await query<{ table: string; name: string; type: string; comment: string }>(
    `SELECT table, name, type, comment FROM system.columns WHERE database = currentDatabase() ORDER BY table, position`
  );

  for (const t of tableRows) {
    tables[t.name] = {
      name: t.name,
      engine: t.engine,
      rowCount: parseInt(t.total_rows) || 0,
      columns: [],
    };
  }

  for (const c of colRows) {
    if (tables[c.table]) {
      tables[c.table].columns.push({ name: c.name, type: c.type, comment: c.comment || '' });
    }
  }

  return tables;
}

// ── Supabase schema discovery ──
async function discoverSupabaseSchema(): Promise<Record<string, { columns: ColumnMeta[] }>> {
  const tables: Record<string, { columns: ColumnMeta[] }> = {};

  // Use raw SQL via RPC since information_schema isn't queryable via .from()
  const { data, error } = await supabaseAdmin.rpc('get_public_columns' as any);

  // Fallback: if the RPC doesn't exist, return empty (we'll create it later)
  if (error || !data) {
    console.warn('[SchemaRegistry] Supabase schema discovery skipped:', error?.message || 'no data');
    return tables;
  }

  for (const row of data as any[]) {
    const tn = row.table_name;
    if (!tables[tn]) tables[tn] = { columns: [] };
    tables[tn].columns.push({ name: row.column_name, type: row.data_type, comment: '' });
  }

  return tables;
}

// ═══════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════

/** Get the full schema map (cached with 5min TTL) */
export async function getFullSchema(): Promise<SchemaMap> {
  if (isCacheValid()) return cachedSchema!;

  const [ch, sb] = await Promise.all([
    discoverClickHouseSchema().catch(e => { console.error('[SchemaRegistry] CH error:', e.message); return {} as Record<string, TableMeta>; }),
    discoverSupabaseSchema().catch(e => { console.error('[SchemaRegistry] SB error:', e.message); return {} as Record<string, { columns: ColumnMeta[] }>; }),
  ]);

  cachedSchema = { clickhouse: ch, supabase: sb, generatedAt: new Date().toISOString() };
  cacheTimestamp = Date.now();
  return cachedSchema;
}

/** Get schema for a specific ClickHouse table */
export async function getTableSchema(tableName: string): Promise<TableMeta | null> {
  const schema = await getFullSchema();
  return schema.clickhouse[tableName] || null;
}

/** Invalidate the cache (e.g. after schema changes) */
export function invalidateCache(): void {
  cachedSchema = null;
  cacheTimestamp = 0;
}

/**
 * Generates a prompt-injectable string describing the full data environment.
 * This is what the LLM sees in its system prompt — never hardcoded.
 */
export async function getPromptContext(): Promise<string> {
  const schema = await getFullSchema();
  const lines: string[] = ['## Your Data Environment\n'];

  // ClickHouse tables
  lines.push('### ClickHouse (Operational Data)');
  const chTables = Object.values(schema.clickhouse)
    .filter(t => t.rowCount > 0 || t.columns.length > 0)
    .sort((a, b) => b.rowCount - a.rowCount);

  for (const t of chTables) {
    const cols = t.columns.map(c => c.name).join(', ');
    const rowStr = t.rowCount > 0 ? ` (${t.rowCount.toLocaleString()} rows)` : '';
    lines.push(`- **${t.name}**${rowStr}: ${cols}`);
  }

  // Supabase tables (filter to relevant ones)
  const sbEntries = Object.entries(schema.supabase);
  if (sbEntries.length > 0) {
    lines.push('\n### Supabase (Application State)');
    const relevantPrefixes = ['ai_', 's3_', 'user', 'squad', 'segment', 'config'];
    const sbTables = sbEntries
      .filter(([name]) => relevantPrefixes.some(p => name.startsWith(p)))
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [name, meta] of sbTables) {
      const cols = meta.columns.map(c => c.name).join(', ');
      lines.push(`- **${name}**: ${cols}`);
    }
  }

  lines.push(`\n_Schema snapshot: ${schema.generatedAt}_`);
  return lines.join('\n');
}
