import { query, insertRows, command } from '../db/clickhouse.js';
import { genId } from '../utils/helpers.js';
import { createAdapter } from './mta/index.js';

// ═══════════════════════════════════════════════════════════════
// MTA Provider Management — CRUD for MTA connections stored in
// dedicated ClickHouse tables (mta_providers, sending_domains).
// Default provider also syncs to system_config for v1 API compat.
// ═══════════════════════════════════════════════════════════════

export interface MTAProvider {
  id: string;
  name: string;                   // Human label e.g. "MailWizz Production"
  provider_type: string;          // 'mailwizz' | 'sendgrid' | 'ses' | 'mailgun' | 'smtp'
  base_url: string;               // e.g. https://mail.iiiemail.email/api
  api_key: string;                // masked on read
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  last_test_at: string | null;
  last_test_ok: boolean | null;
}

export interface SendingDomain {
  id: string;
  provider_id: string;
  domain: string;
  from_email: string;
  from_name: string;
  spf_ok: boolean | null;
  dkim_ok: boolean | null;
  dmarc_ok: boolean | null;
  blacklisted: boolean | null;
  last_check_at: string | null;
  created_at: string;
}

// ────────────── Table bootstrap ──────────────

export async function ensureTables(): Promise<void> {
  await command(`
    CREATE TABLE IF NOT EXISTS mta_providers (
      id           String,
      name         String,
      provider_type String,
      base_url     String,
      api_key      String,
      is_active    UInt8 DEFAULT 1,
      is_default   UInt8 DEFAULT 0,
      created_at   DateTime DEFAULT now(),
      last_test_at Nullable(DateTime),
      last_test_ok Nullable(UInt8),
      _version     UInt64 DEFAULT toUnixTimestamp(now())
    ) ENGINE = ReplacingMergeTree(_version)
    ORDER BY id
  `);

  await command(`
    CREATE TABLE IF NOT EXISTS sending_domains (
      id           String,
      provider_id  String,
      domain       String,
      from_email   String,
      from_name    String DEFAULT '',
      spf_ok       Nullable(UInt8),
      dkim_ok      Nullable(UInt8),
      dmarc_ok     Nullable(UInt8),
      blacklisted  Nullable(UInt8),
      last_check_at Nullable(DateTime),
      created_at   DateTime DEFAULT now(),
      _version     UInt64 DEFAULT toUnixTimestamp(now())
    ) ENGINE = ReplacingMergeTree(_version)
    ORDER BY id
  `);
}

// ────────────── Providers CRUD ──────────────

export async function listProviders(): Promise<MTAProvider[]> {
  const rows = await query<any>(`
    SELECT * FROM mta_providers FINAL
    ORDER BY is_default DESC, created_at DESC
  `);
  return rows.map(maskProvider);
}

export async function getProvider(id: string): Promise<MTAProvider | null> {
  const rows = await query<any>(
    `SELECT * FROM mta_providers FINAL WHERE id = '${esc(id)}' LIMIT 1`,
  );
  return rows[0] ? maskProvider(rows[0]) : null;
}

/** Get RAW provider (with real API key) for adapter construction */
export async function getProviderRaw(id: string): Promise<MTAProvider | null> {
  const rows = await query<any>(
    `SELECT * FROM mta_providers FINAL WHERE id = '${esc(id)}' LIMIT 1`,
  );
  return rows[0] ? toProvider(rows[0]) : null;
}

export async function createProvider(input: {
  name: string;
  provider_type: string;
  base_url: string;
  api_key: string;
  is_default?: boolean;
}): Promise<string> {
  const id = genId();

  // If setting as default, unset any existing default
  if (input.is_default) {
    await command(`ALTER TABLE mta_providers UPDATE is_default = 0 WHERE is_default = 1`);
  }

  await insertRows('mta_providers', [{
    id,
    name: input.name,
    provider_type: input.provider_type,
    base_url: input.base_url.replace(/\/+$/, ''),
    api_key: input.api_key,
    is_active: 1,
    is_default: input.is_default ? 1 : 0,
  }]);

  // Also write to system_config for backward compat with existing getMtaAdapter()
  if (input.is_default) {
    await syncDefaultToSystemConfig(input.provider_type, input.base_url, input.api_key);
  }

  return id;
}

export async function updateProvider(id: string, updates: Partial<{
  name: string;
  base_url: string;
  api_key: string;
  is_active: boolean;
  is_default: boolean;
}>): Promise<void> {
  const existing = await getProviderRaw(id);
  if (!existing) throw new Error(`Provider ${id} not found`);

  if (updates.is_default) {
    await command(`ALTER TABLE mta_providers UPDATE is_default = 0 WHERE is_default = 1`);
  }

  const merged = {
    ...existing,
    ...updates,
    is_active: updates.is_active !== undefined ? (updates.is_active ? 1 : 0) : (existing.is_active ? 1 : 0),
    is_default: updates.is_default !== undefined ? (updates.is_default ? 1 : 0) : (existing.is_default ? 1 : 0),
  };

  // Use the existing api_key if the update sends the masked placeholder
  if (updates.api_key === '••••••••' || !updates.api_key) {
    merged.api_key = existing.api_key;
  }

  await insertRows('mta_providers', [{
    id,
    name: merged.name,
    provider_type: merged.provider_type,
    base_url: (merged.base_url || '').replace(/\/+$/, ''),
    api_key: merged.api_key,
    is_active: merged.is_active,
    is_default: merged.is_default,
  }]);

  if (merged.is_default) {
    await syncDefaultToSystemConfig(merged.provider_type, merged.base_url, merged.api_key);
  }
}

