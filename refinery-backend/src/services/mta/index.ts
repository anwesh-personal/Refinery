import type { MTAAdapter } from './adapter.js';
import { MailWizzAdapter } from './mailwizz.js';
import { query } from '../../db/clickhouse.js';

// ═══════════════════════════════════════════════════════════════
// MTA Registry — resolves provider name → adapter instance
// Config stored in system_config (ClickHouse), same as other configs
// ═══════════════════════════════════════════════════════════════

export type { MTAAdapter, MTAList, MTASubscriber, MTACampaign, MTACampaignStats, CreateCampaignInput } from './adapter.js';

interface MTAConfig {
  provider: string;
  base_url: string;
  api_key: string;
}

/** Fetch MTA config from system_config table */
async function loadMtaConfig(): Promise<MTAConfig | null> {
  try {
    const rows = await query<{ config_key: string; config_value: string }>(
      `SELECT config_key, config_value FROM system_config FINAL
       WHERE config_key IN ('mta_provider', 'mta_base_url', 'mta_api_key')`,
    );

    const map = new Map(rows.map(r => [r.config_key, r.config_value]));
    const provider = map.get('mta_provider');
    const baseUrl = map.get('mta_base_url');
    const apiKey = map.get('mta_api_key');

    if (!provider || !baseUrl || !apiKey) return null;

    return { provider, base_url: baseUrl, api_key: apiKey };
  } catch {
    return null;
  }
}

/** Get the active MTA adapter, or null if not configured */
export async function getMtaAdapter(): Promise<MTAAdapter | null> {
  const config = await loadMtaConfig();
  if (!config) return null;

  switch (config.provider) {
    case 'mailwizz':
      return new MailWizzAdapter({
        baseUrl: config.base_url,
        apiKey: config.api_key,
      });

    default:
      console.warn(`[MTA] Unknown provider: ${config.provider}`);
      return null;
  }
}

/** Create an adapter directly from provided config (for testing) */
export function createAdapter(provider: string, baseUrl: string, apiKey: string): MTAAdapter {
  switch (provider) {
    case 'mailwizz':
      return new MailWizzAdapter({ baseUrl, apiKey });
    default:
      throw new Error(`Unsupported MTA provider: ${provider}`);
  }
}
