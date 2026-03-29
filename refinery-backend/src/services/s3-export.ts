import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { query } from '../db/clickhouse.js';
import { getSource, buildClient } from './s3sources.js';
import { getSegment } from './segments.js';
import { validateTableName } from '../agents/context/schema-registry.js';

// ═══════════════════════════════════════════════════════════
// S3 Export — Write verified leads to object storage
// Supports CSV and JSON formats, segment or raw query export
// ═══════════════════════════════════════════════════════════

export interface ExportOptions {
  sourceId: string;           // S3 source ID (from s3_sources table)
  segmentId?: string;         // Export a specific segment
  table?: string;             // OR export from a raw table
  sourceFile?: string;        // Filter by source_file (for table mode)
  columns?: string[];         // Specific columns to export (default: all)
  format?: 'csv' | 'json';   // Output format (default: csv)
  prefix?: string;            // S3 key prefix (default: exports/)
  filename?: string;          // Custom filename (default: auto-generated)
  verifiedOnly?: boolean;     // Only export verified leads (default: true)
}

export interface ExportResult {
  success: boolean;
  bucket: string;
  key: string;
  rowCount: number;
  sizeBytes: number;
  format: string;
  url: string;
  error?: string;
}

const BATCH_SIZE = 10000;

/**
 * Export leads to S3 as CSV or JSON.
 * Supports two modes:
 *   1. Segment mode: export leads matching a segment
 *   2. Table mode: export from a specific table (optionally filtered by source_file)
 */
export async function exportToS3(options: ExportOptions): Promise<ExportResult> {
  const source = await getSource(options.sourceId);
  if (!source) throw new Error(`S3 source "${options.sourceId}" not found`);

  const format = options.format || 'csv';
  const verifiedOnly = options.verifiedOnly !== false;

  // ── Build the query ──
  let selectQuery: string;
  let countQuery: string;

  if (options.segmentId) {
    // Segment mode: export from universal_person
    const seg = await getSegment(options.segmentId);
    if (!seg) throw new Error(`Segment "${options.segmentId}" not found`);

    const escapedId = options.segmentId.replace(/'/g, "\\'");
    const where = [
      `has(_segment_ids, '${escapedId}')`,
      `business_email IS NOT NULL`,
      `business_email != ''`,
    ];
    if (verifiedOnly) where.push(`_verification_status = 'valid'`);

    const cols = options.columns?.length
      ? options.columns.map(c => c.replace(/[^a-zA-Z0-9_]/g, '')).join(', ')
      : '*';

    const whereStr = where.join(' AND ');
    selectQuery = `SELECT ${cols} FROM universal_person FINAL WHERE ${whereStr}`;
    countQuery = `SELECT count() as cnt FROM universal_person FINAL WHERE ${whereStr}`;
  } else if (options.table) {
    // Table mode: export from a specific table
    await validateTableName(options.table);

    const where: string[] = [];
    if (options.sourceFile) {
      where.push(`source_file = '${options.sourceFile.replace(/'/g, "''")}'`);
    }

    const cols = options.columns?.length
      ? options.columns.map(c => c.replace(/[^a-zA-Z0-9_]/g, '')).join(', ')
      : '*';

    const whereStr = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    selectQuery = `SELECT ${cols} FROM ${options.table} ${whereStr}`;
    countQuery = `SELECT count() as cnt FROM ${options.table} ${whereStr}`;
  } else {
    throw new Error('Either segmentId or table must be provided');
  }

  // ── Count total rows ──
  const countResult = await query<{ cnt: string }>(countQuery);
  const totalRows = parseInt(countResult[0]?.cnt || '0');

  if (totalRows === 0) {
    return {
      success: false, bucket: source.bucket, key: '', rowCount: 0,
      sizeBytes: 0, format, url: '', error: 'No rows match the export criteria',
    };
  }

  // ── Stream data in batches and build output ──
  const allRows: Record<string, any>[] = [];
  let offset = 0;

  while (offset < totalRows) {
    const batch = await query<Record<string, any>>(
      `${selectQuery} LIMIT ${BATCH_SIZE} OFFSET ${offset}`
    );
    if (batch.length === 0) break;
    allRows.push(...batch);
    offset += BATCH_SIZE;
  }

  // ── Generate file content ──
  let content: string;
  let contentType: string;

  if (format === 'json') {
    content = JSON.stringify(allRows, null, 2);
    contentType = 'application/json';
  } else {
    content = generateCSV(allRows);
    contentType = 'text/csv';
  }

  // ── Build S3 key ──
  const prefix = (options.prefix || 'exports').replace(/\/$/, '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const label = options.segmentId
    ? `segment_${options.segmentId.slice(0, 8)}`
    : `${options.table}_export`;
  const filename = options.filename || `${label}_${timestamp}.${format}`;
  const key = `${prefix}/${filename}`;

  // ── Upload to S3 ──
  const client = buildClient(source);
  const body = Buffer.from(content, 'utf-8');

  await client.send(new PutObjectCommand({
    Bucket: source.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ContentDisposition: `attachment; filename="${filename}"`,
    Metadata: {
      'exported-at': new Date().toISOString(),
      'row-count': String(allRows.length),
      'source': options.segmentId ? `segment:${options.segmentId}` : `table:${options.table}`,
    },
  }));

  const url = `s3://${source.bucket}/${key}`;

  return {
    success: true,
    bucket: source.bucket,
    key,
    rowCount: allRows.length,
    sizeBytes: body.length,
    format,
    url,
  };
}

/**
 * Generate CSV string from an array of objects.
 * Handles quoting, escaping, and consistent column ordering.
 */
function generateCSV(rows: Record<string, any>[]): string {
  if (rows.length === 0) return '';

  // Use first row's keys as headers
  const headers = Object.keys(rows[0]);
  const lines: string[] = [headers.map(escapeCSVField).join(',')];

  for (const row of rows) {
    const values = headers.map(h => escapeCSVField(String(row[h] ?? '')));
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

/**
 * Escape a CSV field: wrap in quotes if it contains commas, quotes, or newlines.
 */
function escapeCSVField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * List recent exports from an S3 source's exports/ prefix.
 */
export async function listExports(sourceId: string): Promise<Array<{ key: string; size: number; modified: string }>> {
  const { listSourceFiles } = await import('./s3sources.js');
  return listSourceFiles(sourceId, 'exports/');
}
