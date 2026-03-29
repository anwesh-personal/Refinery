// ═══════════════════════════════════════════════════════════
// System Tool Handlers
// Server health, dashboard stats, pipeline overview
// ═══════════════════════════════════════════════════════════

import type { ToolResult, ToolContext } from '../types.js';
import { query as chQuery, ping as chPing } from '../../../db/clickhouse.js';
import { internalApi } from './_internal.js';

/** Check health of all connected services */
export async function getServerHealth(
  _args: Record<string, never>,
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    const services: Array<{ name: string; status: string; latencyMs: number; details?: string }> = [];

    // ClickHouse health
    const chStart = Date.now();
    const chOk = await chPing();
    services.push({
      name: 'ClickHouse',
      status: chOk ? 'healthy' : 'down',
      latencyMs: Date.now() - chStart,
    });

    // Try fetching server configs for SMTP/S3 health
    try {
      const servers = await internalApi<any>('/api/servers', ctx);
      const list = Array.isArray(servers) ? servers : servers.servers || [];
      for (const s of list) {
        services.push({
          name: `${s.name} (${s.type})`,
          status: s.status || 'unknown',
          latencyMs: 0,
          details: `${s.host}:${s.port}`,
        });
      }
    } catch {}

    return { success: true, data: { services } };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/** Get platform-wide dashboard statistics */
export async function getDashboardStats(
  _args: Record<string, never>,
  _ctx: ToolContext
): Promise<ToolResult> {
  try {
    // Lead counts from ClickHouse — direct query for speed
    let totalLeads = 0, verifiedCount = 0, unverifiedCount = 0;
    try {
      const [counts] = await chQuery<any>(`
        SELECT
          count() as total,
          countIf(verification_status = 'verified' OR verification_status = 'safe') as verified,
          countIf(verification_status = '' OR verification_status IS NULL OR verification_status = 'unverified') as unverified
        FROM universal_person
      `);
      if (counts) {
        totalLeads = Number(counts.total) || 0;
        verifiedCount = Number(counts.verified) || 0;
        unverifiedCount = Number(counts.unverified) || 0;
      }
    } catch {}

    // Recent verification jobs from ClickHouse
    let recentJobs: any[] = [];
    try {
      recentJobs = await chQuery<any>(`
        SELECT id, status, total_emails, safe_count, risky_count, rejected_count,
               uncertain_count, started_at, completed_at
        FROM pipeline_jobs
        ORDER BY started_at DESC
        LIMIT 5
      `);
    } catch {}

    return {
      success: true,
      data: {
        totalLeads,
        verifiedCount,
        unverifiedCount,
        recentJobs: recentJobs.map(j => ({
          id: j.id,
          status: j.status,
          totalEmails: Number(j.total_emails),
          safeCount: Number(j.safe_count),
          riskyCount: Number(j.risky_count),
          startedAt: j.started_at,
          completedAt: j.completed_at,
        })),
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
