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

/**
 * Sanitize an error message for safe embedding in ClickHouse SQL strings.
 * - Strips control characters that could break protocol framing
 * - Truncates to maxLen to prevent oversized ALTER TABLE payloads
 * - Escapes via esc() AFTER sanitization to prevent nested-escape attacks
 *
 * Use this instead of raw esc(err.message) in ALTER TABLE UPDATE statements.
 */
export function safeErrorMessage(msg: unknown, maxLen = 500): string {
  const raw = String(msg ?? 'Unknown error');
  // Strip control chars (keep printable ASCII + common unicode)
  const cleaned = raw.replace(/[\x00-\x1F\x7F]/g, ' ');
  // Truncate
  const truncated = cleaned.length > maxLen
    ? cleaned.substring(0, maxLen) + '...'
    : cleaned;
  return esc(truncated);
}
