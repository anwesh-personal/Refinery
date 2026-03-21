import { query } from '../db/clickhouse.js';

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
