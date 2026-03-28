import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  // FRONTEND_URL can be comma-separated for CORS (e.g. "https://iiiemail.email,http://localhost:5173").
  // For auth redirects (magic links, password resets) we need a single origin — always the first entry.
  frontendOrigin: (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim(),

  supabase: {
    url: process.env.VITE_SUPABASE_URL || '',
    publishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
    secretKey: process.env.SUPABASE_SECRET_KEY || '',
  },

  clickhouse: {
    host: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
    user: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    database: process.env.CLICKHOUSE_DATABASE || 'refinery',
  },

  s3Source: {
    bucket: process.env.S3_SOURCE_BUCKET || '',
    region: process.env.S3_SOURCE_REGION || 'us-east-1',
    accessKey: process.env.S3_SOURCE_ACCESS_KEY || '',
    secretKey: process.env.S3_SOURCE_SECRET_KEY || '',
  },

  objectStorage: {
    endpoint: process.env.OBJ_STORAGE_ENDPOINT || process.env.LINODE_OBJ_ENDPOINT || 'http://localhost:9000',
    bucket: process.env.OBJ_STORAGE_BUCKET || process.env.LINODE_OBJ_BUCKET || 'refinery-data',
    accessKey: process.env.OBJ_STORAGE_ACCESS_KEY || process.env.LINODE_OBJ_ACCESS_KEY || '',
    secretKey: process.env.OBJ_STORAGE_SECRET_KEY || process.env.LINODE_OBJ_SECRET_KEY || '',
  },

  verify550: {
    endpoint: process.env.VERIFY550_ENDPOINT || '',
    apiKey: process.env.VERIFY550_API_KEY || '',
    batchSize: Number(process.env.VERIFY550_BATCH_SIZE || 5000),
    concurrency: Number(process.env.VERIFY550_CONCURRENCY || 3),
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    fromEmail: process.env.SMTP_FROM_EMAIL || '',
    rateLimitPerHour: Number(process.env.SMTP_RATE_LIMIT_PER_HOUR || 500),
  },
} as const;

/**
 * Validate critical environment variables at startup.
 * Hard failures = process exits. Soft warnings = feature disabled.
 */
export function validateEnv(): void {
  const fatal: string[] = [];
  const warn: string[] = [];

  // ── Hard requirements (server cannot function without these) ──
  if (!env.supabase.url) fatal.push('VITE_SUPABASE_URL');
  if (!env.supabase.secretKey) fatal.push('SUPABASE_SECRET_KEY');
  if (!env.clickhouse.host) fatal.push('CLICKHOUSE_HOST');

  // ── Soft warnings (features degraded but server can boot) ──
  if (!env.objectStorage.accessKey || !env.objectStorage.secretKey) {
    warn.push('OBJ_STORAGE_ACCESS_KEY / OBJ_STORAGE_SECRET_KEY — MinIO archival will fail');
  }
  if (!env.supabase.publishableKey) {
    warn.push('VITE_SUPABASE_PUBLISHABLE_KEY — auth may not work');
  }

  for (const w of warn) {
    console.warn(`[ENV] ⚠ Missing optional: ${w}`);
  }

  if (fatal.length > 0) {
    console.error(`[ENV] ✗ FATAL — Missing required environment variables:\n  ${fatal.join('\n  ')}`);
    console.error('[ENV] Server cannot start. Set these in .env and restart.');
    process.exit(1);
  }

  console.log('[ENV] ✓ All critical environment variables validated.');
}
