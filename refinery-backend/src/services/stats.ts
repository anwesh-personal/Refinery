import { query } from '../db/clickhouse.js';

// ═══════════════════════════════════════════════════════════════
// Stats Service — aggregated intelligence for MarketerX brain
// Deliverability metrics, engagement scoring, domain health
// ═══════════════════════════════════════════════════════════════

export interface DeliverabilityStats {
  total_sent: number;
  delivered: number;
  bounced: number;
  hard_bounces: number;
  soft_bounces: number;
  complaints: number;
  delivery_rate: number;
  bounce_rate: number;
  complaint_rate: number;
  // Per-domain breakdown (top offenders)
  domain_health: Array<{
    domain: string;
    sent: number;
    bounced: number;
    bounce_rate: number;
  }>;
}

export interface EngagementStats {
  total_opens: number;
  unique_opens: number;
  total_clicks: number;
  unique_clicks: number;
  total_replies: number;
  unsubscribes: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  click_to_open_rate: number;
  // Hourly distribution (for send-time optimization)
  hourly_opens: Array<{ hour: number; count: number }>;
  // Top clicked links
  top_links: Array<{ url: string; clicks: number }>;
}

export interface CampaignPerformance {
  campaign_id: string;
  name: string;
  sent: number;
  opens: number;
  clicks: number;
  bounces: number;
  replies: number;
  open_rate: number;
  click_rate: number;
  bounce_rate: number;
}

export interface ContactScore {
  up_id: string;
  email: string;
  opens: number;
  clicks: number;
  replies: number;
  bounces: number;
  engagement_score: number;
}

