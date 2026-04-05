import { createClient } from '@clickhouse/client';
import { env } from '../config/env.js';

// ═══════════════════════════════════════════════════════════
// ClickHouse Client — with mandatory query timeouts
// ═══════════════════════════════════════════════════════════

/** Default timeouts (ms) — prevents any query from hanging the process */
const DEFAULT_QUERY_TIMEOUT_MS = 30_000;   // 30s for SELECT
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000; // 60s for INSERT/ALTER
const DEFAULT_STREAM_TIMEOUT_MS = 120_000; // 120s for CSV exports

export const clickhouse = createClient({
  url: env.clickhouse.host,
  username: env.clickhouse.user,
  password: env.clickhouse.password,
  database: env.clickhouse.database,
  request_timeout: DEFAULT_QUERY_TIMEOUT_MS,
  clickhouse_settings: {
    async_insert: 1,
    wait_for_async_insert: 1,
    max_execution_time: 30,  // Server-side kill after 30s (prevents OOM on bad queries)
  },
});

/** Run a query and return rows as JSON. Default timeout: 30s. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  opts?: { timeoutMs?: number; settings?: Record<string, string | number | boolean> },
): Promise<T[]> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await clickhouse.query({
      query: sql,
      format: 'JSONEachRow',
      abort_signal: controller.signal,
      ...(opts?.settings ? { clickhouse_settings: opts.settings } : {}),
    });
    return (await result.json()) as T[];
  } finally {
    clearTimeout(timer);
  }
}

/** Run a command (CREATE, INSERT, ALTER, etc.). Default timeout: 60s. */
export async function command(
  sql: string,
  settings?: Record<string, string | number | boolean | undefined>,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await clickhouse.command({
      query: sql,
      abort_signal: controller.signal,
      ...(settings ? { clickhouse_settings: settings } : {}),
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Insert rows in bulk. Default timeout: 60s. Pass clickhouse_settings to override server-side limits. */
export async function insertRows(
  table: string,
  rows: Record<string, unknown>[],
  opts?: { timeoutMs?: number; settings?: Record<string, string | number | boolean> },
): Promise<void> {
  if (rows.length === 0) return;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Auto-scale server-side max_execution_time to match client timeout
  // This prevents ClickHouse from killing long-running bulk inserts
  const maxExecTimeSec = Math.ceil(timeoutMs / 1000);
  const mergedSettings = {
    max_execution_time: maxExecTimeSec,
    ...opts?.settings,
  };

  try {
    await clickhouse.insert({
      table,
      values: rows,
      format: 'JSONEachRow',
      abort_signal: controller.signal,
      clickhouse_settings: mergedSettings,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Health check */
export async function ping(): Promise<boolean> {
  try {
    const result = await clickhouse.ping();
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Stream a query result as raw CSV (with header row).
 * Returns a Node.js readable stream — pipe directly to res.
 * Zero memory footprint: ClickHouse generates CSV, Node just tunnels it.
 * Default timeout: 120s.
 */
export async function streamCSV(sql: string, opts?: { timeoutMs?: number }) {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await clickhouse.query({
      query: sql,
      format: 'CSVWithNames',
      abort_signal: controller.signal,
    });
    // Clear timeout only after stream is initiated — the stream itself handles its own lifecycle
    clearTimeout(timer);
    return result.stream();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}
