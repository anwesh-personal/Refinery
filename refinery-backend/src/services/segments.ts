import { query, command, insertRows } from '../db/clickhouse.js';
import { genId } from '../utils/helpers.js';
import { getConfigInt, CONFIG_KEYS } from './config.js';

export interface SegmentInput {
  name: string;
  niche?: string;
  clientName?: string;
  filterQuery: string;
  performedByName?: string;
  scheduleCron?: string | null;
}

interface SegmentRow {
  id: string;
  name: string;
  niche: string | null;
  client_name: string | null;
  filter_query: string;
  lead_count: number;
  status: string;
  created_at: string;
  updated_at: string;
  performed_by_name: string | null;
  schedule_cron: string | null;
  last_executed_at: string | null;
  next_run_at: string | null;
  mailwizz_list_id: string | null;
  last_synced_at: string | null;
  sync_status: string | null;
  sync_count: number | null;
}

// ═══════════════════════════════════════════════════════════════
// Filter Query Validation
//
// Before running any user-provided WHERE clause against ClickHouse,
// we validate it with a dry-run EXPLAIN. This catches:
//   - Unquoted string values (primary_industry = finance)
//   - Syntax errors (missing operators, mismatched parens)
//   - Invalid column names
//   - SQL injection attempts
//
// The query is NEVER executed — only parsed and validated.
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// Auto-fix: attempt to quote unquoted bare string values
// e.g. primary_industry = finance  →  primary_industry = 'finance'
// e.g. state IN (TX, CA)           →  state IN ('TX', 'CA')
// This is best-effort — complex expressions may not be fully fixed.
// ═══════════════════════════════════════════════════════════════

function tryAutoFixFilterQuery(sql: string): string | null {
  let fixed = sql;
  let changed = false;

  // Fix: col = bareword_or_multi_word (stops at AND/OR/end/closing paren)
  // Handles: col = finance  AND  col = business finance  AND  col = New York
  fixed = fixed.replace(
    /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(=|!=|<>)\s*([a-zA-Z][a-zA-Z0-9 _-]*?)(?=\s*(AND\b|OR\b|LIMIT\b|ORDER\b|GROUP\b|HAVING\b|\)|$))/gi,
    (_match, col, op, val) => {
      const trimVal = val.trimEnd();
      // Don't quote SQL keywords or already-quoted values
      if (/^(NULL|TRUE|FALSE|IS|NOT|AND|OR|IN|LIKE|BETWEEN)$/i.test(trimVal)) return _match;
      if (/^\d+(\.\d+)?$/.test(trimVal)) return _match; // number
      if (/^'.*'$/.test(trimVal)) return _match;         // already quoted
      changed = true;
      return `${col} ${op} '${trimVal.replace(/'/g, "''")}'`;
    }
  );

  // Fix: col IN (a, b, c) — quote each unquoted element
  fixed = fixed.replace(
    /\b([a-zA-Z_][a-zA-Z0-9_]*)\s+IN\s*\(([^)]+)\)/gi,
    (_match, col, list) => {
      const items = list.split(',').map((item: string) => {
        const t = item.trim();
        if (/^'.*'$/.test(t)) return t;
        if (/^\d+(\.\d+)?$/.test(t)) return t;
        if (/^(NULL|TRUE|FALSE)$/i.test(t)) return t;
        changed = true;
        return `'${t.replace(/'/g, "''")}'`;
      });
      return `${col} IN (${items.join(', ')})`;
    }
  );

  return changed ? fixed : null;
}


