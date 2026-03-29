import { query } from '../../../db/clickhouse.js';
import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';

// ═══════════════════════════════════════════════════════════
// compare_lists — Cross-list overlap and difference analysis
// ═══════════════════════════════════════════════════════════

const compareLists: ToolDefinition = {
  name: 'compare_lists',
  description: 'Compare two data lists/tables to find overlaps, unique records, and common denominators. Use when the user wants to compare, cross-reference, or check overlap between two datasets.',
  parameters: {
    type: 'object',
    properties: {
      table: {
        type: 'string',
        description: 'The ClickHouse table containing both lists (e.g. "leads")',
      },
      source_a: {
        type: 'string',
        description: 'Source file name or identifier for list A',
      },
      source_b: {
        type: 'string',
        description: 'Source file name or identifier for list B',
      },
      match_keys: {
        type: 'array',
        items: { type: 'string' },
        description: 'Columns to match on. Default: ["email"]. Options: email, domain, company, first_name+last_name',
      },
    },
    required: ['table', 'source_a', 'source_b'],
  },
  riskLevel: 'read',
  agents: ['data_scientist', 'supervisor'],

  handler: async (args: any, _ctx: ToolContext): Promise<ToolResult> => {
    try {
      const { table, source_a, source_b } = args;
      const matchKeys: string[] = args.match_keys || ['email'];
      const escA = source_a.replace(/'/g, "''");
      const escB = source_b.replace(/'/g, "''");

      const results: any = { table, sourceA: source_a, sourceB: source_b, matchKeys };

      // 1. Counts per list
      const counts = await query<{ src: string; cnt: string }>(
        `SELECT source_file as src, count() as cnt FROM ${table} WHERE source_file IN ('${escA}', '${escB}') GROUP BY src`
      );
      results.countA = 0;
      results.countB = 0;
      for (const r of counts) {
        if (r.src === source_a) results.countA = parseInt(r.cnt);
        if (r.src === source_b) results.countB = parseInt(r.cnt);
      }

      // 2. Overlap analysis per match key
      results.overlaps = {};
      for (const key of matchKeys) {
        const col = key === 'name' ? "concat(first_name, ' ', last_name)" : key;

        const overlapResult = await query<{ overlap: string; only_a: string; only_b: string }>(`
          SELECT
            countIf(has_a AND has_b) as overlap,
            countIf(has_a AND NOT has_b) as only_a,
            countIf(NOT has_a AND has_b) as only_b
          FROM (
            SELECT
              ${col} as k,
              max(source_file = '${escA}') as has_a,
              max(source_file = '${escB}') as has_b
            FROM ${table}
            WHERE source_file IN ('${escA}', '${escB}') AND ${col} != '' AND ${col} IS NOT NULL
            GROUP BY k
          )
        `);

        if (overlapResult[0]) {
          const overlap = parseInt(overlapResult[0].overlap);
          const onlyA = parseInt(overlapResult[0].only_a);
          const onlyB = parseInt(overlapResult[0].only_b);
          const total = overlap + onlyA + onlyB;

          results.overlaps[key] = {
            overlap,
            onlyInA: onlyA,
            onlyInB: onlyB,
            overlapRate: total > 0 ? `${((overlap / total) * 100).toFixed(1)}%` : '0%',
          };
        }
      }

      // 3. Domain overlap (top shared domains)
      const domainOverlap = await query<{ d: string; in_a: string; in_b: string }>(`
        SELECT
          domain as d,
          countIf(source_file = '${escA}') as in_a,
          countIf(source_file = '${escB}') as in_b
        FROM ${table}
        WHERE source_file IN ('${escA}', '${escB}') AND domain != ''
        GROUP BY domain
        HAVING in_a > 0 AND in_b > 0
        ORDER BY (in_a + in_b) DESC
        LIMIT 15
      `).catch(() => []);

      results.sharedDomains = domainOverlap.map(r => ({
        domain: r.d,
        inA: parseInt(r.in_a),
        inB: parseInt(r.in_b),
      }));

      // 4. Merge recommendation
      const emailOverlap = results.overlaps.email;
      if (emailOverlap) {
        const rate = parseFloat(emailOverlap.overlapRate);
        if (rate > 50) {
          results.recommendation = 'HIGH OVERLAP — These lists are largely the same audience. Merge with email-based dedup.';
        } else if (rate > 20) {
          results.recommendation = 'MODERATE OVERLAP — Significant shared audience. Merge and dedup to avoid duplicate outreach.';
        } else {
          results.recommendation = 'LOW OVERLAP — These are distinct audiences. Safe to use separately or merge for broader reach.';
        }
      }

      return { success: true, data: results };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },
};

export default compareLists;
