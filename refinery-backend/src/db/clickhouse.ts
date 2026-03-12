import { createClient } from '@clickhouse/client';
import { env } from '../config/env.js';

export const clickhouse = createClient({
  url: env.clickhouse.host,
  username: env.clickhouse.user,
  password: env.clickhouse.password,
  database: env.clickhouse.database,
  clickhouse_settings: {
    async_insert: 1,
    wait_for_async_insert: 1,
  },
});

/** Run a query and return rows as JSON */
export async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const result = await clickhouse.query({ query: sql, format: 'JSONEachRow' });
  return (await result.json()) as T[];
}

/** Run a command (CREATE, INSERT, ALTER, etc.) */
export async function command(sql: string): Promise<void> {
  await clickhouse.command({ query: sql });
}

/** Insert rows in bulk */
export async function insertRows(
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  await clickhouse.insert({
    table,
    values: rows,
    format: 'JSONEachRow',
  });
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
