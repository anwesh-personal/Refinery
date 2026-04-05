import { query, insertRows } from '../db/clickhouse.js';

/** Default values for numeric config — used when key is not yet set in system_config */
const CONFIG_DEFAULTS: Record<string, number> = {
  'pipeline.max_emails_per_job': 200_000,
  'pipeline.smtp_concurrency': 10,
  'segment.export_limit': 200_000,
  'clickhouse.max_query_size': 512, // 512 MB
  'ingestion.max_concurrent': 5,
  'ingestion.batch_size': 10_000,
  'ingestion.max_auto_retries': 3,
  'ingestion.insert_timeout_sec': 300,
  'ingestion.recovery_delay_sec': 5,
  'node.heap_size_mb': 12_288, // 12 GB
};

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

/**
 * Get a numeric config value with a typed fallback default.
 * Reads from system_config in ClickHouse. If not found or unparseable,
 * falls back to CONFIG_DEFAULTS, then to the provided fallback.
 */
export async function getConfigInt(key: string, fallback?: number): Promise<number> {
  const raw = await getConfig(key);
  if (raw !== null) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return CONFIG_DEFAULTS[key] ?? fallback ?? 0;
}

/** Config key constants */
export const CONFIG_KEYS = {
  SERVER_IP: 'server.ip',
  SERVER_SSH_PORT: 'server.ssh_port',
  SERVER_SSH_KEY: 'server.ssh_key_path',
  CH_HOST: 'clickhouse.host',
  CH_PORT: 'clickhouse.port',
  CH_DATABASE: 'clickhouse.database',
  CH_USER: 'clickhouse.user',
  CH_PASSWORD: 'clickhouse.password',
  OBJ_STORAGE_ENDPOINT: 'obj_storage.endpoint',
  OBJ_STORAGE_ACCESS_KEY: 'obj_storage.access_key',
  OBJ_STORAGE_SECRET_KEY: 'obj_storage.secret_key',
  OBJ_STORAGE_BUCKET: 'obj_storage.bucket',
  SMTP_HOST: 'smtp.host',
  SMTP_PORT: 'smtp.port',
  SMTP_FROM: 'smtp.from_email',
  SMTP_PASSWORD: 'smtp.password',
  MAILWIZZ_API_URL: 'mailwizz_api_url',
  MAILWIZZ_API_KEY: 'mailwizz_api_key',
  // Pipeline Studio limits
  PIPELINE_MAX_EMAILS: 'pipeline.max_emails_per_job',
  PIPELINE_SMTP_CONCURRENCY: 'pipeline.smtp_concurrency',
  // Segment export limits
  SEGMENT_EXPORT_LIMIT: 'segment.export_limit',
  // ClickHouse tuning
  CH_MAX_QUERY_SIZE: 'clickhouse.max_query_size',
  // Ingestion tuning
  INGESTION_MAX_CONCURRENT: 'ingestion.max_concurrent',
  INGESTION_BATCH_SIZE: 'ingestion.batch_size',
  INGESTION_MAX_AUTO_RETRIES: 'ingestion.max_auto_retries',
  INGESTION_INSERT_TIMEOUT_SEC: 'ingestion.insert_timeout_sec',
  INGESTION_RECOVERY_DELAY_SEC: 'ingestion.recovery_delay_sec',
  // Node.js tuning
  NODE_HEAP_SIZE_MB: 'node.heap_size_mb',
} as const;
