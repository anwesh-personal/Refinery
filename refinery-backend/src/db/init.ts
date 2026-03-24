import { command } from './clickhouse.js';
import { env } from '../config/env.js';

const SCHEMAS = [
  // ── Main lead table ──
  `CREATE TABLE IF NOT EXISTS universal_person (
    up_id                              String,
    cc_id                              Nullable(String),
    first_name                         Nullable(String),
    last_name                          Nullable(String),
    gender                             Nullable(String),
    age_range                          Nullable(String),
    married                            Nullable(String),
    children                           Nullable(String),
    income_range                       Nullable(String),
    net_worth                          Nullable(String),
    homeowner                          Nullable(String),
    social_connections                  Nullable(String),
    business_email                     Nullable(String),
    programmatic_business_emails       Nullable(String),
    personal_emails                    Nullable(String),
    additional_personal_emails         Nullable(String),
    historical_programmatic_emails     Nullable(String),
    mobile_phone                       Nullable(String),
    direct_number                      Nullable(String),
    personal_phone                     Nullable(String),
    linkedin_url                       Nullable(String),
    personal_address                   Nullable(String),
    personal_address_2                 Nullable(String),
    personal_city                      Nullable(String),
    personal_state                     Nullable(String),
    personal_zip                       Nullable(String),
    personal_zip4                      Nullable(String),
    contact_country                    Nullable(String),
    dpv_code                           Nullable(String),
    job_title                          Nullable(String),
    job_title_normalized               Nullable(String),
    seniority_level                    Nullable(String),
    seniority_level_2                  Nullable(String),
    department                         Nullable(String),
    department_2                       Nullable(String),
    professional_address               Nullable(String),
    professional_address_2             Nullable(String),
    professional_city                  Nullable(String),
    professional_state                 Nullable(String),
    professional_zip                   Nullable(String),
    professional_zip4                  Nullable(String),
    company_name                       Nullable(String),
    company_domain                     Nullable(String),
    company_phone                      Nullable(String),
    company_sic                        Nullable(String),
    company_naics                      Nullable(String),
    company_address                    Nullable(String),
    company_city                       Nullable(String),
    company_state                      Nullable(String),
    company_zip                        Nullable(String),
    company_country                    Nullable(String),
    company_linkedin_url               Nullable(String),
    company_revenue                    Nullable(String),
    company_employee_count             Nullable(String),
    primary_industry                   Nullable(String),
    company_description                Nullable(String),
    related_domains                    Nullable(String),
    business_email_validation_status   Nullable(String),
    business_email_last_seen           Nullable(UInt64),
    personal_emails_validation_status  Nullable(String),
    personal_emails_last_seen          Nullable(UInt64),
    company_last_updated               Nullable(UInt64),
    job_title_last_updated             Nullable(UInt64),
    last_updated                       Nullable(UInt64),
    work_history                       Nullable(String),
    education_history                  Nullable(String),
    _ingestion_job_id                  Nullable(String),
    _source_file_name                  Nullable(String),
    _ingested_at                       DateTime DEFAULT now(),
    _segment_ids                       Array(String) DEFAULT [],
    _verification_status               Nullable(String),
    _verified_at                       Nullable(DateTime),
    _v550_category                     Nullable(String),
    _bounced                           UInt8 DEFAULT 0
  ) ENGINE = MergeTree()
    PARTITION BY personal_state
    ORDER BY (personal_state, primary_industry, up_id)
    SETTINGS index_granularity = 8192`,

  // ── Ingestion Jobs ──
  `CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id                String,
    source_bucket     String,
    source_key        String,
    file_name         String,
    file_size_bytes   UInt64 DEFAULT 0,
    rows_ingested     UInt64 DEFAULT 0,
    status            String DEFAULT 'pending',
    error_message     Nullable(String),
    archived_at       Nullable(DateTime),
    delete_after      Nullable(DateTime),
    started_at        DateTime DEFAULT now(),
    completed_at      Nullable(DateTime)
  ) ENGINE = MergeTree()
    ORDER BY (started_at, id)`,

  // ── Segments ──
  `CREATE TABLE IF NOT EXISTS segments (
    id                String,
    name              String,
    niche             Nullable(String),
    client_name       Nullable(String),
    filter_query      String,
    lead_count        UInt64 DEFAULT 0,
    status            String DEFAULT 'draft',
    created_at        DateTime DEFAULT now(),
    updated_at        DateTime DEFAULT now()
  ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY id`,

  // ── Verification Batches ──
  `CREATE TABLE IF NOT EXISTS verification_batches (
    id                String,
    segment_id        String,
    engine            String DEFAULT 'verify550',
    total_leads       UInt64 DEFAULT 0,
    verified_count    UInt64 DEFAULT 0,
    bounced_count     UInt64 DEFAULT 0,
    unknown_count     UInt64 DEFAULT 0,
    status            String DEFAULT 'pending',
    error_message     Nullable(String),
    started_at        DateTime DEFAULT now(),
    completed_at      Nullable(DateTime)
  ) ENGINE = MergeTree()
    ORDER BY (started_at, id)`,

  // ── Target Lists ──
  `CREATE TABLE IF NOT EXISTS target_lists (
    id                String,
    name              String,
    segment_id        String,
    email_count       UInt64 DEFAULT 0,
    export_format     String DEFAULT 'csv',
    file_path         Nullable(String),
    download_url      Nullable(String),
    status            String DEFAULT 'generating',
    created_at        DateTime DEFAULT now()
  ) ENGINE = MergeTree()
    ORDER BY (created_at, id)`,

  // ── Queue Jobs ──
  `CREATE TABLE IF NOT EXISTS queue_jobs (
    id                String,
    target_list_id    String,
    total_emails      UInt64 DEFAULT 0,
    sent_count        UInt64 DEFAULT 0,
    failed_count      UInt64 DEFAULT 0,
    status            String DEFAULT 'queued',
    started_at        Nullable(DateTime),
    completed_at      Nullable(DateTime),
    created_at        DateTime DEFAULT now()
  ) ENGINE = MergeTree()
    ORDER BY (created_at, id)`,

  // ── System Config ──
  `CREATE TABLE IF NOT EXISTS system_config (
    config_key        String,
    config_value      String,
    is_secret         UInt8 DEFAULT 0,
    updated_at        DateTime DEFAULT now()
  ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY config_key`,

  // ── S3 Sources (dynamic, UI-managed) ──
  `CREATE TABLE IF NOT EXISTS s3_sources (
    id                String,
    label             String,
    bucket            String,
    region            String DEFAULT 'us-east-1',
    access_key        String,
    secret_key        String,
    prefix            String DEFAULT '',
    is_active         UInt8 DEFAULT 1,
    last_tested_at    Nullable(DateTime),
    last_test_ok      UInt8 DEFAULT 0,
    created_at        DateTime DEFAULT now(),
    updated_at        DateTime DEFAULT now()
  ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY id`,

  // ── API Keys (machine-to-machine auth for external services) ──
  `CREATE TABLE IF NOT EXISTS api_keys (
    id                String,
    key_hash          String,
    key_prefix        String,
    name              String,
    owner_id          String,
    scopes            Array(String),
    environment       String DEFAULT 'live',
    rate_limit_rpm    UInt32 DEFAULT 60,
    is_active         UInt8 DEFAULT 1,
    last_used_at      Nullable(DateTime),
    created_at        DateTime DEFAULT now(),
    updated_at        DateTime DEFAULT now(),
    expires_at        Nullable(DateTime)
  ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY id`,

  // ── Engagement Events (webhook data from MTAs) ──
  `CREATE TABLE IF NOT EXISTS engagement_events (
    id                String,
    event_type        String,
    email             String,
    up_id             Nullable(String),
    campaign_id       Nullable(String),
    list_id           Nullable(String),
    mta_provider      String DEFAULT 'mailwizz',
    bounce_type       Nullable(String),
    bounce_reason     Nullable(String),
    link_url          Nullable(String),
    user_agent        Nullable(String),
    ip_address        Nullable(String),
    raw_payload       Nullable(String),
    event_id          Nullable(String),
    received_at       DateTime DEFAULT now()
  ) ENGINE = MergeTree()
    PARTITION BY toYYYYMM(received_at)
    ORDER BY (event_type, email, received_at)`,

  // ── Campaigns (sent via MTA adapters) ──
  `CREATE TABLE IF NOT EXISTS campaigns (
    id                String,
    name              String,
    segment_id        Nullable(String),
    mta_provider      String DEFAULT 'mailwizz',
    mta_campaign_id   Nullable(String),
    mta_list_id       Nullable(String),
    subject           Nullable(String),
    from_name         Nullable(String),
    from_email        Nullable(String),
    status            String DEFAULT 'draft',
    total_recipients  UInt64 DEFAULT 0,
    sent_count        UInt64 DEFAULT 0,
    open_count        UInt64 DEFAULT 0,
    click_count       UInt64 DEFAULT 0,
    bounce_count      UInt64 DEFAULT 0,
    reply_count       UInt64 DEFAULT 0,
    created_at        DateTime DEFAULT now(),
    updated_at        DateTime DEFAULT now()
  ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY id`,

  // ── Pipeline Studio Jobs (async verification) ──
  `CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id                String,
    total_emails      UInt64 DEFAULT 0,
    processed_count   UInt64 DEFAULT 0,
    safe_count        UInt64 DEFAULT 0,
    risky_count       UInt64 DEFAULT 0,
    rejected_count    UInt64 DEFAULT 0,
    uncertain_count   UInt64 DEFAULT 0,
    duplicates_removed UInt64 DEFAULT 0,
    typos_fixed       UInt64 DEFAULT 0,
    status            String DEFAULT 'queued',
    error_message     Nullable(String),
    results_json      Nullable(String),
    config_json       Nullable(String),
    started_at        DateTime DEFAULT now(),
    completed_at      Nullable(DateTime)
  ) ENGINE = MergeTree()
    ORDER BY (started_at, id)`,
];

