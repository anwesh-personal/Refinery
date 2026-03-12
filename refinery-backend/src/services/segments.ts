import { query, command, insertRows } from '../db/clickhouse.js';
import { genId } from '../utils/helpers.js';

export interface SegmentInput {
  name: string;
  niche?: string;
  clientName?: string;
  filterQuery: string;
}

/** Create a new segment */
export async function createSegment(input: SegmentInput): Promise<string> {
  const id = genId();

  await insertRows('segments', [{
    id,
    name: input.name,
    niche: input.niche || null,
    client_name: input.clientName || null,
    filter_query: input.filterQuery,
    status: 'draft',
  }]);

  return id;
}

/** List all segments */
export async function listSegments() {
  return query('SELECT * FROM segments FINAL ORDER BY created_at DESC');
}

/** Get a single segment by ID */
export async function getSegment(id: string) {
  const rows = await query(`SELECT * FROM segments FINAL WHERE id = '${id}' LIMIT 1`);
  return rows[0] || null;
}

/** Preview a segment — returns the count of matching leads WITHOUT saving */
export async function previewSegment(filterQuery: string): Promise<{ count: number; sample: Record<string, unknown>[] }> {
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

  const filterQuery = (seg as any).filter_query;

  // Count first
  const [countResult] = await query<{ cnt: string }>(
    `SELECT count() as cnt FROM universal_person WHERE ${filterQuery}`,
  );
  const count = Number(countResult?.cnt || 0);

  // Tag rows (append segment ID to _segment_ids array)
  await command(`
    ALTER TABLE universal_person UPDATE
      _segment_ids = arrayConcat(_segment_ids, ['${id}'])
    WHERE ${filterQuery}
      AND NOT has(_segment_ids, '${id}')
  `);

  // Update segment with count and status
  await insertRows('segments', [{
    id,
    name: (seg as any).name,
    niche: (seg as any).niche,
    client_name: (seg as any).client_name,
    filter_query: filterQuery,
    lead_count: count,
    status: 'active',
    created_at: (seg as any).created_at,
    updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  }]);

  return count;
}

/** Delete a segment */
export async function deleteSegment(id: string): Promise<void> {
  await command(`ALTER TABLE segments DELETE WHERE id = '${id}'`);
}
