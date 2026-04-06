/**
 * Multi-Provider Segment Push
 * ===========================
 * Pushes an executed segment's leads to MULTIPLE MTA providers simultaneously.
 * Each provider is a user's MailWizz instance with its own API key/URL.
 *
 * Flow:
 *   Superadmin selects segment + picks target providers (users' MailWizz instances)
 *   → For each provider, creates/finds a MailWizz list → bulk-subscribes leads
 *   → Returns per-provider results
 *
 * Uses the same MailWizz API as the single-provider sync but supports fan-out.
 */

import { query as chQuery } from '../db/clickhouse.js';
import { getSegment } from './segments.js';
import { getProviderRaw, type MTAProvider } from './mta-providers.js';
import { createAdapter } from './mta/index.js';

const BATCH_SIZE = 500;

interface PushResult {
  providerId: string;
  providerName: string;
  success: boolean;
  synced: number;
  listId?: string;
  error?: string;
}

export interface MultiPushResult {
  segmentId: string;
  segmentName: string;
  totalLeads: number;
  results: PushResult[];
}

/**
 * Push a segment's leads to multiple MTA providers in parallel.
 * Each provider creates its own MailWizz list and subscribes the leads.
 */
export async function pushSegmentToProviders(
  segmentId: string,
  providerIds: string[],
): Promise<MultiPushResult> {
  // 1. Validate segment
  const seg = await getSegment(segmentId);
  if (!seg) throw new Error('Segment not found');
  if (seg.status !== 'active' || !seg.lead_count) {
    throw new Error('Segment must be executed first (status=active, lead_count > 0).');
  }

  // 2. Fetch leads from ClickHouse
  const escapedId = segmentId.replace(/'/g, "\\'");
  const leads = await chQuery<{ business_email: string; first_name: string | null; last_name: string | null }>(
    `SELECT business_email, first_name, last_name
     FROM universal_person FINAL
     WHERE has(_segment_ids, '${escapedId}')
       AND business_email IS NOT NULL
       AND business_email != ''
     LIMIT 1000000`,
  );

  if (leads.length === 0) {
    throw new Error('No leads found in segment. Execute the segment first.');
  }

  // 3. Load all target providers
  const providers: MTAProvider[] = [];
  for (const pid of providerIds) {
    const p = await getProviderRaw(pid);
    if (!p) throw new Error(`Provider ${pid} not found`);
    if (!p.is_active) throw new Error(`Provider "${p.name}" is not active`);
    providers.push(p);
  }

  // 4. Push to each provider concurrently
  const results = await Promise.allSettled(
    providers.map((provider) => pushToSingleProvider(provider, seg.name, segmentId, leads)),
  );

  // 5. Collect results
  const pushResults: PushResult[] = results.map((r, i) => {
    if (r.status === 'fulfilled') {
      return r.value;
    }
    return {
      providerId: providers[i].id,
      providerName: providers[i].name,
      success: false,
      synced: 0,
      error: r.reason?.message || 'Unknown error',
    };
  });

  return {
    segmentId,
    segmentName: seg.name,
    totalLeads: leads.length,
    results: pushResults,
  };
}

// ── Push to a single provider ────────────────────────────────────────────────

async function pushToSingleProvider(
  provider: MTAProvider,
  segmentName: string,
  segmentId: string,
  leads: Array<{ business_email: string; first_name: string | null; last_name: string | null }>,
): Promise<PushResult> {
  const adapter = createAdapter(provider.provider_type, provider.base_url, provider.api_key);

  try {
    // Create or find list on this provider's MailWizz
    const listName = `[Refinery] ${segmentName}`;
    const listId = await findOrCreateProviderList(provider, listName, segmentId);

    // Push leads in batches
    let synced = 0;
    for (let i = 0; i < leads.length; i += BATCH_SIZE) {
      const batch = leads.slice(i, i + BATCH_SIZE);
      const subscribers = batch.map((l) => ({
        EMAIL: l.business_email,
        FNAME: l.first_name || '',
        LNAME: l.last_name || '',
      }));

      await mwFetch(provider.base_url, provider.api_key, `/lists/${listId}/subscribers/bulk-subscribe`, 'POST', {
        subscribers,
      });
      synced += batch.length;
    }

    return {
      providerId: provider.id,
      providerName: provider.name,
      success: true,
      synced,
      listId,
    };
  } catch (err: any) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      success: false,
      synced: 0,
      error: err.message,
    };
  }
}

// ── MailWizz helpers (same as mailwizz-sync.ts but provider-specific) ────────

async function findOrCreateProviderList(
  provider: MTAProvider,
  listName: string,
  segmentId: string,
): Promise<string> {
  // Search for existing list
  const search = await mwFetch<any>(provider.base_url, provider.api_key, `/lists?page=1&per_page=50`);
  const lists: any[] = search?.data?.records ?? [];
  const existing = lists.find(
    (l: any) => l.general?.name === listName || l.general?.description?.includes(segmentId),
  );
  if (existing) return existing.list_uid;

  // Create new list
  const created = await mwFetch<any>(provider.base_url, provider.api_key, '/lists', 'POST', {
    general: {
      name: listName,
      display_name: listName,
      description: `Refinery segment push: ${segmentId}`,
    },
    defaults: {
      from_name: provider.name,
      from_email: `noreply@${provider.base_url.replace(/https?:\/\//, '').split('/')[0]}`,
      reply_to: `noreply@${provider.base_url.replace(/https?:\/\//, '').split('/')[0]}`,
    },
    notifications: { subscribe: 'no', unsubscribe: 'no' },
    company: { name: 'Refinery Nexus', country: 'US', zone: 'NY', city: 'New York', zip_code: '10001', address_1: '.' },
  });
  return created?.data?.record?.list_uid ?? created?.list_uid;
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
  try { json = JSON.parse(text); } catch { throw new Error(`MailWizz non-JSON response: ${text.slice(0, 200)}`); }
  if (!res.ok || json.status === 'error') {
    throw new Error(`MailWizz [${res.status}]: ${json.error || json.message || text.slice(0, 200)}`);
  }
  return json as T;
}