async function validateFilterQuery(filterQuery: string): Promise<{ valid: boolean; error?: string; suggestion?: string }> {
  const trimmed = filterQuery.trim();
  if (!trimmed) return { valid: false, error: 'Filter query is empty' };

  // Block dangerous operations
  const dangerous = /\b(DROP|TRUNCATE|ALTER|CREATE|INSERT|DELETE|ATTACH|DETACH|RENAME|GRANT|REVOKE)\b/i;
  if (dangerous.test(trimmed)) {
    return { valid: false, error: 'Filter query contains disallowed operations' };
  }

  // Dry-run with EXPLAIN to parse without executing
  try {
    await query(`EXPLAIN SELECT 1 FROM universal_person WHERE ${trimmed} LIMIT 0`);
    return { valid: true };
  } catch (e: any) {
    // Extract useful error from ClickHouse's verbose message
    const msg = String(e.message || '');

    // Common: unquoted string value
    if (msg.includes('Expected one of:') || msg.includes('Syntax error')) {
      // Try to auto-fix the query and suggest it to the user
      const suggestion = tryAutoFixFilterQuery(trimmed);
      return {
        valid: false,
        error: `Syntax error in filter query. Make sure string values are quoted: e.g. primary_industry = 'finance' (not primary_industry = finance). Full error: ${msg.substring(0, 200)}`,
        suggestion: suggestion || undefined,
      };
    }

    // Unknown column
    if (msg.includes('Missing columns') || msg.includes('Unknown identifier')) {
      return {
        valid: false,
        error: `Unknown column in filter query. ${msg.substring(0, 200)}`,
      };
    }

    return { valid: false, error: `Invalid filter query: ${msg.substring(0, 300)}` };
  }
}

/** Exported for use in routes (live validation endpoint) */
export async function validateSegmentFilter(filterQuery: string) {
  return validateFilterQuery(filterQuery);
}

/** Create a new segment */
export async function createSegment(input: SegmentInput, performedBy?: string, performedByName?: string): Promise<string> {
  // Validate filter before persisting
  const validation = await validateFilterQuery(input.filterQuery);
  if (!validation.valid) {
    const err: any = new Error(validation.error);
    err.suggestion = validation.suggestion;
    throw err;
  }

  const id = genId();

  await insertRows('segments', [{
    id,
    name: input.name,
    niche: input.niche || null,
    client_name: input.clientName || null,
    filter_query: input.filterQuery,
    status: 'draft',
    ...(performedBy ? { performed_by: performedBy } : {}),
    ...(performedByName ? { performed_by_name: performedByName } : {}),
  }]);

  return id;
}

/** List all segments */
export async function listSegments(): Promise<SegmentRow[]> {
  return query<SegmentRow>('SELECT * FROM segments FINAL ORDER BY created_at DESC');
}

