import { query } from '../../../db/clickhouse.js';
import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';
import { getTableSchema } from '../../context/schema-registry.js';

// ═══════════════════════════════════════════════════════════
// analyze_list — Comprehensive statistical analysis of any table/list
// ═══════════════════════════════════════════════════════════

const analyzeList: ToolDefinition = {
  name: 'analyze_list',
  description: 'Run a comprehensive analysis on a data table or ingested list. Returns row count, column stats, domain distribution, quality breakdown, duplicate rate, and sample rows. Use this when the user asks to analyze, review, or understand a dataset.',
  parameters: {
    type: 'object',
    properties: {
      table: {
        type: 'string',
        description: 'The ClickHouse table name to analyze (e.g. "leads", "verification_results")',
      },
      source_file: {
        type: 'string',
        description: 'Optional: filter to a specific source_file (ingestion). If provided, only rows from this file are analyzed.',
      },
      limit_sample: {
        type: 'number',
        description: 'Number of sample rows to return. Default 5.',
      },
    },
    required: ['table'],
  },
  riskLevel: 'read',
  agents: ['data_scientist', 'supervisor', 'verification_engineer'],

  handler: async (args: any, _ctx: ToolContext): Promise<ToolResult> => {
    try {
      const table = args.table;
      const sourceFile = args.source_file || null;
      const sampleLimit = args.limit_sample || 5;

      // Validate table exists
      const schema = await getTableSchema(table);
      if (!schema) {
        return { success: false, error: `Table "${table}" not found in ClickHouse.` };
      }

      const whereClause = sourceFile ? `WHERE source_file = '${sourceFile.replace(/'/g, "''")}'` : '';
      const colNames = schema.columns.map(c => c.name);

      // 1. Row count
      const countResult = await query<{ cnt: string }>(`SELECT count() as cnt FROM ${table} ${whereClause}`);
      const rowCount = parseInt(countResult[0]?.cnt || '0');

      if (rowCount === 0) {
        return { success: true, data: { rowCount: 0, message: 'Table/filter has zero rows.' } };
      }

      // 2. Column stats (nulls, distinct counts for key columns)
      const keyColumns = colNames.filter(c =>
        ['email', 'first_name', 'last_name', 'company', 'domain', 'title', 'quality_tier', 'source_file', 'city', 'state', 'country', 'industry'].includes(c)
      );

      const statQueries = keyColumns.map(col =>
        `countIf(${col} != '' AND ${col} IS NOT NULL) as filled_${col}, uniqExact(${col}) as unique_${col}`
      );

      let columnStats: Record<string, any> = {};
      if (statQueries.length > 0) {
        const statsResult = await query<Record<string, string>>(
          `SELECT ${statQueries.join(', ')} FROM ${table} ${whereClause}`
        );
        if (statsResult[0]) {
          for (const col of keyColumns) {
            columnStats[col] = {
              filled: parseInt(statsResult[0][`filled_${col}`] || '0'),
              fillRate: `${((parseInt(statsResult[0][`filled_${col}`] || '0') / rowCount) * 100).toFixed(1)}%`,
              unique: parseInt(statsResult[0][`unique_${col}`] || '0'),
            };
          }
        }
      }

      // 3. Domain distribution (top 15) — if email column exists
      let domainDist: Record<string, number> = {};
      if (colNames.includes('email') || colNames.includes('domain')) {
        const domCol = colNames.includes('domain') ? 'domain' : "splitByChar('@', email)[2]";
        const domResult = await query<{ d: string; cnt: string }>(
          `SELECT ${domCol} as d, count() as cnt FROM ${table} ${whereClause} GROUP BY d ORDER BY cnt DESC LIMIT 15`
        );
        for (const r of domResult) {
          domainDist[r.d] = parseInt(r.cnt);
        }
      }

      // 4. Quality tier breakdown — if quality_tier column exists
      let qualityBreakdown: Record<string, number> = {};
      if (colNames.includes('quality_tier')) {
        const qResult = await query<{ tier: string; cnt: string }>(
          `SELECT quality_tier as tier, count() as cnt FROM ${table} ${whereClause} GROUP BY tier ORDER BY cnt DESC`
        );
        for (const r of qResult) {
          qualityBreakdown[r.tier || 'unknown'] = parseInt(r.cnt);
        }
      }

      // 5. Duplicate rate — if email exists
      let duplicateStats: any = null;
      if (colNames.includes('email')) {
        const dupResult = await query<{ total: string; unique_emails: string; dupes: string }>(
          `SELECT count() as total, uniqExact(email) as unique_emails, count() - uniqExact(email) as dupes FROM ${table} ${whereClause}`
        );
        if (dupResult[0]) {
          const total = parseInt(dupResult[0].total);
          const unique = parseInt(dupResult[0].unique_emails);
          duplicateStats = {
            totalRows: total,
            uniqueEmails: unique,
            duplicates: total - unique,
            duplicateRate: `${(((total - unique) / total) * 100).toFixed(1)}%`,
          };
        }
      }

      // 6. Source file breakdown — if source_file exists and no filter
      let sourceBreakdown: Record<string, number> = {};
      if (colNames.includes('source_file') && !sourceFile) {
        const srcResult = await query<{ src: string; cnt: string }>(
          `SELECT source_file as src, count() as cnt FROM ${table} GROUP BY src ORDER BY cnt DESC LIMIT 10`
        );
        for (const r of srcResult) {
          sourceBreakdown[r.src || 'unknown'] = parseInt(r.cnt);
        }
      }

      // 7. Sample rows
      const sampleCols = keyColumns.length > 0 ? keyColumns.slice(0, 8).join(', ') : '*';
      const samples = await query<Record<string, any>>(
        `SELECT ${sampleCols} FROM ${table} ${whereClause} LIMIT ${sampleLimit}`
      );

      return {
        success: true,
        data: {
          table,
          sourceFile: sourceFile || 'all',
          rowCount,
          columnCount: colNames.length,
          columns: colNames,
          columnStats,
          domainDistribution: domainDist,
          qualityBreakdown,
          duplicateStats,
          sourceBreakdown,
          sampleRows: samples,
        },
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },
};

export default analyzeList;
