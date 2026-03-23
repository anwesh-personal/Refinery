/**
 * MailWizz Sync Service
 * Pushes executed segment leads to MailWizz as subscriber lists.
 * All config (API URL + key) is read from the refinery config table — never hardcoded.
 */

import { query as chQuery } from '../db/clickhouse.js';
import { getSegment } from './segments.js';
import { getConfig } from './config.js';

const BATCH_SIZE = 500;

interface MailwizzSubscriber {
  EMAIL: string;
  FNAME?: string;
  LNAME?: string;
}

// ── MailWizz API helpers ────────────────────────────────────────────────────

async function getMailwizzConfig(): Promise<{ baseUrl: string; apiKey: string }> {
  const [baseUrl, apiKey] = await Promise.all([
    getConfig('mailwizz_api_url'),
    getConfig('mailwizz_api_key'),
  ]);
  if (!baseUrl) throw new Error('mailwizz_api_url is not configured. Set it in Server Config.');
  if (!apiKey) throw new Error('mailwizz_api_key is not configured. Set it in Server Config.');
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey };
}

async function mwFetch<T = any>(
  baseUrl: string,
  apiKey: string,
  path: string,
  method = 'GET',
  body?: object,
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    'X-MW-PUBLIC-KEY': apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`MailWizz returned non-JSON: ${text.slice(0, 200)}`); }
  if (!res.ok || json.status === 'error') {
    throw new Error(`MailWizz API error [${res.status}]: ${json.error || json.message || text.slice(0, 200)}`);
  }
  return json as T;
}

// ── List management ─────────────────────────────────────────────────────────

async function findOrCreateList(
  baseUrl: string,
  apiKey: string,
  segmentName: string,
  segmentId: string,
): Promise<string> {
  // Search for existing list by segment name
  const search = await mwFetch<any>(baseUrl, apiKey, `/lists?page=1&per_page=50`);
  const lists: any[] = search?.data?.records ?? [];
  const existing = lists.find(
    (l: any) => l.general?.name === segmentName || l.general?.description?.includes(segmentId),
  );
  if (existing) return existing.list_uid;

  // Create new list
  const created = await mwFetch<any>(baseUrl, apiKey, '/lists', 'POST', {
    general: {
      name: segmentName,
      display_name: segmentName,
      description: `Auto-synced from Refinery segment: ${segmentId}`,
    },
    defaults: {
      from_name: 'Refinery Nexus',
      from_email: 'noreply@iiiemail.email',
      reply_to: 'noreply@iiiemail.email',
    },
    notifications: { subscribe: 'no', unsubscribe: 'no' },
    company: { name: 'Refinery Nexus', country: 'US', zone: 'NY', city: 'New York', zip_code: '10001', address_1: '123 Main St' },
  });
  return created?.data?.record?.list_uid ?? created?.list_uid;
}

// ── Update segment sync metadata in ClickHouse ──────────────────────────────

async function updateSyncStatus(
  id: string,
  status: string,
  count: number | null,
  listId: string | null,
): Promise<void> {
  const seg = await getSegment(id);
  if (!seg) return;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const { insertRows } = await import('../db/clickhouse.js');
  await insertRows('segments', [{
    id: seg.id,
    name: seg.name,
    niche: seg.niche,
    client_name: seg.client_name,
    filter_query: seg.filter_query,
    lead_count: seg.lead_count,
    status: seg.status,
    schedule_cron: seg.schedule_cron ?? null,
    last_executed_at: seg.last_executed_at ?? null,
    next_run_at: seg.next_run_at ?? null,
    mailwizz_list_id: listId ?? seg.mailwizz_list_id ?? null,
    last_synced_at: now,
    sync_status: status,
    sync_count: count ?? seg.sync_count ?? null,
    created_at: seg.created_at,
    updated_at: now,
  }]);
}

// ── Main sync function ───────────────────────────────────────────────────────

export async function syncSegmentToMailwizz(segmentId: string): Promise<{
  ok: boolean;
  synced: number;
  listId: string;
  listUrl: string;
}> {
  const seg = await getSegment(segmentId);
  if (!seg) throw new Error('Segment not found');
  if (seg.status !== 'active' || !seg.lead_count) {
    throw new Error('Segment must be executed first (must have active status and > 0 leads).');
  }

  const { baseUrl, apiKey } = await getMailwizzConfig();

  // Mark as syncing
  await updateSyncStatus(segmentId, 'syncing', null, null);

  try {
    // Get or create the MailWizz list
    const listId = await findOrCreateList(baseUrl, apiKey, seg.name, segmentId);

    // Fetch all matching leads in batches
    const escapedId = segmentId.replace(/'/g, "\\'");
    const leads = await chQuery<{ business_email: string; first_name: string | null; last_name: string | null }>(
      `SELECT business_email, first_name, last_name
       FROM universal_person FINAL
       WHERE has(_segment_ids, '${escapedId}')
         AND business_email IS NOT NULL
         AND business_email != ''
       LIMIT 1000000`,
    );

    let synced = 0;
    // Push in batches
    for (let i = 0; i < leads.length; i += BATCH_SIZE) {
      const batch = leads.slice(i, i + BATCH_SIZE);
      const subscribers: MailwizzSubscriber[] = batch.map(l => ({
        EMAIL: l.business_email,
        FNAME: l.first_name || undefined,
        LNAME: l.last_name || undefined,
      }));

      await mwFetch(baseUrl, apiKey, `/lists/${listId}/subscribers/bulk-subscribe`, 'POST', {
        subscribers,
      });
      synced += batch.length;
    }

    await updateSyncStatus(segmentId, 'synced', synced, listId);

    return {
      ok: true,
      synced,
      listId,
      listUrl: `${baseUrl.replace('/api', '')}/customer/lists/${listId}/overview`,
    };
  } catch (err: any) {
    await updateSyncStatus(segmentId, 'failed', null, seg.mailwizz_list_id ?? null);
    throw err;
  }
}
