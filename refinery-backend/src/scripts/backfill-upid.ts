/**
 * Backfill up_id for existing universal_person rows that have empty up_id.
 *
 * Rows ingested before the up_id generation fix have up_id = ''.
 * This breaks keyset pagination. This script generates a unique ID for each.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-upid.ts
 *
 * WARNING: This runs a large ALTER TABLE UPDATE on potentially millions of rows.
 *          Run during low-traffic hours.
 *          The operation is idempotent — safe to interrupt and re-run.
 */

import { query, command } from '../db/clickhouse.js';

async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║     up_id Backfill — Refinery Nexus       ║');
  console.log('╚═══════════════════════════════════════════╝');

  // 1. Check how many rows need backfill
  const [countRow] = await query<{ cnt: string }>(
    `SELECT count() as cnt FROM universal_person WHERE up_id = ''`,
    { timeoutMs: 60_000 },
  );
  const rowsToFill = Number(countRow?.cnt || 0);

  if (rowsToFill === 0) {
    console.log('[Backfill] ✓ All rows already have up_id populated. Nothing to do.');
    process.exit(0);
  }

  console.log(`[Backfill] ${rowsToFill.toLocaleString()} rows need up_id generated.`);
  console.log('[Backfill] Starting ALTER TABLE UPDATE...');

  const startTime = Date.now();

  // 2. Generate unique IDs using ClickHouse's generateUUIDv4()
  //    This is the most efficient approach — no round-trips to Node.js
  await command(
    `ALTER TABLE universal_person
     UPDATE up_id = toString(generateUUIDv4())
     WHERE up_id = ''`,
    undefined,
    { timeoutMs: 600_000 }, // 10 min client timeout
  );

  const elapsedSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`[Backfill] ✓ Mutation submitted in ${elapsedSec}s.`);
  console.log('[Backfill] ClickHouse will process the mutation asynchronously.');
  console.log('[Backfill] Monitor progress: SELECT * FROM system.mutations WHERE is_done = 0');
  console.log('[Backfill] Done.');
}

main().catch((e) => {
  console.error('[Backfill] FATAL:', e.message);
  process.exit(1);
});
