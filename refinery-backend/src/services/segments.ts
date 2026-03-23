import { query, command, insertRows } from '../db/clickhouse.js';
import { genId } from '../utils/helpers.js';

export interface SegmentInput {
  name: string;
  niche?: string;
  clientName?: string;
  filterQuery: string;
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

  // Tag rows (append segment ID to _segment_ids array)
  const escapedId = id.replace(/'/g, "\\'");
  await command(`
    ALTER TABLE universal_person UPDATE
      _segment_ids = arrayConcat(_segment_ids, ['${escapedId}'])
    WHERE ${filterQuery}
      AND NOT has(_segment_ids, '${escapedId}')
  `);

  // Update segment with count and status
  await insertRows('segments', [{
    id,
    name: seg.name,
    niche: seg.niche,
    client_name: seg.client_name,
    filter_query: filterQuery,
    lead_count: count,
    status: 'active',
    created_at: seg.created_at,
    updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
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

  await insertRows('segments', [{
    id,
    name: input.name || seg.name,
    niche: input.niche !== undefined ? (input.niche || null) : seg.niche,
    client_name: input.clientName !== undefined ? (input.clientName || null) : seg.client_name,
    filter_query: input.filterQuery || seg.filter_query,
    lead_count: seg.lead_count || 0,
    status: seg.status,
    created_at: seg.created_at,
    updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  }]);
}

/** Export segment leads as array of objects */
export async function exportSegmentLeads(id: string): Promise<Record<string, unknown>[]> {
  const seg = await getSegment(id);
  if (!seg) throw new Error(`Segment ${id} not found`);
  const filterQuery = seg.filter_query;

  return query(`
    SELECT * FROM universal_person
    WHERE ${filterQuery}
    LIMIT 50000
  `);
}

/** Delete a segment */
export async function deleteSegment(id: string): Promise<void> {
  const escaped = id.replace(/'/g, "\\'");
  await command(`ALTER TABLE segments DELETE WHERE id = '${escaped}'`);
}