/** Get a single segment by ID */
export async function getSegment(id: string): Promise<SegmentRow | null> {
  const escaped = id.replace(/'/g, "\\'");
  const rows = await query<SegmentRow>(`SELECT * FROM segments FINAL WHERE id = '${escaped}' LIMIT 1`);
  return rows[0] || null;
}

/** Fast live count for a filter query — used by frontend while building */
export async function liveCount(filterQuery: string): Promise<number> {
  const validation = await validateFilterQuery(filterQuery);
  if (!validation.valid) throw new Error(validation.error);
  const [r] = await query<{ cnt: string }>(`SELECT count() as cnt FROM universal_person WHERE ${filterQuery}`);
  return Number(r?.cnt || 0);
}

/** Preview a segment — returns the count of matching leads WITHOUT saving */
export async function previewSegment(filterQuery: string): Promise<{ count: number; sample: Record<string, unknown>[] }> {
  // Validate first
  const validation = await validateFilterQuery(filterQuery);
  if (!validation.valid) {
    const err: any = new Error(validation.error);
    err.suggestion = validation.suggestion;
    throw err;
  }

  // Count
  const [countResult] = await query<{ cnt: string }>(
    `SELECT count() as cnt FROM universal_person WHERE ${filterQuery}`,
  );
  const count = Number(countResult?.cnt || 0);

  // Sample
  const sample = await query(
    `SELECT up_id, first_name, last_name, business_email, personal_emails, personal_state, primary_industry, company_name, job_title_normalized
     FROM universal_person WHERE ${filterQuery} LIMIT 10`,
  );

  return { count, sample };
}

/** Execute a segment — tag matching rows with the segment ID */
export async function executeSegment(id: string): Promise<number> {
  const seg = await getSegment(id);
  if (!seg) throw new Error(`Segment ${id} not found`);

  const filterQuery = seg.filter_query;

  // Re-validate (filter may have been created before validation was added)
  const validation = await validateFilterQuery(filterQuery);
  if (!validation.valid) {
    const err: any = new Error(`Segment has invalid filter query: ${validation.error}`);
    err.suggestion = validation.suggestion;
    throw err;
  }

  // Count first
  const [countResult] = await query<{ cnt: string }>(
    `SELECT count() as cnt FROM universal_person WHERE ${filterQuery}`,
  );
  const count = Number(countResult?.cnt || 0);

  const escapedId = id.replace(/'/g, "\\'");

  // Step 1: Remove stale tags — rows previously tagged but no longer matching
  await command(`
    ALTER TABLE universal_person UPDATE
      _segment_ids = arrayFilter(x -> x != '${escapedId}', _segment_ids)
    WHERE has(_segment_ids, '${escapedId}')
      AND NOT (${filterQuery})
  `);

  // Step 2: Tag new matches (skip already-tagged)
  await command(`
    ALTER TABLE universal_person UPDATE
      _segment_ids = arrayConcat(_segment_ids, ['${escapedId}'])
    WHERE ${filterQuery}
      AND NOT has(_segment_ids, '${escapedId}')
  `);

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Update segment with count and status
  await insertRows('segments', [{
    id,
    name: seg.name,
    niche: seg.niche,
    client_name: seg.client_name,
    filter_query: filterQuery,
    lead_count: count,
    status: 'active',
    schedule_cron: seg.schedule_cron ?? null,
    last_executed_at: now,
    next_run_at: seg.next_run_at ?? null,
    mailwizz_list_id: seg.mailwizz_list_id ?? null,
    last_synced_at: seg.last_synced_at ?? null,
    sync_status: seg.sync_status ?? null,
    sync_count: seg.sync_count ?? null,
    created_at: seg.created_at,
    updated_at: now,
  }]);

  return count;
}

/** Update a segment (uses ReplacingMergeTree dedup) */
export async function updateSegment(id: string, input: Partial<SegmentInput>): Promise<void> {
  const seg = await getSegment(id);
  if (!seg) throw new Error(`Segment ${id} not found`);

  // Validate new filter if provided
  if (input.filterQuery) {
    const validation = await validateFilterQuery(input.filterQuery);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await insertRows('segments', [{
    id,
    name: input.name || seg.name,
    niche: input.niche !== undefined ? (input.niche || null) : seg.niche,
    client_name: input.clientName !== undefined ? (input.clientName || null) : seg.client_name,
    filter_query: input.filterQuery || seg.filter_query,
    lead_count: seg.lead_count || 0,
    status: seg.status,
    schedule_cron: input.scheduleCron !== undefined ? (input.scheduleCron ?? null) : (seg.schedule_cron ?? null),
    last_executed_at: seg.last_executed_at ?? null,
    next_run_at: seg.next_run_at ?? null,
    mailwizz_list_id: seg.mailwizz_list_id ?? null,
    last_synced_at: seg.last_synced_at ?? null,
    sync_status: seg.sync_status ?? null,
    sync_count: seg.sync_count ?? null,
    created_at: seg.created_at,
    updated_at: now,
  }]);
}

/** Export segment leads as array of objects */
export async function exportSegmentLeads(id: string): Promise<Record<string, unknown>[]> {
  const seg = await getSegment(id);
  if (!seg) throw new Error(`Segment ${id} not found`);
  const filterQuery = seg.filter_query;
  const exportLimit = await getConfigInt(CONFIG_KEYS.SEGMENT_EXPORT_LIMIT);

  return query(`
    SELECT * FROM universal_person
    WHERE ${filterQuery}
    LIMIT ${exportLimit}
  `);
}

/** Delete a segment */
export async function deleteSegment(id: string): Promise<void> {
  const escaped = id.replace(/'/g, "\\'");
  await command(`ALTER TABLE segments DELETE WHERE id = '${escaped}'`);
}

// ═══════════════════════════════════════════════════════════════
// CSV Upload → Segment
// Takes a list of emails, matches against universal_person,
// and creates a segment containing only matching leads.
// ═══════════════════════════════════════════════════════════════

export async function createSegmentFromUpload(
  name: string,
  emails: string[],
  matchColumn: 'business_email' | 'personal_emails' | 'any',
  performedBy?: string,
  performedByName?: string,
): Promise<{ id: string; matched: number; unmatched: number; total: number }> {
  // Deduplicate and normalize emails
  const unique = [...new Set(emails.map(e => e.trim().toLowerCase()).filter(e => e && e.includes('@')))];

  if (unique.length === 0) {
    throw new Error('No valid emails found in upload');
  }

  if (unique.length > 500_000) {
    throw new Error('Upload exceeds 500,000 email limit. Split into multiple segments.');
  }

  // Build the match condition
  const escaped = unique.map(e => `'${e.replace(/'/g, "\\'")}'`);

  let filterQuery: string;
  if (matchColumn === 'any') {
    filterQuery = `(lower(\`business_email\`) IN (${escaped.join(',')}) OR lower(\`personal_emails\`) IN (${escaped.join(',')}))`;
  } else {
    filterQuery = `lower(\`${matchColumn}\`) IN (${escaped.join(',')})`;
  }

  // If list is too large for a single IN(), use a batch approach
  // ClickHouse handles IN with up to ~100K values efficiently
  if (unique.length > 100_000) {
    // Create a temporary table and join
    const tmpTable = `_upload_seg_${Date.now()}`;
    await command(`CREATE TABLE IF NOT EXISTS ${tmpTable} (email String) ENGINE = Memory`);
    
    // Insert in batches of 10K
    for (let i = 0; i < unique.length; i += 10_000) {
      const batch = unique.slice(i, i + 10_000);
      await insertRows(tmpTable, batch.map(e => ({ email: e })));
    }

    if (matchColumn === 'any') {
      filterQuery = `(lower(\`business_email\`) IN (SELECT email FROM ${tmpTable}) OR lower(\`personal_emails\`) IN (SELECT email FROM ${tmpTable}))`;
    } else {
      filterQuery = `lower(\`${matchColumn}\`) IN (SELECT email FROM ${tmpTable})`;
    }

    // Count matches
    const [countResult] = await query<{ cnt: string }>(`SELECT count() as cnt FROM universal_person WHERE ${filterQuery}`);
    const matched = Number(countResult?.cnt || 0);

    // Create the final segment with a self-contained filter (copy emails into IN clause for persistence)
    // We need to persist the filter — temp table may get dropped
    // For >100K, store the list in a permanent small table
    const permTable = `_seg_list_${Date.now()}`;
    await command(`RENAME TABLE ${tmpTable} TO ${permTable}`);

    if (matchColumn === 'any') {
      filterQuery = `(lower(\`business_email\`) IN (SELECT email FROM ${permTable}) OR lower(\`personal_emails\`) IN (SELECT email FROM ${permTable}))`;
    } else {
      filterQuery = `lower(\`${matchColumn}\`) IN (SELECT email FROM ${permTable})`;
    }

    const id = genId();
    await insertRows('segments', [{
      id,
      name,
      niche: null,
      client_name: null,
      filter_query: filterQuery,
      status: 'draft',
      ...(performedBy ? { performed_by: performedBy } : {}),
      ...(performedByName ? { performed_by_name: performedByName } : {}),
    }]);

    return { id, matched, unmatched: unique.length - matched, total: unique.length };
  }

  // For smaller lists, validate the filter
  const validation = await validateFilterQuery(filterQuery);
  if (!validation.valid) {
    throw new Error(`Filter validation failed: ${validation.error}`);
  }

  // Count matches
  const [countResult] = await query<{ cnt: string }>(`SELECT count() as cnt FROM universal_person WHERE ${filterQuery}`);
  const matched = Number(countResult?.cnt || 0);

  // Create the segment
  const id = genId();
  await insertRows('segments', [{
    id,
    name,
    niche: null,
    client_name: null,
    filter_query: filterQuery,
    status: 'draft',
    ...(performedBy ? { performed_by: performedBy } : {}),
    ...(performedByName ? { performed_by_name: performedByName } : {}),
  }]);

  return { id, matched, unmatched: unique.length - matched, total: unique.length };
}
