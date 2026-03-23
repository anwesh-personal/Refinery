import { query, insertRows } from '../db/clickhouse.js';
import { getMtaAdapter } from './mta/index.js';
import type { MTASubscriber } from './mta/adapter.js';

// ═══════════════════════════════════════════════════════════════
// Audience Sync — chunked ClickHouse → MTA pipeline
// Reads leads from a segment, maps columns, and pushes batches
// of 1,000 subscribers to the MTA adapter (MailWizz etc.)
// ═══════════════════════════════════════════════════════════════

export interface ColumnMapping {
  clickhouse_column: string;
  mta_field: string;
}

export interface PushOptions {
  targetListId: string;
  listName: string;
  segmentId: string;
  columnMappings: ColumnMapping[];
  excludeRoleBased?: boolean;
  excludeFreeProviders?: boolean;
  minVerificationScore?: number;
  dedupDays?: number; // skip emails pushed in other lists within N days (default: 7)
}

export interface PushProgress {
  status: 'running' | 'complete' | 'failed';
  message: string;
  total: number;
  pushed: number;
  failed: number;
  mtaListId?: string;
  deduped?: number;  // leads skipped due to cross-list dedup
}

const BATCH_SIZE = 1000;
const DEFAULT_DEDUP_DAYS = 7;

const FREE_PROVIDERS = [
  'gmail.com','yahoo.com','hotmail.com','outlook.com','aol.com',
  'icloud.com','mail.com','zoho.com','protonmail.com','yandex.com',
];

const ROLE_PREFIXES = [
  'info@','admin@','support@','sales@','contact@','hello@',
  'help@','webmaster@','postmaster@','noreply@','no-reply@',
  'billing@','abuse@','security@','office@','hr@','team@',
];

/** Get available ClickHouse columns for mapping */
export async function getAvailableColumns(): Promise<string[]> {
  const rows = await query<{ name: string }>(`DESCRIBE universal_person`);
  return rows.map(r => r.name).filter(n => !n.startsWith('_'));
}

/** Preview leads matching a segment (paginated) */
export async function previewAudience(
  segmentId: string,
  columns: string[],
  opts: { limit?: number; offset?: number; excludeRoleBased?: boolean; excludeFreeProviders?: boolean },
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const safeCols = columns.length > 0
    ? columns.map(c => c.replace(/[^a-zA-Z0-9_]/g, '')).join(', ')
    : 'up_id, first_name, last_name, business_email, company_name, job_title';

  const filters = buildFilters(segmentId, opts.excludeRoleBased, opts.excludeFreeProviders);
  const limit = Math.min(opts.limit || 50, 200);
  const offset = opts.offset || 0;

  const [countResult] = await query<{ cnt: string }>(
    `SELECT count() as cnt FROM universal_person FINAL WHERE ${filters}`,
  );
  const total = Number(countResult?.cnt || 0);

  const rows = await query<Record<string, unknown>>(
    `SELECT ${safeCols} FROM universal_person FINAL WHERE ${filters} LIMIT ${limit} OFFSET ${offset}`,
  );

  return { rows, total };
}

/** Push an audience to the MTA — chunked streaming */
export async function pushToMTA(options: PushOptions): Promise<PushProgress> {
  const adapter = await getMtaAdapter();
  if (!adapter) {
    return { status: 'failed', message: 'No MTA provider configured', total: 0, pushed: 0, failed: 0 };
  }

  // 1. Count total leads (including dedup check)
  const dedupDays = options.dedupDays ?? DEFAULT_DEDUP_DAYS;
  const filters = buildFilters(options.segmentId, options.excludeRoleBased, options.excludeFreeProviders);

  // Get recently pushed emails for dedup
  const recentEmails = dedupDays > 0 ? await getRecentlyPushedEmails(options.targetListId, dedupDays) : new Set<string>();

  const [countResult] = await query<{ cnt: string }>(
    `SELECT count() as cnt FROM universal_person FINAL WHERE ${filters}`,
  );
  const total = Number(countResult?.cnt || 0);

  if (total === 0) {
    return { status: 'failed', message: 'No leads match the segment filters', total: 0, pushed: 0, failed: 0 };
  }

  // 2. Create list in MTA
  let mtaList;
  try {
    mtaList = await adapter.createList(options.listName);
  } catch (e: any) {
    return { status: 'failed', message: `Failed to create MTA list: ${e.message}`, total, pushed: 0, failed: 0 };
  }

  // 3. Build the SELECT columns from mappings
  const selectCols = options.columnMappings.map(m =>
    m.clickhouse_column.replace(/[^a-zA-Z0-9_]/g, ''),
  );
  // Always include business_email for the email field
  if (!selectCols.includes('business_email')) {
    selectCols.unshift('business_email');
  }
  const colString = selectCols.join(', ');

  // 4. Stream in batches
  let pushed = 0;
  let failed = 0;
  let offset = 0;
  let totalDeduped = 0;

  while (offset < total) {
    const batch = await query<Record<string, string>>(
      `SELECT ${colString} FROM universal_person FINAL WHERE ${filters} LIMIT ${BATCH_SIZE} OFFSET ${offset}`,
    );

    if (batch.length === 0) break;

    // Map ClickHouse rows to MTA subscribers
    const subscribers: MTASubscriber[] = batch.map(row => {
      const sub: MTASubscriber = {
        email: row.business_email || '',
      };
      for (const mapping of options.columnMappings) {
        const chCol = mapping.clickhouse_column;
        const mtaField = mapping.mta_field;
        if (row[chCol] !== undefined && row[chCol] !== null && row[chCol] !== '') {
          sub[mtaField] = row[chCol];
        }
      }
      return sub;
    }).filter(s => s.email); // Skip rows with no email

    // Cross-list dedup: remove emails already pushed recently
    const deduped = subscribers.filter(s => !recentEmails.has(s.email.toLowerCase()));
    const dedupSkipped = subscribers.length - deduped.length;

    if (deduped.length > 0) {
      try {
        const result = await adapter.addSubscribers(mtaList.id, deduped);
        pushed += result.added;
        failed += result.failed;
      } catch (e: any) {
        console.error(`[AudienceSync] Batch error at offset ${offset}:`, e.message);
        failed += deduped.length;
      }
    }
    totalDeduped += dedupSkipped;

    offset += BATCH_SIZE;
  }

  // 5. Update target list status
  const targetRows = await query<any>(
    `SELECT * FROM target_lists FINAL WHERE id = '${esc(options.targetListId)}' LIMIT 1`,
  );
  if (targetRows[0]) {
    await insertRows('target_lists', [{
      ...targetRows[0],
      status: 'pushed',
      mta_list_id: mtaList.id,
      mta_provider: adapter.provider,
      pushed_count: pushed,
    }]);
  }

  return {
    status: 'complete',
    message: `Pushed ${pushed.toLocaleString()} to ${adapter.provider}. ${failed} failed. ${totalDeduped} deduped.`,
    total,
    pushed,
    failed,
    mtaListId: mtaList.id,
    deduped: totalDeduped,
  };
}

