import { query, insertRows, command } from '../db/clickhouse.js';
import { genId } from '../utils/helpers.js';
import { stringify } from 'csv-stringify/sync';

export interface TargetListInput {
  name: string;
  segmentId: string;
  exportFormat?: 'csv' | 'xlsx';
}

/** Create a target list from a verified segment */
export async function createTargetList(input: TargetListInput): Promise<string> {
  const id = genId();

  // Count verified emails in the segment
  const [countResult] = await query<{ cnt: string }>(`
    SELECT count() as cnt FROM universal_person
    WHERE has(_segment_ids, '${input.segmentId}')
      AND _verification_status = 'valid'
      AND (business_email IS NOT NULL OR personal_emails IS NOT NULL)
  `);
  const emailCount = Number(countResult?.cnt || 0);

  await insertRows('target_lists', [{
    id,
    name: input.name,
    segment_id: input.segmentId,
    email_count: emailCount,
    export_format: input.exportFormat || 'csv',
    status: 'generating',
  }]);

  return id;
}

/** Export a target list as CSV string */
export async function exportTargetList(id: string): Promise<{ csv: string; count: number }> {
  const lists = await query<{
    segment_id: string;
    export_format: string;
  }>(`SELECT segment_id, export_format FROM target_lists WHERE id = '${id}' LIMIT 1`);

  const list = lists[0];
  if (!list) throw new Error(`Target list ${id} not found`);

  const rows = await query<Record<string, string>>(`
    SELECT
      up_id, first_name, last_name,
      business_email, personal_emails,
      mobile_phone, direct_number,
      personal_city, personal_state,
      company_name, job_title_normalized,
      primary_industry
    FROM universal_person
    WHERE has(_segment_ids, '${list.segment_id}')
      AND _verification_status = 'valid'
      AND (business_email IS NOT NULL OR personal_emails IS NOT NULL)
  `);

  const csv = stringify(rows, {
    header: true,
    columns: [
      'up_id', 'first_name', 'last_name',
      'business_email', 'personal_emails',
      'mobile_phone', 'direct_number',
      'personal_city', 'personal_state',
      'company_name', 'job_title_normalized',
      'primary_industry',
    ],
  });

  // Mark as ready
  await insertRows('target_lists', [{
    ...(list as any),
    id,
    status: 'ready',
  }]);

  return { csv, count: rows.length };
}

/** List all target lists */
export async function listTargetLists() {
  return query('SELECT * FROM target_lists ORDER BY created_at DESC LIMIT 50');
}

/** Get target stats */
export async function getTargetStats() {
  const [stats] = await query<{
    total_lists: string;
    total_emails: string;
    exported: string;
  }>(`
    SELECT
      count() as total_lists,
      sum(email_count) as total_emails,
      countIf(status = 'ready' OR status = 'pushed') as exported
    FROM target_lists
  `);
  return stats;
}

/** Delete a target list */
export async function deleteTargetList(id: string): Promise<void> {
  await command(`ALTER TABLE target_lists DELETE WHERE id = '${id}'`);
}
