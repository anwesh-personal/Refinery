/**
 * Shared sanitization and escaping utilities for ClickHouse queries
 * and raw data ingestion.
 *
 * Single source of truth — imported by ingestion, ingestion-rules, s3sources, routes.
 */

/** Escape a string for safe inclusion in a ClickHouse single-quoted SQL literal.
 *  Handles backslashes first, then quotes. */
export function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Sanitize a raw value from a parsed data row (CSV, Parquet, etc.)
 * for safe insertion into ClickHouse via JSONEachRow.
 *
 * - null/undefined → null
 * - Buffer/Uint8Array → null (binary garbage from corrupted fields)
 * - Strings → null bytes stripped, empty strings → null
 * - Control characters (ESC, BEL, etc.) → null (binary garbage from INT96 timestamps)
 *   Excludes tab (0x09), newline (0x0A), carriage return (0x0D) which are valid text.
 */
const CONTROL_CHARS = /[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/;

export function sanitizeValue(val: unknown): string | null {
  if (val == null) return null;

  // Binary buffers (e.g. corrupted parquet timestamps)
  if (Buffer.isBuffer(val) || val instanceof Uint8Array) return null;

  const str = String(val).replace(/\0/g, '');
  if (!str) return null;

  // Residual control characters after null-stripping = binary garbage (INT96, etc.)
  if (CONTROL_CHARS.test(str)) return null;

  return str;
}

/**
 * Format a Date into ClickHouse DateTime string: 'YYYY-MM-DD HH:MM:SS'
 */
export function toClickHouseDateTime(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
