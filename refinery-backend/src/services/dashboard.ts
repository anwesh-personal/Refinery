import { query, command } from '../db/clickhouse.js';
import { supabaseAdmin } from './supabaseAdmin.js';

/**
 * One-time backfill: attribute all un-attributed operations to the primary superadmin.
 * Runs idempotently on startup — only updates rows where performed_by IS NULL or 'system'.
 */
export async function backfillUserAttribution(): Promise<void> {
    try {
        // Get the primary superadmin from Supabase profiles
        const { data: admins, error } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, email, role')
            .eq('role', 'superadmin')
            .limit(1);

        if (error || !admins || admins.length === 0) {
            console.log('[Backfill] No superadmin found in profiles, skipping attribution backfill');
            return;
        }

        const admin = admins[0];
        const userId = admin.id;
        const userName = admin.full_name || admin.email || 'Admin';

        // Escape single quotes in name for SQL
        const safeUserName = userName.replace(/'/g, "''");

        const TABLES = [
            'ingestion_jobs',
            'verification_batches',
            'target_lists',
            'segments',
            'queue_jobs',
            'pipeline_jobs',
        ];

        let totalUpdated = 0;
        for (const table of TABLES) {
            try {
                // Count un-attributed rows
                const [countRow] = await query<{ cnt: string }>(`
                    SELECT count() as cnt FROM ${table}
                    WHERE performed_by IS NULL OR performed_by = '' OR performed_by = 'system'
                `);
                const cnt = Number(countRow?.cnt || 0);
                if (cnt === 0) continue;

                // Backfill
                await command(`
                    ALTER TABLE ${table} UPDATE
                        performed_by = '${userId}',
                        performed_by_name = '${safeUserName}'
                    WHERE performed_by IS NULL OR performed_by = '' OR performed_by = 'system'
                `);
                console.log(`[Backfill] ${table}: attributed ${cnt} rows to ${userName} (${userId})`);
                totalUpdated += cnt;
            } catch {
                // Table might not exist yet, skip
            }
        }

        if (totalUpdated > 0) {
            console.log(`[Backfill] ✓ Attributed ${totalUpdated} total operations to ${userName}`);
        } else {
            console.log('[Backfill] ✓ All operations already attributed, nothing to backfill');
        }
    } catch (err: any) {
        console.error('[Backfill] Attribution backfill failed:', err.message);
    }
}


/* ── Dashboard Trends ── */

interface IngestionTrend {
    day: string;
    jobs: string;
    rows: string;
}

interface VerificationTrend {
    day: string;
    batches: string;
    valid: string;
    invalid: string;
    unknown: string;
}

interface SegmentBreakdown {
    name: string;
    lead_count: string;
}

interface RecentActivity {
    type: 'ingestion' | 'verification' | 'segment' | 'target';
    title: string;
    detail: string;
    status: string;
    timestamp: string;
    performedBy: string | null;
}

export async function getIngestionTrends(days = 30): Promise<IngestionTrend[]> {
    return query<IngestionTrend>(`
    SELECT
      toDate(started_at) as day,
      count() as jobs,
      sum(rows_ingested) as rows
    FROM ingestion_jobs
    WHERE started_at >= now() - INTERVAL ${days} DAY
    GROUP BY day
    ORDER BY day
  `);
}

export async function getVerificationTrends(days = 30): Promise<VerificationTrend[]> {
    return query<VerificationTrend>(`
    SELECT
      toDate(started_at) as day,
      count() as batches,
      sum(valid_count) as valid,
      sum(invalid_count) as invalid,
      sum(unknown_count) as unknown
    FROM verification_batches
    WHERE started_at >= now() - INTERVAL ${days} DAY
    GROUP BY day
    ORDER BY day
  `);
}

export async function getSegmentBreakdown(): Promise<SegmentBreakdown[]> {
    try {
        return await query<SegmentBreakdown>(`
      SELECT name, lead_count
      FROM segments FINAL
      WHERE lead_count > 0
      ORDER BY lead_count DESC
      LIMIT 8
    `);
    } catch {
        return [];
    }
}

export async function getRecentActivity(limit = 15): Promise<RecentActivity[]> {
    const activities: RecentActivity[] = [];

    // Recent ingestion jobs
    try {
        const jobs = await query<{
            file_name: string; status: string; rows_ingested: string; started_at: string; performed_by_name: string | null;
        }>(`SELECT file_name, status, rows_ingested, started_at, performed_by_name FROM ingestion_jobs ORDER BY started_at DESC LIMIT ${limit}`);
        for (const j of jobs) {
            activities.push({
                type: 'ingestion',
                title: j.file_name,
                detail: `${Number(j.rows_ingested).toLocaleString()} rows`,
                status: j.status,
                timestamp: j.started_at,
                performedBy: j.performed_by_name || null,
            });
        }
    } catch { /* table may not exist */ }

    // Recent verification batches
    try {
        const batches = await query<{
            segment_id: string; status: string; valid_count: string; invalid_count: string; started_at: string; performed_by_name: string | null;
        }>(`SELECT segment_id, status, valid_count, invalid_count, started_at, performed_by_name FROM verification_batches ORDER BY started_at DESC LIMIT ${limit}`);
        for (const b of batches) {
            activities.push({
                type: 'verification',
                title: `Verification batch`,
                detail: `${Number(b.valid_count).toLocaleString()} valid, ${Number(b.invalid_count).toLocaleString()} invalid`,
                status: b.status,
                timestamp: b.started_at,
                performedBy: b.performed_by_name || null,
            });
        }
    } catch { /* table may not exist */ }

    // Recent target lists
    try {
        const targets = await query<{
            name: string; status: string; email_count: string; created_at: string; performed_by_name: string | null;
        }>(`SELECT name, status, email_count, created_at, performed_by_name FROM target_lists ORDER BY created_at DESC LIMIT ${limit}`);
        for (const t of targets) {
            activities.push({
                type: 'target',
                title: t.name,
                detail: `${Number(t.email_count).toLocaleString()} emails`,
                status: t.status,
                timestamp: t.created_at,
                performedBy: t.performed_by_name || null,
            });
        }
    } catch { /* table may not exist */ }

    // Sort all by timestamp descending
    activities.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return activities.slice(0, limit);
}

/* ── Per-User Operation Stats (for Team Constellation) ── */

interface UserOpRow { performed_by: string; cnt: string }

export interface UserOperationStats {
    userId: string;
    name: string | null;
    ingestions: number;
    verifications: number;
    targets: number;
    totalOps: number;
    lastActive: string | null;
}

export interface TeamOperationStatsResponse {
    perUser: UserOperationStats[];
    totals: { ingestions: number; verifications: number; targets: number; totalOps: number };
}

export async function getUserOperationStats(): Promise<TeamOperationStatsResponse> {
    const map = new Map<string, UserOperationStats>();

    const ensure = (id: string, name: string | null) => {
        if (!map.has(id)) {
            map.set(id, { userId: id, name, ingestions: 0, verifications: 0, targets: 0, totalOps: 0, lastActive: null });
        }
        const entry = map.get(id)!;
        if (name && !entry.name) entry.name = name;
        return entry;
    };

    // Aggregate totals (regardless of who performed them — always accurate)
    const totals = { ingestions: 0, verifications: 0, targets: 0, totalOps: 0 };

    // Ingestions per user
    try {
        const rows = await query<UserOpRow & { name: string; last_at: string }>(`
            SELECT performed_by, argMax(performed_by_name, started_at) as name, count() as cnt, max(started_at) as last_at
            FROM ingestion_jobs
            WHERE performed_by IS NOT NULL AND performed_by != ''
            GROUP BY performed_by
        `);
        for (const r of rows) {
            const s = ensure(r.performed_by, r.name || null);
            s.ingestions = Number(r.cnt);
            if (!s.lastActive || r.last_at > s.lastActive) s.lastActive = r.last_at;
        }
    } catch { /* table may not exist */ }

    // Total ingestions (global count, always works)
    try {
        const [row] = await query<{ cnt: string }>(`SELECT count() as cnt FROM ingestion_jobs`);
        totals.ingestions = Number(row?.cnt || 0);
    } catch { /* */ }

    // Verifications per user
    try {
        const rows = await query<UserOpRow & { name: string; last_at: string }>(`
            SELECT performed_by, argMax(performed_by_name, started_at) as name, count() as cnt, max(started_at) as last_at
            FROM verification_batches
            WHERE performed_by IS NOT NULL AND performed_by != ''
            GROUP BY performed_by
        `);
        for (const r of rows) {
            const s = ensure(r.performed_by, r.name || null);
            s.verifications = Number(r.cnt);
            if (!s.lastActive || r.last_at > s.lastActive) s.lastActive = r.last_at;
        }
    } catch { /* table may not exist */ }

    // Total verifications
    try {
        const [row] = await query<{ cnt: string }>(`SELECT count() as cnt FROM verification_batches`);
        totals.verifications = Number(row?.cnt || 0);
    } catch { /* */ }

    // Targets per user
    try {
        const rows = await query<UserOpRow & { name: string; last_at: string }>(`
            SELECT performed_by, argMax(performed_by_name, created_at) as name, count() as cnt, max(created_at) as last_at
            FROM target_lists
            WHERE performed_by IS NOT NULL AND performed_by != ''
            GROUP BY performed_by
        `);
        for (const r of rows) {
            const s = ensure(r.performed_by, r.name || null);
            s.targets = Number(r.cnt);
            if (!s.lastActive || r.last_at > s.lastActive) s.lastActive = r.last_at;
        }
    } catch { /* table may not exist */ }

    // Total targets
    try {
        const [row] = await query<{ cnt: string }>(`SELECT count() as cnt FROM target_lists`);
        totals.targets = Number(row?.cnt || 0);
    } catch { /* */ }

    // Compute totals
    totals.totalOps = totals.ingestions + totals.verifications + totals.targets;
    for (const s of map.values()) {
        s.totalOps = s.ingestions + s.verifications + s.targets;
    }

    return { perUser: Array.from(map.values()), totals };
}
