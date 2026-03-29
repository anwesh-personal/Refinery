import { query } from '../../../db/clickhouse.js';
import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';
import { validateTableName, validateColumnName } from '../../context/schema-registry.js';

// ═══════════════════════════════════════════════════════════
// find_duplicates — Duplicate detection within a dataset
// ═══════════════════════════════════════════════════════════

const findDuplicates: ToolDefinition = {
  name: 'find_duplicates',
  description: 'Find duplicate records within a table or ingested list. Checks for exact email duplicates, same-domain clusters, and same-company groups. Use when the user asks about duplicates, data quality, or deduplication.',
  parameters: {
    type: 'object',
    properties: {
      table: {
        type: 'string',
        description: 'The ClickHouse table to scan (e.g. "leads")',
      },
      source_file: {
        type: 'string',
        description: 'Optional: filter to a specific source_file',
      },
      match_column: {
        type: 'string',
        description: 'Column to check for duplicates. Default: "email". Options: email, domain, company',
      },
      show_examples: {
        type: 'number',
        description: 'Number of duplicate examples to return. Default 10.',
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
      const matchCol = args.match_column || 'email';
      const showExamples = args.show_examples || 10;

      await validateTableName(table);
      await validateColumnName(table, matchCol);

      const where = sourceFile
        ? `WHERE source_file = '${sourceFile.replace(/'/g, "''")}' AND ${matchCol} != '' AND ${matchCol} IS NOT NULL`
        : `WHERE ${matchCol} != '' AND ${matchCol} IS NOT NULL`;

      // 1. Overall duplicate stats
      const statsResult = await query<{ total: string; unique_vals: string; dup_vals: string; dup_rows: string }>(`
        SELECT
          count() as total,
          uniqExact(${matchCol}) as unique_vals,
          count() - uniqExact(${matchCol}) as dup_rows,
          (SELECT count() FROM (SELECT ${matchCol} FROM ${table} ${where} GROUP BY ${matchCol} HAVING count() > 1)) as dup_vals
        FROM ${table} ${where}
      `);

      const stats = statsResult[0] || {};
      const total = parseInt(stats.total || '0');
      const unique = parseInt(stats.unique_vals || '0');
      const dupRows = parseInt(stats.dup_rows || '0');
      const dupValues = parseInt(stats.dup_vals || '0');

      // 2. Duplicate frequency distribution
      const freqResult = await query<{ copies: string; cnt: string }>(`
        SELECT copies, count() as cnt FROM (
          SELECT ${matchCol}, count() as copies FROM ${table} ${where} GROUP BY ${matchCol} HAVING copies > 1
        ) GROUP BY copies ORDER BY copies LIMIT 10
      `);

      const frequency: Record<string, number> = {};
      for (const r of freqResult) {
        frequency[`${r.copies}x`] = parseInt(r.cnt);
      }

      // 3. Top duplicated values with examples
      const selectCols = matchCol === 'email'
        ? `${matchCol}, any(first_name) as first_name, any(last_name) as last_name, any(company) as company`
        : `${matchCol}`;

      const examples = await query<Record<string, any>>(`
        SELECT ${selectCols}, count() as copies
        FROM ${table} ${where}
        GROUP BY ${matchCol}
        HAVING copies > 1
        ORDER BY copies DESC
        LIMIT ${showExamples}
      `);

      return {
        success: true,
        data: {
          table,
          sourceFile: sourceFile || 'all',
          matchColumn: matchCol,
          summary: {
            totalRows: total,
            uniqueValues: unique,
            duplicateValues: dupValues,
            duplicateRows: dupRows,
            duplicateRate: total > 0 ? `${((dupRows / total) * 100).toFixed(1)}%` : '0%',
            deduplicatedCount: unique,
            rowsToRemove: dupRows,
          },
          frequency,
          topDuplicates: examples,
        },
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },
};

export default findDuplicates;
