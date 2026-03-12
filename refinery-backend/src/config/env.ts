import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

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

  linodeObj: {
    endpoint: process.env.LINODE_OBJ_ENDPOINT || 'https://us-east-1.linodeobjects.com',
    bucket: process.env.LINODE_OBJ_BUCKET || 'refinery-data',
    accessKey: process.env.LINODE_OBJ_ACCESS_KEY || '',
    secretKey: process.env.LINODE_OBJ_SECRET_KEY || '',
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
