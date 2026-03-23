// ═══════════════════════════════════════════════════════════════
// Segment Auto-Refresh Scheduler
//
// On server startup, starts a single cron job that runs every
// minute. It checks all segments with schedule_cron set and
// compares against next_run_at to decide what needs re-execution.
//
// This avoids spawning N cron jobs (one per segment) — a single
// scheduler loop handles everything.
// ═══════════════════════════════════════════════════════════════

import cron from 'node-cron';
import { query, insertRows } from '../db/clickhouse.js';
import { executeSegment, getSegment } from './segments.js';
import { syncSegmentToMailwizz } from './mailwizz-sync.js';

interface ScheduledSegment {
  id: string;
  name: string;
  schedule_cron: string;
  next_run_at: string | null;
  last_executed_at: string | null;
  mailwizz_list_id: string | null;
}

/** Parse a cron expression and return the next run Date from `now`. */
function getNextRunDate(cronExpr: string, from: Date = new Date()): Date | null {
  try {
    // For simple crons we predict next run using node-cron's validate + basic math
    // node-cron doesn't expose a "next" API, so we calculate it ourselves for
    // the common patterns we support in the UI:
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return null;

    const [min, hour, dayOfMonth, _month, dayOfWeek] = parts;
    const next = new Date(from);
    next.setSeconds(0, 0);

    if (dayOfWeek !== '*') {
      // Weekly: e.g. "0 6 * * 1" (Monday 6am)
      const targetDay = parseInt(dayOfWeek);
      const daysUntil = (targetDay - next.getDay() + 7) % 7 || 7;
      next.setDate(next.getDate() + daysUntil);
      next.setHours(parseInt(hour) || 0, parseInt(min) || 0);
    } else if (dayOfMonth !== '*') {
      // Monthly: e.g. "0 6 1 * *" (1st of month, 6am)
      next.setMonth(next.getMonth() + 1);
      next.setDate(parseInt(dayOfMonth));
      next.setHours(parseInt(hour) || 0, parseInt(min) || 0);
    } else {
      // Daily: e.g. "0 6 * * *" (6am daily)
      next.setDate(next.getDate() + 1);
      next.setHours(parseInt(hour) || 0, parseInt(min) || 0);
    }

    return next;
  } catch {
    return null;
  }
}

/** Update a segment's next_run_at timestamp */
async function updateNextRun(segId: string, nextRun: Date | null): Promise<void> {
  const seg = await getSegment(segId);
  if (!seg) return;

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const nextStr = nextRun ? nextRun.toISOString().replace('T', ' ').slice(0, 19) : null;

  await insertRows('segments', [{
    id: seg.id,
    name: seg.name,
    niche: seg.niche,
    client_name: seg.client_name,
    filter_query: seg.filter_query,
    lead_count: seg.lead_count,
    status: seg.status,
    schedule_cron: seg.schedule_cron,
    last_executed_at: seg.last_executed_at,
    next_run_at: nextStr,
    mailwizz_list_id: seg.mailwizz_list_id ?? null,
    last_synced_at: seg.last_synced_at ?? null,
    sync_status: seg.sync_status ?? null,
    sync_count: seg.sync_count ?? null,
    created_at: seg.created_at,
    updated_at: now,
  }]);
}

/** The heartbeat — runs every minute, checks what's due */
async function tick(): Promise<void> {
  try {
    const now = new Date();
    const segments = await query<ScheduledSegment>(
      `SELECT id, name, schedule_cron, next_run_at, last_executed_at, mailwizz_list_id
       FROM segments FINAL
       WHERE schedule_cron IS NOT NULL AND schedule_cron != ''
       ORDER BY next_run_at ASC`
    );

    for (const seg of segments) {
      // If next_run_at is not set, compute it and skip this cycle
      if (!seg.next_run_at) {
        const next = getNextRunDate(seg.schedule_cron, now);
        if (next) await updateNextRun(seg.id, next);
        continue;
      }

      const nextRun = new Date(seg.next_run_at);
      if (now < nextRun) continue; // Not yet due

      // Execute
      console.log(`[Scheduler] ⏰ Auto-executing segment "${seg.name}" (${seg.id})`);
      try {
        const count = await executeSegment(seg.id);
        console.log(`[Scheduler] ✓ Segment "${seg.name}" executed — ${count} leads tagged`);

        // Auto-sync to MailWizz if previously synced (has a list ID)
        if (seg.mailwizz_list_id) {
          try {
            const sync = await syncSegmentToMailwizz(seg.id);
            console.log(`[Scheduler] ✓ Auto-synced "${seg.name}" to MailWizz — ${sync.synced} subscribers`);
          } catch (syncErr: any) {
            console.warn(`[Scheduler] ⚠ Auto-sync failed for "${seg.name}":`, syncErr.message);
          }
        }
      } catch (err: any) {
        console.error(`[Scheduler] ✗ Segment "${seg.name}" failed:`, err.message);
      }

      // Compute and set next run
      const next = getNextRunDate(seg.schedule_cron, now);
      await updateNextRun(seg.id, next);
    }
  } catch (err: any) {
    console.error('[Scheduler] Tick error:', err.message);
  }
}

/** Start the scheduler — call once at server boot */
export function startSegmentScheduler(): void {
  // Run every minute
  cron.schedule('* * * * *', () => {
    tick();
  });
  console.log('[Scheduler] ✓ Segment auto-refresh scheduler started (checks every minute)');
}