// ────────────── Helpers ──────────────

function esc(s: string): string {
  return s.replace(/'/g, "\\'");
}

function buildFilters(segmentId: string, excludeRoleBased?: boolean, excludeFreeProviders?: boolean): string {
  const parts: string[] = [
    `has(_segment_ids, '${esc(segmentId)}')`,
    `_verification_status = 'valid'`,
    `business_email IS NOT NULL`,
    `business_email != ''`,
  ];

  // Skip bounced/unsubscribed leads (the feedback loop from Phase 4)
  parts.push(`(_bounced IS NULL OR _bounced = 0)`);
  parts.push(`(_unsubscribed IS NULL OR _unsubscribed = 0)`);

  if (excludeRoleBased) {
    const roleChecks = ROLE_PREFIXES.map(p => `NOT startsWith(lower(business_email), '${p}')`);
    parts.push(`(${roleChecks.join(' AND ')})`);
  }

  if (excludeFreeProviders) {
    const domainChecks = FREE_PROVIDERS.map(d => `NOT endsWith(lower(business_email), '@${d}')`);
    parts.push(`(${domainChecks.join(' AND ')})`);
  }

  return parts.join(' AND ');
}

/**
 * Get emails that were already pushed in other target lists within the dedup window.
 * Returns a Set of lowercase emails for O(1) lookup during streaming.
 */
async function getRecentlyPushedEmails(excludeListId: string, days: number): Promise<Set<string>> {
  try {
    // Get segment IDs of recently pushed target lists (excluding the current one)
    const recentLists = await query<{ segment_id: string }>(
      `SELECT segment_id FROM target_lists FINAL
       WHERE status = 'pushed'
         AND id != '${esc(excludeListId)}'
         AND created_at >= now() - INTERVAL ${days} DAY`,
    );

    if (recentLists.length === 0) return new Set();

    // Collect all emails from those segments
    const segConditions = recentLists.map(l => `has(_segment_ids, '${esc(l.segment_id)}')`).join(' OR ');
    const emails = await query<{ email: string }>(
      `SELECT DISTINCT lower(business_email) as email
       FROM universal_person FINAL
       WHERE (${segConditions})
         AND business_email IS NOT NULL
         AND business_email != ''
       LIMIT 500000`,
    );

    return new Set(emails.map(e => e.email));
  } catch (e: any) {
    console.error('[AudienceSync] Dedup query failed:', e.message);
    return new Set();
  }
}

/** Check dedup overlap for a target list (used by the UI preview) */
export async function checkDedupOverlap(
  segmentId: string,
  targetListId: string,
  days: number = DEFAULT_DEDUP_DAYS,
): Promise<{ total: number; overlap: number; unique: number }> {
  const filters = buildFilters(segmentId);
  const [countResult] = await query<{ cnt: string }>(
    `SELECT count() as cnt FROM universal_person FINAL WHERE ${filters}`,
  );
  const total = Number(countResult?.cnt || 0);

  const recentEmails = await getRecentlyPushedEmails(targetListId, days);

  if (recentEmails.size === 0) {
    return { total, overlap: 0, unique: total };
  }

  // Count how many of the current segment's emails are in the dedup set
  const emails = await query<{ email: string }>(
    `SELECT lower(business_email) as email
     FROM universal_person FINAL
     WHERE ${filters}
     LIMIT 500000`,
  );

  let overlap = 0;
  for (const e of emails) {
    if (recentEmails.has(e.email)) overlap++;
  }

  return { total, overlap, unique: total - overlap };
}
