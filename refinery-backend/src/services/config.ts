import { query, insertRows } from '../db/clickhouse.js';

/** Get a config value */
export async function getConfig(key: string): Promise<string | null> {
  const rows = await query<{ config_value: string }>(
    `SELECT config_value FROM system_config FINAL WHERE config_key = '${key}' LIMIT 1`,
  );
  return rows[0]?.config_value || null;
}

/** Set a config value */
export async function setConfig(key: string, value: string, isSecret = false): Promise<void> {
  await insertRows('system_config', [{
    config_key: key,
    config_value: value,
    is_secret: isSecret ? 1 : 0,
  }]);
}

/** Get all config (mask secrets) */
export async function getAllConfig(): Promise<Record<string, string>> {
  const rows = await query<{ config_key: string; config_value: string; is_secret: number }>(
    'SELECT config_key, config_value, is_secret FROM system_config FINAL ORDER BY config_key',
  );

  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.config_key] = row.is_secret ? '••••••••' : row.config_value;
  }
  return config;
}

/** Batch-save config from the UI */
export async function saveConfigBatch(entries: { key: string; value: string; isSecret?: boolean }[]): Promise<void> {
  for (const entry of entries) {
    // Don't overwrite secrets with the masked value
    if (entry.value === '••••••••') continue;
    await setConfig(entry.key, entry.value, entry.isSecret);
  }
}

/** Config key constants */
export const CONFIG_KEYS = {
  LINODE_IP: 'linode.ip',
  LINODE_SSH_PORT: 'linode.ssh_port',
  LINODE_SSH_KEY: 'linode.ssh_key_path',
  CH_HOST: 'clickhouse.host',
  CH_PORT: 'clickhouse.port',
  CH_DATABASE: 'clickhouse.database',
  CH_USER: 'clickhouse.user',
  CH_PASSWORD: 'clickhouse.password',
  LINODE_OBJ_ENDPOINT: 'linode_obj.endpoint',
  LINODE_OBJ_ACCESS_KEY: 'linode_obj.access_key',
  LINODE_OBJ_SECRET_KEY: 'linode_obj.secret_key',
  LINODE_OBJ_BUCKET: 'linode_obj.bucket',
  SMTP_HOST: 'smtp.host',
  SMTP_PORT: 'smtp.port',
  SMTP_FROM: 'smtp.from_email',
  SMTP_PASSWORD: 'smtp.password',
} as const;
