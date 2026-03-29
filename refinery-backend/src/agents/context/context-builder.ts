import { query } from '../../db/clickhouse.js';
import { getTableSchema, validateTableName } from './schema-registry.js';

// ═══════════════════════════════════════════════════════════
// Context Builder — Auto-generates rich context for agent injection
// ═══════════════════════════════════════════════════════════

export interface IngestionContext {
  sourceFile: string;
  table: string;
  rowCount: number;
  columns: string[];
  domainDistribution: Record<string, number>;
  qualityBreakdown: Record<string, number>;
  titleDistribution: Record<string, number>;
  industryDistribution: Record<string, number>;
  duplicateRate: string;
  sampleRows: Record<string, any>[];
  generatedAt: string;
}

/**
 * Build rich context for a specific ingestion (source_file).
 * Returns structured data + a prompt-injectable string.
 */
export async function buildIngestionContext(
  table: string,
  sourceFile: string
): Promise<{ context: IngestionContext; promptText: string }> {
  const esc = sourceFile.replace(/'/g, "''");
  const where = `WHERE source_file = '${esc}'`;

  await validateTableName(table);

  // Row count
  const countR = await query<{ cnt: string }>(`SELECT count() as cnt FROM ${table} ${where}`);
  const rowCount = parseInt(countR[0]?.cnt || '0');

  // Columns
  const schema = await getTableSchema(table);
  const columns = schema?.columns.map(c => c.name) || [];

  // Domain distribution (top 15)
  const domainDist: Record<string, number> = {};
  if (columns.includes('domain') || columns.includes('email')) {
    const domCol = columns.includes('domain') ? 'domain' : "splitByChar('@', email)[2]";
    const domR = await query<{ d: string; cnt: string }>(
      `SELECT ${domCol} as d, count() as cnt FROM ${table} ${where} AND ${domCol} != '' GROUP BY d ORDER BY cnt DESC LIMIT 15`
    );
    for (const r of domR) domainDist[r.d] = parseInt(r.cnt);
  }

  // Quality tier breakdown
  const qualityBreakdown: Record<string, number> = {};
  if (columns.includes('quality_tier')) {
    const qR = await query<{ t: string; cnt: string }>(
      `SELECT quality_tier as t, count() as cnt FROM ${table} ${where} GROUP BY t ORDER BY cnt DESC`
    );
    for (const r of qR) qualityBreakdown[r.t || 'unknown'] = parseInt(r.cnt);
  }

  // Title distribution (top 10)
  const titleDist: Record<string, number> = {};
  if (columns.includes('title')) {
    const tR = await query<{ t: string; cnt: string }>(
      `SELECT title as t, count() as cnt FROM ${table} ${where} AND title != '' GROUP BY t ORDER BY cnt DESC LIMIT 10`
    );
    for (const r of tR) titleDist[r.t] = parseInt(r.cnt);
  }

  // Industry distribution (top 10)
  const industryDist: Record<string, number> = {};
  if (columns.includes('industry')) {
    const iR = await query<{ i: string; cnt: string }>(
      `SELECT industry as i, count() as cnt FROM ${table} ${where} AND industry != '' GROUP BY i ORDER BY cnt DESC LIMIT 10`
    );
    for (const r of iR) industryDist[r.i] = parseInt(r.cnt);
  }

  // Duplicate rate
  let duplicateRate = '0%';
  if (columns.includes('email')) {
    const dupR = await query<{ total: string; uniq: string }>(
      `SELECT count() as total, uniqExact(email) as uniq FROM ${table} ${where}`
    );
    if (dupR[0]) {
      const total = parseInt(dupR[0].total);
      const uniq = parseInt(dupR[0].uniq);
      duplicateRate = total > 0 ? `${(((total - uniq) / total) * 100).toFixed(1)}%` : '0%';
    }
  }

  // Sample rows (5) — use first 8 string-type columns dynamically
  const stringCols = (schema?.columns || [])
    .filter(c => c.type.includes('String') || c.type.includes('Nullable(String)'))
    .map(c => c.name)
    .slice(0, 8);
  const sampleCols = stringCols.length > 0 ? stringCols.join(', ') : '*';
  const samples = await query<Record<string, any>>(
    `SELECT ${sampleCols} FROM ${table} ${where} LIMIT 5`
  );

  const context: IngestionContext = {
    sourceFile, table, rowCount, columns,
    domainDistribution: domainDist,
    qualityBreakdown: qualityBreakdown,
    titleDistribution: titleDist,
    industryDistribution: industryDist,
    duplicateRate,
    sampleRows: samples,
    generatedAt: new Date().toISOString(),
  };

  // Build prompt text
  const lines: string[] = [
    `## Ingestion Context: "${sourceFile}"`,
    `- **Table:** ${table}`,
    `- **Rows:** ${rowCount.toLocaleString()}`,
    `- **Columns:** ${columns.length} (${columns.join(', ')})`,
    `- **Duplicate Rate:** ${duplicateRate}`,
  ];

  if (Object.keys(domainDist).length > 0) {
    lines.push('\n### Top Domains');
    for (const [d, c] of Object.entries(domainDist).slice(0, 10)) {
      lines.push(`- ${d}: ${c.toLocaleString()}`);
    }
  }

  if (Object.keys(qualityBreakdown).length > 0) {
    lines.push('\n### Quality Tiers');
    for (const [t, c] of Object.entries(qualityBreakdown)) {
      lines.push(`- ${t}: ${c.toLocaleString()}`);
    }
  }

  if (Object.keys(titleDist).length > 0) {
    lines.push('\n### Top Titles');
    for (const [t, c] of Object.entries(titleDist).slice(0, 5)) {
      lines.push(`- ${t}: ${c}`);
    }
  }

  if (Object.keys(industryDist).length > 0) {
    lines.push('\n### Industries');
    for (const [i, c] of Object.entries(industryDist).slice(0, 5)) {
      lines.push(`- ${i}: ${c}`);
    }
  }

  if (samples.length > 0) {
    lines.push('\n### Sample Records');
    lines.push('```json');
    lines.push(JSON.stringify(samples.slice(0, 3), null, 2));
    lines.push('```');
  }

  return { context, promptText: lines.join('\n') };
}

/**
 * Build context for any table (no source_file filter).
 */
export async function buildTableContext(table: string): Promise<string> {
  const schema = await getTableSchema(table);
  if (!schema) return `Table "${table}" not found.`;

  const countR = await query<{ cnt: string }>(`SELECT count() as cnt FROM ${table}`);
  const rowCount = parseInt(countR[0]?.cnt || '0');

  const lines = [
    `## Table: ${table}`,
    `- **Rows:** ${rowCount.toLocaleString()}`,
    `- **Engine:** ${schema.engine}`,
    `- **Columns:** ${schema.columns.map(c => `${c.name} (${c.type})`).join(', ')}`,
  ];

  return lines.join('\n');
}
