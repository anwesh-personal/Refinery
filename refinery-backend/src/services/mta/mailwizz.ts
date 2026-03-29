import type {
  MTAAdapter,
  MTAList,
  MTASubscriber,
  MTACampaign,
  MTACampaignStats,
  CreateCampaignInput,
  MTADeliveryServer,
  RegisterDeliveryServerInput,
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

  public async request<T = any>(
    method: string,
    route: string,        // e.g. 'v1/lists/index'
    body?: unknown,
    queryParams?: Record<string, string>,
  ): Promise<T> {
    // MailWizz uses ?r= routing: /api/index.php?r=v1/lists/index
    const base = this.config.baseUrl.replace(/\/api\/?$/, '') + '/api/index.php';
    const params = new URLSearchParams({ r: route, ...(queryParams || {}) });
    const url = `${base}?${params}`;

    const headers: Record<string, string> = {
      'X-MW-PUBLIC-KEY': this.config.apiKey,
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

    // MailWizz returns {status:'error', error:'...'} on failure
    if (data?.status === 'error') {
      throw new Error(data.error || 'MailWizz API error');
    }

    if (!res.ok) {
      const msg = data?.error || data?.message || `MailWizz ${res.status}: ${text.slice(0, 200)}`;
      throw new Error(msg);
    }

    return data as T;
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.request('GET', 'v1/lists/index', undefined, { page: '1', per_page: '1' });
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

    const res = await this.request<any>('POST', 'v1/lists/create', payload);

    return {
      id: res.data?.record?.list_uid || res.list_uid || '',
      name,
      subscriber_count: 0,
      created_at: new Date().toISOString(),
    };
  }

  async getLists(): Promise<MTAList[]> {
    const res = await this.request<any>('GET', 'v1/lists/index', undefined, { page: '1', per_page: '100' });
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
        chunk.map(sub => {
          const fields: Record<string, string> = { EMAIL: sub.email };
          if (sub.first_name) fields.FNAME = sub.first_name;
          if (sub.last_name) fields.LNAME = sub.last_name;
          // Pass any extra mapped fields
          for (const [k, v] of Object.entries(sub)) {
            if (!['email','first_name','last_name'].includes(k) && typeof v === 'string') {
              fields[k.toUpperCase()] = v;
            }
          }
          return this.request('POST', `v1/list-subscribers/${listId}/create`, { details: fields });
        }),
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

    const res = await this.request<any>('POST', 'v1/campaigns/create', payload);
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
      await this.request('PUT', `v1/campaigns/${campaignId}/update`, {
        campaign: { status: 'sending' },
      });
      return { sent: true, message: 'Campaign sending initiated' };
    } catch (e: any) {
      return { sent: false, message: e.message };
    }
  }

  async pauseCampaign(campaignId: string): Promise<{ paused: boolean; message: string }> {
    try {
      await this.request('PUT', `v1/campaigns/${campaignId}/update`, {
        campaign: { status: 'paused' },
      });
      return { paused: true, message: 'Campaign paused' };
    } catch (e: any) {
      return { paused: false, message: e.message };
    }
  }

  async getCampaignStats(campaignId: string): Promise<MTACampaignStats> {
    const res = await this.request<any>('GET', `v1/campaigns/${campaignId}`);
    const record = res.data?.record || {};
    const stats = record.stats || record.overview || {};

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
    const res = await this.request<any>('GET', 'v1/campaigns/index', undefined, {
      page: String(page), per_page: String(perPage),
    });
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

  // ── Delivery Server Management ──

  async registerDeliveryServer(input: RegisterDeliveryServerInput): Promise<MTADeliveryServer> {
    const payload = {
      hostname: input.hostname,
      username: input.username,
      password: input.password,
      port: input.port || 587,
      protocol: input.protocol || 'smtp',
      from_email: input.from_email || input.username,
      from_name: input.from_name || 'Campaign',
      status: 'active',
      // MailWizz uses quota_value + quota_time_value + quota_time_unit
      quota_value: input.daily_quota || 3000,
      quota_time_value: 24,
      quota_time_unit: 'hours',
    };

    const res = await this.request<any>('POST', 'v1/delivery-servers/create', payload);
    const record = res?.data?.record || res || {};

    return {
      id: record.server_id || record.delivery_server_id || '',
      hostname: record.hostname || input.hostname,
      username: record.username || input.username,
      port: Number(record.port) || input.port || 587,
      protocol: record.protocol || input.protocol || 'smtp',
      from_email: record.from_email || input.from_email || '',
      from_name: record.from_name || input.from_name || '',
      status: record.status || 'active',
      quota_value: Number(record.quota_value) || input.daily_quota,
    };
  }

  async listDeliveryServers(): Promise<MTADeliveryServer[]> {
    const res = await this.request<any>('GET', 'v1/delivery-servers/index', undefined, {
      page: '1', per_page: '100',
    });
    const records = res?.data?.records || res || [];
    if (!Array.isArray(records)) return [];

    return records.map((r: any) => ({
      id: r.server_id || r.delivery_server_id || '',
      hostname: r.hostname || '',
      username: r.username || '',
      port: Number(r.port) || 587,
      protocol: r.protocol || 'smtp',
      from_email: r.from_email || '',
      from_name: r.from_name || '',
      status: r.status || 'unknown',
      quota_value: Number(r.quota_value) || undefined,
    }));
  }

  async deleteDeliveryServer(serverId: string): Promise<{ ok: boolean }> {
    await this.request('DELETE', `v1/delivery-servers/${serverId}/delete`);
    return { ok: true };
  }
}
