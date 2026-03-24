// ═══════════════════════════════════════════════════════════════
// Re-Verification Scheduler
//
// Runs alongside the segment scheduler. Checks for segments flagged
// for auto re-verification (reverify_enabled = 1) and triggers a
// new verification batch for leads whose _verified_at is older
// than reverify_days_threshold.
//
// Flow:
// 1. Query segments with reverify_enabled = 1
// 2. For each, check if it has leads with stale verifications
// 3. Reset _verification_status on stale leads
// 4. Fire a new verification batch using the configured engine
//
// This ensures email quality stays fresh without manual intervention.
// ═══════════════════════════════════════════════════════════════

import cron from 'node-cron';
import { query, command } from '../db/clickhouse.js';
import { startBatch } from './verification.js';

interface ReverifySegment {
  id: string;
  name: string;
  reverify_engine: string;
  reverify_days_threshold: number;
  reverify_last_run_at: string | null;
}

/** Check how many stale leads exist in a segment */
async function countStaleLeads(segmentId: string, daysOld: number): Promise<number> {
  const [result] = await query<{ cnt: string }>(`
    SELECT count() as cnt FROM universal_person
    WHERE has(_segment_ids, '${segmentId}')
      AND _verification_status IS NOT NULL
      AND _verified_at < now() - INTERVAL ${daysOld} DAY
      AND (business_email IS NOT NULL OR personal_emails IS NOT NULL)
  `);
  return Number(result?.cnt || 0);
}

/** Reset stale verifications so they can be re-verified */
async function resetStaleVerifications(segmentId: string, daysOld: number): Promise<number> {
  const staleCount = await countStaleLeads(segmentId, daysOld);
  if (staleCount === 0) return 0;

  await command(`
    ALTER TABLE universal_person UPDATE
      _verification_status = NULL,
      _verified_at = NULL,
      _v550_category = NULL
    WHERE has(_segment_ids, '${segmentId}')
      AND _verification_status IS NOT NULL
      AND _verified_at < now() - INTERVAL ${daysOld} DAY
      AND (business_email IS NOT NULL OR personal_emails IS NOT NULL)
  `);

  return staleCount;
}

/** Mark that a re-verification ran */
async function updateReverifyTimestamp(segmentId: string): Promise<void> {
  await command(`
    ALTER TABLE segments UPDATE
      reverify_last_run_at = now()
    WHERE id = '${segmentId}'
  `);
}

/** The re-verify tick — runs every 30 minutes */
async function reverifyTick(): Promise<void> {
  try {
    const segments = await query<ReverifySegment>(`
      SELECT id, name, reverify_engine, reverify_days_threshold, reverify_last_run_at
      FROM segments FINAL
      WHERE reverify_enabled = 1
        AND reverify_days_threshold > 0
    `);

    if (segments.length === 0) return;

    const now = new Date();

    for (const seg of segments) {
      // Skip if re-verified in the last 24 hours (prevent rapid re-triggers)
      if (seg.reverify_last_run_at) {
        const lastRun = new Date(seg.reverify_last_run_at);
        const hoursSince = (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60);
        if (hoursSince < 24) continue;
      }

      const staleCount = await countStaleLeads(seg.id, seg.reverify_days_threshold);
      if (staleCount === 0) {
        console.log(`[ReVerify] Segment "${seg.name}": no stale leads (threshold: ${seg.reverify_days_threshold}d)`);
        continue;
      }

      console.log(`[ReVerify] Segment "${seg.name}": ${staleCount} stale leads (>${seg.reverify_days_threshold}d old). Resetting...`);

      // Reset stale verifications
      const resetCount = await resetStaleVerifications(seg.id, seg.reverify_days_threshold);
      console.log(`[ReVerify] Reset ${resetCount} stale verifications for "${seg.name}"`);

      // Start a new verification batch
      const engine = (seg.reverify_engine === 'builtin' ? 'builtin' : 'verify550') as 'verify550' | 'builtin';
      try {
        const batchId = await startBatch(seg.id, engine, undefined, 'Auto Re-Verify');
        console.log(`[ReVerify] ✓ Started batch ${batchId} for "${seg.name}" using ${engine}`);
      } catch (err: any) {
        console.error(`[ReVerify] ✗ Failed to start batch for "${seg.name}": ${err.message}`);
      }

      await updateReverifyTimestamp(seg.id);
    }
  } catch (err: any) {
    console.error('[ReVerify] Tick error:', err.message);
  }
}

/** Start the re-verification scheduler — call once at server boot */
export function startReverifyScheduler(): void {
  // Run every 30 minutes
  cron.schedule('*/30 * * * *', () => {
    reverifyTick();
  });
  console.log('[ReVerify] ✓ Re-verification scheduler started (checks every 30 min)');
}

/** Manual trigger for testing / admin use */
export async function triggerReverify(segmentId: string, daysThreshold: number, engine: 'verify550' | 'builtin' = 'verify550'): Promise<{
  staleCount: number;
  resetCount: number;
  batchId: string | null;
}> {
  const staleCount = await countStaleLeads(segmentId, daysThreshold);
  if (staleCount === 0) {
    return { staleCount: 0, resetCount: 0, batchId: null };
  }

  const resetCount = await resetStaleVerifications(segmentId, daysThreshold);
  let batchId: string | null = null;
  try {
    batchId = await startBatch(segmentId, engine, undefined, 'Manual Re-Verify');
  } catch (err: any) {
    console.error(`[ReVerify] Manual trigger failed: ${err.message}`);
  }

  return { staleCount, resetCount, batchId };
}
