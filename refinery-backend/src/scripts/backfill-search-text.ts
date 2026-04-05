/**
 * Backfill _search_text for existing universal_person rows.
 *
 * This script populates the _search_text column for rows ingested before
 * the search index was added. It's a one-time operation — safe to re-run
 * (only touches rows where _search_text is empty).
 *
 * Usage:
 *   npx tsx src/scripts/backfill-search-text.ts
 *
 * WARNING: This runs a large ALTER TABLE UPDATE on potentially 100M+ rows.
 *          Run during low-traffic hours. ClickHouse merge pressure will spike.
 *          The operation is idempotent — safe to interrupt and re-run.
 */

import { query, command } from '../db/clickhouse.js';

// Same columns used by the ingestion pipeline's buildSearchText()
// Keep in sync with SEARCH_TEXT_COLUMNS in ingestion.ts
const SEARCH_TEXT_COLUMNS = [
  'first_name', 'last_name',
  'company_name', 'company_domain',
  'job_title', 'job_title_normalized',
  'personal_city', 'personal_state',
  'professional_city', 'professional_state',
  'primary_industry', 'department',
];

async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║  _search_text Backfill — Refinery Nexus   ║');
  console.log('╚═══════════════════════════════════════════╝');

  // 1. Check how many rows need backfill
  const [countRow] = await query<{ cnt: string }>(
    `SELECT count() as cnt FROM universal_person WHERE _search_text = ''`,
    { timeoutMs: 60_000 },
  );
  const rowsToFill = Number(countRow?.cnt || 0);

  if (rowsToFill === 0) {
    console.log('[Backfill] ✓ All rows already have _search_text populated. Nothing to do.');
    process.exit(0);
  }

  const [totalRow] = await query<{ cnt: string }>(
    `SELECT count() as cnt FROM universal_person`,
    { timeoutMs: 60_000 },
  );
  const totalRows = Number(totalRow?.cnt || 0);

  console.log(`[Backfill] ${rowsToFill.toLocaleString()} / ${totalRows.toLocaleString()} rows need _search_text populated.`);

  // 2. Build the concat expression from the curated column set
  //    Result: lower(coalesce(first_name, '')) || ' ' || lower(coalesce(last_name, '')) || ...
  //    Matches the ingestion-time buildSearchText() output.
  const concatParts = SEARCH_TEXT_COLUMNS.map(
    col => `lower(coalesce(toString(\`${col}\`), ''))`,
  );
  const concatExpr = `arrayStringConcat(arrayFilter(x -> x != '', [${concatParts.join(', ')}]), ' ')`;

  console.log(`[Backfill] Columns: ${SEARCH_TEXT_COLUMNS.join(', ')}`);
  console.log('[Backfill] Starting ALTER TABLE UPDATE...');
  console.log('[Backfill] This may take several minutes for large tables. ClickHouse handles it asynchronously.');

  const startTime = Date.now();

  // 3. Run the mutation — ClickHouse processes it asynchronously
  //    We use a long timeout since this touches potentially 100M+ rows
  await command(
    `ALTER TABLE universal_person
     UPDATE _search_text = ${concatExpr}
     WHERE _search_text = ''`,
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