function sanitize(val: string): string {
  return val.replace(/'/g, "\\'").replace(/;/g, '');
}

/** Deliverability stats — aggregated from engagement_events */
export async function getDeliverabilityStats(filters?: {
  campaign_id?: string;
  mta_provider?: string;
  since?: string;
  until?: string;
}): Promise<DeliverabilityStats> {
  const conditions: string[] = [];
  if (filters?.campaign_id) conditions.push(`campaign_id = '${sanitize(filters.campaign_id)}'`);
  if (filters?.mta_provider) conditions.push(`mta_provider = '${sanitize(filters.mta_provider)}'`);
  if (filters?.since) conditions.push(`received_at >= '${sanitize(filters.since)}'`);
  if (filters?.until) conditions.push(`received_at <= '${sanitize(filters.until)}'`);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Aggregate event counts
  const [counts] = await query<Record<string, string>>(
    `SELECT
       countIf(event_type = 'bounce') as bounced,
       countIf(event_type = 'bounce' AND bounce_type = 'hard') as hard_bounces,
       countIf(event_type = 'bounce' AND bounce_type = 'soft') as soft_bounces,
       countIf(event_type = 'complaint') as complaints,
       countIf(event_type = 'open') as opens
     FROM engagement_events ${where}`,
  );

  // Total sent = from campaigns table
  const campaignWhere = conditions.filter(c => !c.includes('event_type')).join(' AND ');
  const [sentRow] = await query<{ total: string }>(
    `SELECT sum(sent_count) as total FROM campaigns FINAL ${campaignWhere ? 'WHERE ' + campaignWhere : ''}`,
  );

  const totalSent = Number(sentRow?.total || 0);
  const bounced = Number(counts?.bounced || 0);
  const hardBounces = Number(counts?.hard_bounces || 0);
  const softBounces = Number(counts?.soft_bounces || 0);
  const complaints = Number(counts?.complaints || 0);
  const delivered = totalSent - bounced;

  // Per-domain bounce breakdown (top 20)
  const domainRows = await query<{ domain: string; sent: string; bounced: string }>(
    `SELECT
       domain(email) as domain,
       count() as sent,
       countIf(event_type = 'bounce') as bounced
     FROM engagement_events ${where}
     GROUP BY domain
     ORDER BY bounced DESC
     LIMIT 20`,
  );

  return {
    total_sent: totalSent,
    delivered,
    bounced,
    hard_bounces: hardBounces,
    soft_bounces: softBounces,
    complaints,
    delivery_rate: totalSent > 0 ? (delivered / totalSent) * 100 : 0,
    bounce_rate: totalSent > 0 ? (bounced / totalSent) * 100 : 0,
    complaint_rate: totalSent > 0 ? (complaints / totalSent) * 100 : 0,
    domain_health: domainRows.map(r => ({
      domain: r.domain,
      sent: Number(r.sent),
      bounced: Number(r.bounced),
      bounce_rate: Number(r.sent) > 0 ? (Number(r.bounced) / Number(r.sent)) * 100 : 0,
    })),
  };
}

/** Engagement stats — opens, clicks, replies, timing */
export async function getEngagementStats(filters?: {
  campaign_id?: string;
  mta_provider?: string;
  since?: string;
  until?: string;
}): Promise<EngagementStats> {
  const conditions: string[] = [];
  if (filters?.campaign_id) conditions.push(`campaign_id = '${sanitize(filters.campaign_id)}'`);
  if (filters?.mta_provider) conditions.push(`mta_provider = '${sanitize(filters.mta_provider)}'`);
  if (filters?.since) conditions.push(`received_at >= '${sanitize(filters.since)}'`);
  if (filters?.until) conditions.push(`received_at <= '${sanitize(filters.until)}'`);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Core counts
  const [counts] = await query<Record<string, string>>(
    `SELECT
       countIf(event_type = 'open') as total_opens,
       uniqExactIf(email, event_type = 'open') as unique_opens,
       countIf(event_type = 'click') as total_clicks,
       uniqExactIf(email, event_type = 'click') as unique_clicks,
       countIf(event_type = 'reply') as total_replies,
       countIf(event_type = 'unsubscribe') as unsubscribes
     FROM engagement_events ${where}`,
  );

  // Sent baseline from campaigns
  const campaignConditions = conditions.filter(c => !c.includes('event_type'));
  const campaignWhere = campaignConditions.length > 0 ? `WHERE ${campaignConditions.join(' AND ')}` : '';
  const [sentRow] = await query<{ total: string }>(
    `SELECT sum(sent_count) as total FROM campaigns FINAL ${campaignWhere}`,
  );
  const totalSent = Number(sentRow?.total || 0);

  const totalOpens = Number(counts?.total_opens || 0);
  const uniqueOpens = Number(counts?.unique_opens || 0);
  const totalClicks = Number(counts?.total_clicks || 0);
  const uniqueClicks = Number(counts?.unique_clicks || 0);
  const totalReplies = Number(counts?.total_replies || 0);
  const unsubscribes = Number(counts?.unsubscribes || 0);

  // Hourly open distribution (for send-time optimization)
  const hourlyRows = await query<{ hour: string; count: string }>(
    `SELECT toHour(received_at) as hour, count() as count
     FROM engagement_events
     ${where ? where + ' AND' : 'WHERE'} event_type = 'open'
     GROUP BY hour
     ORDER BY hour`,
  );

  // Top clicked links
  const linkRows = await query<{ url: string; clicks: string }>(
    `SELECT link_url as url, count() as clicks
     FROM engagement_events
     ${where ? where + ' AND' : 'WHERE'} event_type = 'click' AND link_url IS NOT NULL AND link_url != ''
     GROUP BY link_url
     ORDER BY clicks DESC
     LIMIT 20`,
  );

  return {
    total_opens: totalOpens,
    unique_opens: uniqueOpens,
    total_clicks: totalClicks,
    unique_clicks: uniqueClicks,
    total_replies: totalReplies,
    unsubscribes,
    open_rate: totalSent > 0 ? (uniqueOpens / totalSent) * 100 : 0,
    click_rate: totalSent > 0 ? (uniqueClicks / totalSent) * 100 : 0,
    reply_rate: totalSent > 0 ? (totalReplies / totalSent) * 100 : 0,
    click_to_open_rate: uniqueOpens > 0 ? (uniqueClicks / uniqueOpens) * 100 : 0,
    hourly_opens: hourlyRows.map(r => ({ hour: Number(r.hour), count: Number(r.count) })),
    top_links: linkRows.map(r => ({ url: r.url, clicks: Number(r.clicks) })),
  };
}

/** Per-campaign performance (for brain's self-healing loop) */
export async function getCampaignPerformance(filters?: {
  since?: string;
  limit?: number;
}): Promise<CampaignPerformance[]> {
  const limit = filters?.limit || 50;
  const conditions: string[] = [];
  if (filters?.since) conditions.push(`c.created_at >= '${sanitize(filters.since)}'`);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await query<Record<string, string>>(
    `SELECT
       c.id as campaign_id,
       c.name as name,
       c.sent_count as sent,
       countIf(e.event_type = 'open') as opens,
       countIf(e.event_type = 'click') as clicks,
       countIf(e.event_type = 'bounce') as bounces,
       countIf(e.event_type = 'reply') as replies
     FROM campaigns c FINAL
     LEFT JOIN engagement_events e ON e.campaign_id = c.id
     ${where}
     GROUP BY c.id, c.name, c.sent_count
     ORDER BY c.created_at DESC
     LIMIT ${limit}`,
  );

  return rows.map(r => {
    const sent = Number(r.sent || 0);
    const opens = Number(r.opens || 0);
    const clicks = Number(r.clicks || 0);
    const bounces = Number(r.bounces || 0);
    return {
      campaign_id: r.campaign_id,
      name: r.name,
      sent,
      opens,
      clicks,
      bounces,
      replies: Number(r.replies || 0),
      open_rate: sent > 0 ? (opens / sent) * 100 : 0,
      click_rate: sent > 0 ? (clicks / sent) * 100 : 0,
      bounce_rate: sent > 0 ? (bounces / sent) * 100 : 0,
    };
  });
}

/** Per-contact engagement scoring (for ICP refinement) */
export async function getContactScores(filters?: {
  segment_id?: string;
  min_score?: number;
  limit?: number;
}): Promise<ContactScore[]> {
  const limit = filters?.limit || 100;

  let upIdFilter = '';
  if (filters?.segment_id) {
    upIdFilter = `AND up_id IN (
      SELECT up_id FROM universal_person WHERE has(_segment_ids, '${sanitize(filters.segment_id)}')
    )`;
  }

  const rows = await query<Record<string, string>>(
    `SELECT
       up_id,
       email,
       countIf(event_type = 'open') as opens,
       countIf(event_type = 'click') as clicks,
       countIf(event_type = 'reply') as replies,
       countIf(event_type = 'bounce') as bounces,
       (countIf(event_type = 'open') * 1
        + countIf(event_type = 'click') * 3
        + countIf(event_type = 'reply') * 5
        - countIf(event_type = 'bounce') * 10) as engagement_score
     FROM engagement_events
     WHERE up_id IS NOT NULL AND up_id != '' ${upIdFilter}
     GROUP BY up_id, email
     ${filters?.min_score ? `HAVING engagement_score >= ${filters.min_score}` : ''}
     ORDER BY engagement_score DESC
     LIMIT ${limit}`,
  );

  return rows.map(r => ({
    up_id: r.up_id,
    email: r.email,
    opens: Number(r.opens || 0),
    clicks: Number(r.clicks || 0),
    replies: Number(r.replies || 0),
    bounces: Number(r.bounces || 0),
    engagement_score: Number(r.engagement_score || 0),
  }));
}