export async function deleteProvider(id: string): Promise<void> {
  await command(`ALTER TABLE mta_providers DELETE WHERE id = '${esc(id)}'`);
  await command(`ALTER TABLE sending_domains DELETE WHERE provider_id = '${esc(id)}'`);
}

export async function testProvider(id: string): Promise<{ ok: boolean; message: string }> {
  const provider = await getProviderRaw(id);
  if (!provider) throw new Error(`Provider ${id} not found`);

  const adapter = createAdapter(provider.provider_type, provider.base_url, provider.api_key);
  const result = await adapter.testConnection();

  // Update last_test timestamp
  await insertRows('mta_providers', [{
    id,
    name: provider.name,
    provider_type: provider.provider_type,
    base_url: provider.base_url,
    api_key: provider.api_key,
    is_active: provider.is_active ? 1 : 0,
    is_default: provider.is_default ? 1 : 0,
    last_test_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    last_test_ok: result.ok ? 1 : 0,
  }]);

  return result;
}

// ────────────── Sending Domains CRUD ──────────────

export async function listDomains(providerId?: string): Promise<SendingDomain[]> {
  const where = providerId ? `WHERE provider_id = '${esc(providerId)}'` : '';
  const rows = await query<any>(`
    SELECT * FROM sending_domains FINAL ${where}
    ORDER BY created_at DESC
  `);
  return rows.map(toDomain);
}

export async function createDomain(input: {
  provider_id: string;
  domain: string;
  from_email: string;
  from_name?: string;
}): Promise<string> {
  const id = genId();
  await insertRows('sending_domains', [{
    id,
    provider_id: input.provider_id,
    domain: input.domain,
    from_email: input.from_email,
    from_name: input.from_name || '',
  }]);
  return id;
}

export async function deleteDomain(id: string): Promise<void> {
  await command(`ALTER TABLE sending_domains DELETE WHERE id = '${esc(id)}'`);
}

export async function checkDomainDNS(id: string): Promise<{ spf: boolean; dkim: boolean; dmarc: boolean }> {
  const rows = await query<any>(
    `SELECT * FROM sending_domains FINAL WHERE id = '${esc(id)}' LIMIT 1`,
  );
  if (!rows[0]) throw new Error(`Domain ${id} not found`);
  const domain = rows[0].domain;

  // DNS checks via Node's built-in dns module
  const { promises: dns } = await import('dns');

  let spf = false;
  let dkim = false;
  let dmarc = false;

  try {
    const txtRecords = await dns.resolveTxt(domain);
    const flat = txtRecords.map(r => r.join(''));
    spf = flat.some(r => r.includes('v=spf1'));
  } catch { /* no SPF record */ }

  try {
    const dmarcRecords = await dns.resolveTxt(`_dmarc.${domain}`);
    const flat = dmarcRecords.map(r => r.join(''));
    dmarc = flat.some(r => r.includes('v=DMARC1'));
  } catch { /* no DMARC */ }

  try {
    // Check common DKIM selectors
    for (const selector of ['default', 'google', 'k1', 'mail', 'dkim', 's1', 's2']) {
      try {
        const dkimRecords = await dns.resolveTxt(`${selector}._domainkey.${domain}`);
        const flat = dkimRecords.map(r => r.join(''));
        if (flat.some(r => r.includes('v=DKIM1') || r.includes('p='))) {
          dkim = true;
          break;
        }
      } catch { /* no record for this selector */ }
    }
  } catch { /* no DKIM */ }

  // Save results
  await insertRows('sending_domains', [{
    id,
    provider_id: rows[0].provider_id,
    domain,
    from_email: rows[0].from_email,
    from_name: rows[0].from_name || '',
    spf_ok: spf ? 1 : 0,
    dkim_ok: dkim ? 1 : 0,
    dmarc_ok: dmarc ? 1 : 0,
    last_check_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  }]);

  return { spf, dkim, dmarc };
}

// ────────────── Helpers ──────────────

function esc(s: string): string {
  return s.replace(/'/g, "\\'");
}

function maskProvider(row: any): MTAProvider {
  return {
    ...toProvider(row),
    api_key: row.api_key ? '••••••••' : '',
  };
}

function toProvider(row: any): MTAProvider {
  return {
    id: row.id,
    name: row.name,
    provider_type: row.provider_type,
    base_url: row.base_url,
    api_key: row.api_key || '',
    is_active: !!Number(row.is_active),
    is_default: !!Number(row.is_default),
    created_at: row.created_at,
    last_test_at: row.last_test_at || null,
    last_test_ok: row.last_test_ok != null ? !!Number(row.last_test_ok) : null,
  };
}

function toDomain(row: any): SendingDomain {
  return {
    id: row.id,
    provider_id: row.provider_id,
    domain: row.domain,
    from_email: row.from_email,
    from_name: row.from_name || '',
    spf_ok: row.spf_ok != null ? !!Number(row.spf_ok) : null,
    dkim_ok: row.dkim_ok != null ? !!Number(row.dkim_ok) : null,
    dmarc_ok: row.dmarc_ok != null ? !!Number(row.dmarc_ok) : null,
    blacklisted: row.blacklisted != null ? !!Number(row.blacklisted) : null,
    last_check_at: row.last_check_at || null,
    created_at: row.created_at,
  };
}

/** Sync the default provider to system_config for backward compat with existing v1 MTA routes */
async function syncDefaultToSystemConfig(providerType: string, baseUrl: string, apiKey: string) {
  for (const entry of [
    { config_key: 'mta_provider', config_value: providerType, is_secret: 0 },
    { config_key: 'mta_base_url', config_value: baseUrl.replace(/\/+$/, ''), is_secret: 0 },
    { config_key: 'mta_api_key', config_value: apiKey, is_secret: 1 },
  ]) {
    await insertRows('system_config', [entry]);
  }
}
