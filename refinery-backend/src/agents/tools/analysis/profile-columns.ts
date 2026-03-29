import { query } from '../../../db/clickhouse.js';
import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';
import { validateTableName } from '../../context/schema-registry.js';

// ═══════════════════════════════════════════════════════════
// profile_columns — Deep column-level profiling for data quality
// ═══════════════════════════════════════════════════════════

const profileColumns: ToolDefinition = {
  name: 'profile_columns',
  description: 'Deep-profile specific columns in a table: min/max, top values, null rate, patterns, data type distribution. Use when the user asks about specific fields, data quality at the column level, or what values exist in a column.',
  parameters: {
    type: 'object',
    properties: {
      table: {
        type: 'string',
        description: 'ClickHouse table name',
      },
      columns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Columns to profile. Max 5. If omitted, profiles all key columns.',
      },
      source_file: {
        type: 'string',
        description: 'Optional: filter to a specific source file',
      },
      top_n: {
        type: 'number',
        description: 'Number of top values to return per column. Default 10.',
      },
    },
    required: ['table'],
  },
  riskLevel: 'read',
  agents: ['data_scientist', 'supervisor', 'verification_engineer'],

  handler: async (args: any, _ctx: ToolContext): Promise<ToolResult> => {
    try {
      const { table } = args;
      const sourceFile = args.source_file || null;
      const topN = args.top_n || 10;
      const where = sourceFile ? `WHERE source_file = '${sourceFile.replace(/'/g, "''")}'` : '';

      await validateTableName(table);

      // Get columns to profile
      let columns: string[] = args.columns || [];
      if (columns.length === 0) {
        // Auto-detect key columns
        const colResult = await query<{ name: string }>(
          `SELECT name FROM system.columns WHERE database = currentDatabase() AND table = '${table}' ORDER BY position`
        );
        const allCols = colResult.map(c => c.name);
        const priorityCols = ['email', 'first_name', 'last_name', 'company', 'domain', 'title', 'industry', 'city', 'state', 'country', 'quality_tier', 'source_file'];
        columns = allCols.filter(c => priorityCols.includes(c)).slice(0, 5);
        if (columns.length === 0) columns = allCols.slice(0, 5);
      }

      // Get total row count
      const countResult = await query<{ cnt: string }>(`SELECT count() as cnt FROM ${table} ${where}`);
      const totalRows = parseInt(countResult[0]?.cnt || '0');

      if (totalRows === 0) {
        return { success: true, data: { totalRows: 0, message: 'No data.' } };
      }

      // Profile each column
      const profiles: Record<string, any> = {};

      for (const col of columns.slice(0, 5)) {
        // Basic stats
        const stats = await query<Record<string, string>>(`
          SELECT
            count() as total,
            countIf(${col} != '' AND ${col} IS NOT NULL) as filled,
            uniqExact(${col}) as unique_count,
            min(length(toString(${col}))) as min_len,
            max(length(toString(${col}))) as max_len,
            avg(length(toString(${col}))) as avg_len
          FROM ${table} ${where}
        `);

        // Top values
        const topValues = await query<{ val: string; cnt: string }>(`
          SELECT toString(${col}) as val, count() as cnt
          FROM ${table} ${where}
          WHERE ${col} != '' AND ${col} IS NOT NULL
          GROUP BY val ORDER BY cnt DESC LIMIT ${topN}
        `);

        const s = stats[0] || {};
        const filled = parseInt(s.filled || '0');
        profiles[col] = {
          filled,
          fillRate: `${((filled / totalRows) * 100).toFixed(1)}%`,
          nullRate: `${(((totalRows - filled) / totalRows) * 100).toFixed(1)}%`,
          uniqueCount: parseInt(s.unique_count || '0'),
          uniqueRate: `${((parseInt(s.unique_count || '0') / Math.max(filled, 1)) * 100).toFixed(1)}%`,
          minLength: parseInt(s.min_len || '0'),
          maxLength: parseInt(s.max_len || '0'),
          avgLength: parseFloat(parseFloat(s.avg_len || '0').toFixed(1)),
          topValues: topValues.map(r => ({ value: r.val, count: parseInt(r.cnt) })),
        };
      }

      return {
        success: true,
        data: {
          table,
          sourceFile: sourceFile || 'all',
          totalRows,
          columnsProfiled: columns,
          profiles,
        },
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },
};

export default profileColumns;
