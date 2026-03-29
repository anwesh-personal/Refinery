// ═══════════════════════════════════════════════════════════
// Database Tool Handlers
// Read-only ClickHouse access for Cortex agent
// ═══════════════════════════════════════════════════════════

import type { ToolResult, ToolContext } from '../types.js';
import { query as chQuery } from '../../../db/clickhouse.js';

const DANGEROUS_SQL = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|ATTACH|DETACH|RENAME|OPTIMIZE)\b/i;

/** Run a read-only ClickHouse query */
export async function queryDatabase(
  args: { query: string; limit?: number },
  _ctx: ToolContext
): Promise<ToolResult> {
  try {
    const q = (args.query || '').trim();
    if (!q) return { success: false, error: 'Query is required.' };

    // GUARDRAIL: Only SELECT allowed
    if (!q.toUpperCase().startsWith('SELECT')) {
      return { success: false, error: 'Only SELECT queries are allowed. No mutations permitted.' };
    }
    if (DANGEROUS_SQL.test(q)) {
      return { success: false, error: 'Query contains forbidden keywords. Only SELECT is allowed.' };
    }

    // Ensure LIMIT exists to prevent runaway queries
    const limit = Math.min(args.limit || 100, 1000);
    const hasLimit = /\bLIMIT\b/i.test(q);
    const finalQuery = hasLimit ? q : `${q} LIMIT ${limit}`;

    const startMs = Date.now();
    const rows = await chQuery<any>(finalQuery);
    const elapsed = Date.now() - startMs;

    // Extract column names from first row
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    return {
      success: true,
      data: {
        rows,
        columns,
        rowCount: rows.length,
        elapsedMs: elapsed,
        query: finalQuery,
      },
    };
  } catch (e: any) {
    return { success: false, error: `ClickHouse query error: ${e.message}` };
  }
}

/** Get column definitions for a ClickHouse table */
export async function getTableSchema(
  args: { table?: string },
  _ctx: ToolContext
): Promise<ToolResult> {
  try {
    const table = (args.table || 'universal_person').replace(/[^a-zA-Z0-9_]/g, '');
    const cols = await chQuery<{ name: string; type: string; comment: string }>(
      `SELECT name, type, comment FROM system.columns WHERE table = '${table}' AND database = currentDatabase() ORDER BY position`
    );

    if (cols.length === 0) {
      return { success: false, error: `Table "${table}" not found or has no columns.` };
    }

    return {
      success: true,
      data: {
        table,
        columns: cols,
        columnCount: cols.length,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
