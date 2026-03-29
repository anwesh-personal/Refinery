// ═══════════════════════════════════════════════════════════════
// Abstract MTA Adapter — swap delivery pipes without changing
// anything else. MailWizz today, Postal/PowerMTA/custom tomorrow.
// ═══════════════════════════════════════════════════════════════

export interface MTAList {
  id: string;
  name: string;
  subscriber_count: number;
  created_at?: string;
}

export interface MTASubscriber {
  email: string;
  first_name?: string;
  last_name?: string;
  [key: string]: unknown;
}

export interface MTACampaign {
  id: string;
  name: string;
  list_id: string;
  status: string;
  subject?: string;
  from_name?: string;
  from_email?: string;
  created_at?: string;
}

export interface MTACampaignStats {
  campaign_id: string;
  total_recipients: number;
  sent: number;
  opens: number;
  unique_opens: number;
  clicks: number;
  unique_clicks: number;
  bounces: number;
  hard_bounces: number;
  soft_bounces: number;
  unsubscribes: number;
  complaints: number;
  delivery_rate: number;
  open_rate: number;
  click_rate: number;
}

export interface CreateCampaignInput {
  name: string;
  list_id: string;
  subject: string;
  from_name: string;
  from_email: string;
  html_body: string;
  plain_text?: string;
  reply_to?: string;
}

export interface MTADeliveryServer {
  id: string;
  hostname: string;
  username: string;
  port: number;
  protocol: string;
  from_email: string;
  from_name: string;
  status: string;
  quota_value?: number;
}

export interface RegisterDeliveryServerInput {
  hostname: string;
  username: string;
  password: string;
  port?: number;
  protocol?: string;
  from_email?: string;
  from_name?: string;
  daily_quota?: number;
  hourly_quota?: number;
}

export interface MTAAdapter {
  readonly provider: string;

  /** Check if the MTA is reachable and credentials are valid */
  testConnection(): Promise<{ ok: boolean; message: string }>;

  /** Create a subscriber list on the MTA */
  createList(name: string, defaults?: Record<string, unknown>): Promise<MTAList>;

  /** Get all lists from the MTA */
  getLists(): Promise<MTAList[]>;

  /** Add subscribers to a list. Returns count of successfully added. */
  addSubscribers(listId: string, subscribers: MTASubscriber[]): Promise<{ added: number; failed: number }>;

  /** Create and optionally send a campaign */
  createCampaign(input: CreateCampaignInput): Promise<MTACampaign>;

  /** Send/schedule a campaign that was created as draft */
  sendCampaign(campaignId: string): Promise<{ sent: boolean; message: string }>;

  /** Pause a running campaign */
  pauseCampaign(campaignId: string): Promise<{ paused: boolean; message: string }>;

  /** Get stats for a campaign */
  getCampaignStats(campaignId: string): Promise<MTACampaignStats>;

  /** Get all campaigns */
  getCampaigns(page?: number, perPage?: number): Promise<MTACampaign[]>;

  /** Configure webhook URLs on the MTA so it POSTs events back to Refinery */
  setupWebhooks(baseUrl: string): Promise<{ configured: boolean; webhooks: string[] }>;

  /** Register a delivery server (SMTP pipe) on the EMA */
  registerDeliveryServer(input: RegisterDeliveryServerInput): Promise<MTADeliveryServer>;

  /** List all delivery servers registered on the EMA */
  listDeliveryServers(): Promise<MTADeliveryServer[]>;

  /** Remove a delivery server from the EMA */
  deleteDeliveryServer(serverId: string): Promise<{ ok: boolean }>;
}
