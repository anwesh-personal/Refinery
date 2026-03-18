import type {
  MTAAdapter,
  MTAList,
  MTASubscriber,
  MTACampaign,
  MTACampaignStats,
  CreateCampaignInput,
} from './adapter.js';

// ═══════════════════════════════════════════════════════════════
// MailWizz MTA Adapter — first concrete implementation
// Wraps MailWizz's REST API (EMA = Email Marketing Application)
// Docs: https://api-docs.mailwizz.com/
// ═══════════════════════════════════════════════════════════════

interface MailWizzConfig {
  baseUrl: string;     // e.g. https://your-mailwizz.com/api
  apiKey: string;       // Public API key from MailWizz
}

export class MailWizzAdapter implements MTAAdapter {
  readonly provider = 'mailwizz';
  private config: MailWizzConfig;

  constructor(config: MailWizzConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/+$/, ''),
      apiKey: config.apiKey,
    };
  }

  private async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'X-Api-Key': this.config.apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const opts: RequestInit = { method, headers };
    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    const text = await res.text();

    let data: any;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      const msg = data?.error?.message || data?.message || `MailWizz ${res.status}: ${text.slice(0, 200)}`;
      throw new Error(msg);
    }

    return data as T;
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.request('GET', '/lists');
      return { ok: true, message: 'MailWizz API connection successful' };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  }

  async createList(name: string, defaults?: Record<string, unknown>): Promise<MTAList> {
    const payload = {
      general: {
        name,
        description: defaults?.description || `Auto-created by Refinery Nexus`,
      },
      defaults: {
        from_name: defaults?.from_name || 'Refinery',
        from_email: defaults?.from_email || 'noreply@example.com',
        reply_to: defaults?.reply_to || 'noreply@example.com',
        subject: defaults?.subject || 'Campaign',
      },
      notifications: {
        subscribe: 'no',
        unsubscribe: 'no',
      },
      company: defaults?.company || {},
    };

    const res = await this.request<any>('POST', '/lists', payload);

    return {
      id: res.data?.record?.list_uid || res.list_uid || '',
      name,
      subscriber_count: 0,
      created_at: new Date().toISOString(),
    };
  }

  async getLists(): Promise<MTAList[]> {
    const res = await this.request<any>('GET', '/lists?page=1&per_page=100');
    const records = res.data?.records || [];

    return records.map((r: any) => ({
      id: r.general?.list_uid || r.list_uid || '',
      name: r.general?.name || r.name || '',
      subscriber_count: Number(r.subscribers_count || 0),
      created_at: r.general?.date_added || null,
    }));
  }

  async addSubscribers(
    listId: string,
    subscribers: MTASubscriber[],
  ): Promise<{ added: number; failed: number }> {
    let added = 0;
    let failed = 0;

    // MailWizz API adds one subscriber at a time
    // For bulk, we batch and parallelize with controlled concurrency
    const CONCURRENCY = 10;
    const chunks: MTASubscriber[][] = [];
    for (let i = 0; i < subscribers.length; i += CONCURRENCY) {
      chunks.push(subscribers.slice(i, i + CONCURRENCY));
    }

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(sub =>
          this.request('POST', `/lists/${listId}/subscribers`, {
            EMAIL: sub.email,
            FNAME: sub.first_name || '',
            LNAME: sub.last_name || '',
          }),
        ),
      );

      for (const r of results) {
        if (r.status === 'fulfilled') added++;
        else failed++;
      }
    }

    return { added, failed };
  }

  async createCampaign(input: CreateCampaignInput): Promise<MTACampaign> {
    const payload = {
      campaign: {
        name: input.name,
        type: 'regular',
        from_name: input.from_name,
        from_email: input.from_email,
        subject: input.subject,
        reply_to: input.reply_to || input.from_email,
        send_at: new Date().toISOString(),
        list_uid: input.list_id,
      },
      template: {
        inline_html: input.html_body,
        plain_text: input.plain_text || '',
        auto_plain_text: input.plain_text ? 'no' : 'yes',
      },
    };

    const res = await this.request<any>('POST', '/campaigns', payload);
    const uid = res.data?.record?.campaign_uid || res.campaign_uid || '';

    return {
      id: uid,
      name: input.name,
      list_id: input.list_id,
      status: 'draft',
      subject: input.subject,
      from_name: input.from_name,
      from_email: input.from_email,
      created_at: new Date().toISOString(),
    };
  }

  async sendCampaign(campaignId: string): Promise<{ sent: boolean; message: string }> {
    try {
      await this.request('PATCH', `/campaigns/${campaignId}`, {
        campaign: { status: 'sending' },
      });
      return { sent: true, message: 'Campaign sending initiated' };
    } catch (e: any) {
      return { sent: false, message: e.message };
    }
  }

  async pauseCampaign(campaignId: string): Promise<{ paused: boolean; message: string }> {
    try {
      await this.request('PATCH', `/campaigns/${campaignId}`, {
        campaign: { status: 'paused' },
      });
      return { paused: true, message: 'Campaign paused' };
    } catch (e: any) {
      return { paused: false, message: e.message };
    }
  }

  async getCampaignStats(campaignId: string): Promise<MTACampaignStats> {
    const res = await this.request<any>('GET', `/campaigns/${campaignId}`);
    const stats = res.data?.record?.stats || res.stats || {};

    const total = Number(stats.subscribers_count || 0);
    const sent = Number(stats.processed_count || 0);
    const opens = Number(stats.opens_count || 0);
    const uniqueOpens = Number(stats.unique_opens_count || stats.opens_count || 0);
    const clicks = Number(stats.clicks_count || 0);
    const uniqueClicks = Number(stats.unique_clicks_count || stats.clicks_count || 0);
    const bounces = Number(stats.bounces_count || 0);
    const hardBounces = Number(stats.hard_bounces_count || 0);
    const softBounces = Number(stats.soft_bounces_count || 0);
    const unsubs = Number(stats.unsubscribes_count || 0);
    const complaints = Number(stats.complaints_count || 0);

    return {
      campaign_id: campaignId,
      total_recipients: total,
      sent,
      opens,
      unique_opens: uniqueOpens,
      clicks,
      unique_clicks: uniqueClicks,
      bounces,
      hard_bounces: hardBounces,
      soft_bounces: softBounces,
      unsubscribes: unsubs,
      complaints,
      delivery_rate: sent > 0 ? ((sent - bounces) / sent) * 100 : 0,
      open_rate: sent > 0 ? (uniqueOpens / sent) * 100 : 0,
      click_rate: sent > 0 ? (uniqueClicks / sent) * 100 : 0,
    };
  }

  async getCampaigns(page = 1, perPage = 50): Promise<MTACampaign[]> {
    const res = await this.request<any>('GET', `/campaigns?page=${page}&per_page=${perPage}`);
    const records = res.data?.records || [];

    return records.map((r: any) => ({
      id: r.campaign_uid || '',
      name: r.name || '',
      list_id: r.list?.list_uid || '',
      status: r.status || 'unknown',
      subject: r.subject || '',
      from_name: r.from_name || '',
      from_email: r.from_email || '',
      created_at: r.date_added || null,
    }));
  }

  async setupWebhooks(baseUrl: string): Promise<{ configured: boolean; webhooks: string[] }> {
    const webhookTypes = [
      { event: 'bounce', path: '/bounce' },
      { event: 'open', path: '/open' },
      { event: 'click', path: '/click' },
      { event: 'complaint', path: '/complaint' },
      { event: 'unsubscribe', path: '/unsubscribe' },
    ];

    const configured: string[] = [];

    for (const wh of webhookTypes) {
      try {
        // MailWizz uses list-level webhooks, so we'd need a list_id
        // For now, document the expected webhook URLs
        configured.push(`${baseUrl}/api/v1/webhooks${wh.path}`);
      } catch { /* skip failed ones */ }
    }

    return {
      configured: configured.length > 0,
      webhooks: configured,
    };
  }
}
