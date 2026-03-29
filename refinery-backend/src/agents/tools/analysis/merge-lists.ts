import { query, command } from '../../../db/clickhouse.js';
import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';
import { validateTableName, getTableSchema } from '../../context/schema-registry.js';

// ═══════════════════════════════════════════════════════════
// merge_lists — Merge two lists with configurable dedup strategy
// ═══════════════════════════════════════════════════════════

const mergeLists: ToolDefinition = {
  name: 'merge_lists',
  description: 'Merge two data lists into a unified dataset with deduplication. Supports preview mode (dry run) and execute mode. Use when the user wants to combine, merge, or deduplicate lists.',
  parameters: {
    type: 'object',
    properties: {
      table: {
        type: 'string',
        description: 'The ClickHouse table containing both lists (e.g. "leads")',
      },
      source_a: {
        type: 'string',
        description: 'Source file name for list A',
      },
      source_b: {
        type: 'string',
        description: 'Source file name for list B',
      },
      merge_key: {
        type: 'string',
        description: 'Column to deduplicate on. Default: "email"',
      },
      strategy: {
        type: 'string',
        enum: ['prefer_a', 'prefer_b', 'prefer_newest', 'prefer_filled'],
        description: 'Conflict resolution: prefer_a keeps list A record, prefer_b keeps B, prefer_newest keeps most recent, prefer_filled keeps record with most non-null fields. Default: prefer_filled.',
      },
      output_tag: {
        type: 'string',
        description: 'Tag for the merged output (written to source_file column). Default: "merged_<timestamp>"',
      },
      preview: {
        type: 'boolean',
        description: 'If true, only show what WOULD happen without writing. Default: true.',
      },
    },
    required: ['table', 'source_a', 'source_b'],
  },
  riskLevel: 'write',
  agents: ['data_scientist', 'supervisor'],

  handler: async (args: any, _ctx: ToolContext): Promise<ToolResult> => {
    try {
      const { table, source_a, source_b } = args;
      const mergeKey = args.merge_key || 'email';
      const strategy = args.strategy || 'prefer_filled';
      const preview = args.preview !== false; // default true
      const outputTag = args.output_tag || `merged_${Date.now()}`;

      await validateTableName(table);

      // Idempotency: check if output_tag already exists
      const existingCheck = await query<{ cnt: string }>(
        `SELECT count() as cnt FROM ${table} WHERE source_file = '${outputTag.replace(/'/g, "''")}'`
      );
      if (parseInt(existingCheck[0]?.cnt || '0') > 0) {
        return { success: false, error: `Output tag "${outputTag}" already exists (${existingCheck[0].cnt} rows). Use a different output_tag.` };
      }

      const escA = source_a.replace(/'/g, "''");
      const escB = source_b.replace(/'/g, "''");

      // 1. Get counts
      const counts = await query<{ src: string; cnt: string }>(
        `SELECT source_file as src, count() as cnt FROM ${table} WHERE source_file IN ('${escA}', '${escB}') GROUP BY src`
      );
      let countA = 0, countB = 0;
      for (const r of counts) {
        if (r.src === source_a) countA = parseInt(r.cnt);
        if (r.src === source_b) countB = parseInt(r.cnt);
      }

      // 2. Calculate merge stats
      const overlapResult = await query<{ overlap: string; only_a: string; only_b: string }>(`
        SELECT
          countIf(has_a AND has_b) as overlap,
          countIf(has_a AND NOT has_b) as only_a,
          countIf(NOT has_a AND has_b) as only_b
        FROM (
          SELECT ${mergeKey} as k,
            max(source_file = '${escA}') as has_a,
            max(source_file = '${escB}') as has_b
          FROM ${table}
          WHERE source_file IN ('${escA}', '${escB}') AND ${mergeKey} != ''
          GROUP BY k
        )
      `);

      const overlap = parseInt(overlapResult[0]?.overlap || '0');
      const onlyA = parseInt(overlapResult[0]?.only_a || '0');
      const onlyB = parseInt(overlapResult[0]?.only_b || '0');
      const mergedTotal = onlyA + onlyB + overlap;

      const result: any = {
        preview,
        mergeKey,
        strategy,
        sourceA: { file: source_a, rows: countA },
        sourceB: { file: source_b, rows: countB },
        mergeStats: {
          overlap,
          uniqueToA: onlyA,
          uniqueToB: onlyB,
          mergedTotal,
          removedDuplicates: (countA + countB) - mergedTotal,
        },
      };

      if (preview) {
        result.message = `Preview: merging ${countA} + ${countB} rows → ${mergedTotal} unique records (${overlap} duplicates resolved via ${strategy}). Set preview=false to execute.`;
        return { success: true, data: result };
      }

      // 3. Execute merge — insert deduplicated records with new source_file tag
      // Strategy determines ORDER BY for ROW_NUMBER (which record "wins")
      const schema = await getTableSchema(table);
      const allCols = schema?.columns.map(c => c.name) || [];

      let orderBy: string;
      switch (strategy) {
        case 'prefer_a': orderBy = `source_file = '${escA}' DESC`; break;
        case 'prefer_b': orderBy = `source_file = '${escB}' DESC`; break;
        case 'prefer_newest': orderBy = 'created_at DESC'; break;
        case 'prefer_filled':
        default: {
          // Count non-empty fields per row
          const nonEmptyExprs = allCols
            .filter(c => c !== 'source_file' && c !== 'created_at')
            .map(c => `if(${c} != '' AND ${c} IS NOT NULL, 1, 0)`)
            .join(' + ');
          orderBy = nonEmptyExprs ? `(${nonEmptyExprs}) DESC` : 'created_at DESC';
          break;
        }
      }

      // Get all columns from the table
      const colResult = await query<{ name: string }>(
        `SELECT name FROM system.columns WHERE database = currentDatabase() AND table = '${table}' ORDER BY position`
      );
      const cols = colResult.map(c => c.name);
      const colList = cols.filter(c => c !== 'source_file').join(', ');

      // Insert merged records
      await command(`
        INSERT INTO ${table} (${colList}, source_file)
        SELECT ${colList}, '${outputTag.replace(/'/g, "''")}' as source_file
        FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY ${mergeKey} ORDER BY ${orderBy}) as rn
          FROM ${table}
          WHERE source_file IN ('${escA}', '${escB}')
        )
        WHERE rn = 1
      `);

      // Count what was inserted
      const insertedResult = await query<{ cnt: string }>(
        `SELECT count() as cnt FROM ${table} WHERE source_file = '${outputTag.replace(/'/g, "''")}'`
      );

      result.executed = true;
      result.outputTag = outputTag;
      result.rowsInserted = parseInt(insertedResult[0]?.cnt || '0');
      result.message = `Merge complete: ${result.rowsInserted} records written with source_file="${outputTag}".`;

      return { success: true, data: result };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },
};

export default mergeLists;