export async function initDatabase(): Promise<void> {
  console.log(`[DB] Creating database "${env.clickhouse.database}" if not exists...`);
  // Database creation must happen on default connection
  await command(`CREATE DATABASE IF NOT EXISTS ${env.clickhouse.database}`);

  console.log(`[DB] Running ${SCHEMAS.length} schema migrations...`);
  for (let i = 0; i < SCHEMAS.length; i++) {
    await command(SCHEMAS[i]);
    console.log(`[DB] ✓ Schema ${i + 1}/${SCHEMAS.length} applied`);
  }

  // ── User Attribution Columns ──
  // Add performed_by (user UUID) and performed_by_name (display name) to all operation tables.
  // Uses ADD COLUMN IF NOT EXISTS so this is idempotent and safe to re-run.
  const ATTRIBUTION_TABLES = [
    'ingestion_jobs',
    'segments',
    'verification_batches',
    'pipeline_jobs',
    'target_lists',
    'queue_jobs',
  ];
  for (const table of ATTRIBUTION_TABLES) {
    await command(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS performed_by Nullable(String)`);
    await command(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS performed_by_name Nullable(String)`);
  }
  console.log(`[DB] ✓ User attribution columns ensured on ${ATTRIBUTION_TABLES.length} tables`);

  // ── V550 Category Column ──
  await command(`ALTER TABLE universal_person ADD COLUMN IF NOT EXISTS _v550_category Nullable(String)`);
  await command(`ALTER TABLE universal_person ADD COLUMN IF NOT EXISTS _bounced UInt8 DEFAULT 0`);
  console.log('[DB] ✓ V550 category + bounced columns ensured on universal_person');

  console.log('[DB] ✓ All tables initialized');
}

// Run directly: npx tsx src/db/init.ts
const isDirectRun = process.argv[1]?.endsWith('init.ts') || process.argv[1]?.endsWith('init.js');
if (isDirectRun) {
  initDatabase()
    .then(() => { console.log('[DB] Done.'); process.exit(0); })
    .catch((e) => { console.error('[DB] FATAL:', e); process.exit(1); });
}
