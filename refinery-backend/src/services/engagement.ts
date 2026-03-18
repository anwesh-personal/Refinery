import { query, insertRows } from '../db/clickhouse.js';
import { genId } from '../utils/helpers.js';

// ═══════════════════════════════════════════════════════════════
// Engagement Service — stores and queries webhook event data
// (bounces, opens, clicks, replies, complaints, unsubscribes)
// ═══════════════════════════════════════════════════════════════

export type EventType = 'bounce' | 'open' | 'click' | 'reply' | 'complaint' | 'unsubscribe';
export type BounceType = 'hard' | 'soft';

export interface EngagementEvent {
  event_type: EventType;
  email: string;
  campaign_id?: string;
  list_id?: string;
  mta_provider?: string;
  bounce_type?: BounceType;
  bounce_reason?: string;
  link_url?: string;
  user_agent?: string;
  ip_address?: string;
  raw_payload?: string;
  event_id?: string;
}

export interface StoredEvent extends EngagementEvent {
  id: string;
  up_id: string | null;
  received_at: string;
}

/**
 * Resolve email → up_id from universal_person.
 * Checks business_email first, then personal_emails.
 */
async function resolveUpId(email: string): Promise<string | null> {
  const lowerEmail = email.toLowerCase().replace(/'/g, "\\'");
  const rows = await query<{ up_id: string }>(
    `SELECT up_id FROM universal_person
     WHERE lower(business_email) = '${lowerEmail}'
        OR has(splitByChar(',', coalesce(personal_emails, '')), '${lowerEmail}')
     LIMIT 1`,
  );
  return rows.length > 0 ? rows[0].up_id : null;
}

/** Deduplicate: check if we've already stored this exact event */
async function isDuplicate(eventId: string, mtaProvider: string): Promise<boolean> {
  if (!eventId) return false;
  const rows = await query<{ cnt: string }>(
    `SELECT count() as cnt FROM engagement_events
     WHERE event_id = '${eventId.replace(/'/g, "\\'")}'
       AND mta_provider = '${mtaProvider.replace(/'/g, "\\'")}'`,
  );
  return Number(rows[0]?.cnt || 0) > 0;
}

/** Store a single engagement event. Returns the stored event or null if duplicate. */
export async function storeEvent(event: EngagementEvent): Promise<StoredEvent | null> {
  if (event.event_id && event.mta_provider) {
    const dup = await isDuplicate(event.event_id, event.mta_provider);
    if (dup) return null;
  }

  const upId = await resolveUpId(event.email);

  const row: Record<string, unknown> = {
    id: genId(),
    event_type: event.event_type,
    email: event.email.toLowerCase(),
    up_id: upId,
    campaign_id: event.campaign_id || null,
    list_id: event.list_id || null,
    mta_provider: event.mta_provider || 'unknown',
    bounce_type: event.bounce_type || null,
    bounce_reason: event.bounce_reason || null,
    link_url: event.link_url || null,
    user_agent: event.user_agent || null,
    ip_address: event.ip_address || null,
    raw_payload: event.raw_payload || null,
    event_id: event.event_id || null,
  };

  await insertRows('engagement_events', [row]);

  // On hard bounce, mark contact's verification status
  if (event.event_type === 'bounce' && event.bounce_type === 'hard' && upId) {
    try {
      const sanitizedId = upId.replace(/'/g, "\\'");
      await query(
        `ALTER TABLE universal_person
         UPDATE _verification_status = 'bounced', _verified_at = now()
         WHERE up_id = '${sanitizedId}'`,
      );
    } catch { /* non-critical, log and move on */ }
  }

  return row as unknown as StoredEvent;
}

/** Store a batch of engagement events. Returns count of newly stored (non-duplicate) events. */
export async function storeBatch(events: EngagementEvent[]): Promise<{ stored: number; duplicates: number }> {
  let stored = 0;
  let duplicates = 0;

  // Process in mini-batches to avoid overwhelming ClickHouse
  const CHUNK = 200;
  for (let i = 0; i < events.length; i += CHUNK) {
    const chunk = events.slice(i, i + CHUNK);
    const rows: Record<string, unknown>[] = [];

    for (const event of chunk) {
      if (event.event_id && event.mta_provider) {
        const dup = await isDuplicate(event.event_id, event.mta_provider);
        if (dup) { duplicates++; continue; }
      }

      const upId = await resolveUpId(event.email);
      rows.push({
        id: genId(),
        event_type: event.event_type,
        email: event.email.toLowerCase(),
        up_id: upId,
        campaign_id: event.campaign_id || null,
        list_id: event.list_id || null,
        mta_provider: event.mta_provider || 'unknown',
        bounce_type: event.bounce_type || null,
        bounce_reason: event.bounce_reason || null,
        link_url: event.link_url || null,
        user_agent: event.user_agent || null,
        ip_address: event.ip_address || null,
        raw_payload: event.raw_payload || null,
        event_id: event.event_id || null,
      });
    }

    if (rows.length > 0) {
      await insertRows('engagement_events', rows);
      stored += rows.length;
    }
  }

  return { stored, duplicates };
}

/** Query engagement events with filters */
export async function queryEvents(filters: {
  event_type?: EventType;
  email?: string;
  campaign_id?: string;
  mta_provider?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}): Promise<{ data: StoredEvent[]; total: number }> {
  const conditions: string[] = [];

  if (filters.event_type) conditions.push(`event_type = '${filters.event_type}'`);
  if (filters.email) conditions.push(`email = '${filters.email.toLowerCase().replace(/'/g, "\\'")}'`);
  if (filters.campaign_id) conditions.push(`campaign_id = '${filters.campaign_id.replace(/'/g, "\\'")}'`);
  if (filters.mta_provider) conditions.push(`mta_provider = '${filters.mta_provider.replace(/'/g, "\\'")}'`);
  if (filters.since) conditions.push(`received_at >= '${filters.since}'`);
  if (filters.until) conditions.push(`received_at <= '${filters.until}'`);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(filters.limit || 100, 1000);
  const offset = filters.offset || 0;

  const [countRow] = await query<{ cnt: string }>(
    `SELECT count() as cnt FROM engagement_events ${where}`,
  );
  const total = Number(countRow?.cnt || 0);

  const rows = await query<StoredEvent>(
    `SELECT * FROM engagement_events ${where}
     ORDER BY received_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
  );

  return { data: rows, total };
}
