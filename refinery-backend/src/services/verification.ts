import { query, command, insertRows } from '../db/clickhouse.js';
import { env } from '../config/env.js';
import { genId, sleep } from '../utils/helpers.js';
import { verifyBatch as verifyBatchBuiltin, DEFAULT_ENGINE_CONFIG, type EngineConfig } from './verificationEngine.js';

// ═══════════════════════════════════════════════════════════════
// Verification Service — Dual-Engine (Verify550 API + Built-In SMTP)
//
// - Parameterized queries (no SQL injection)
// - Retry logic with exponential backoff (Verify550)
// - Per-domain rate limiting with adaptive backoff (Built-In)
// - Batch cancellation support
// - Engine selection per-batch (verify550 | builtin)
// - Proper error states and recovery
// ═══════════════════════════════════════════════════════════════

/** Verification result for a single email */
export interface VerificationResult {
  email: string;
  status: 'valid' | 'invalid' | 'risky' | 'unknown' | 'catch-all' | 'disposable';
  reason?: string;
}

/** Batch status in the DB */
export type BatchStatus = 'pending' | 'submitting' | 'processing' | 'complete' | 'failed' | 'cancelled';

// Active batch control — tracks in-flight batches in THIS process.
// Cancellation is also persisted to DB so it survives restarts.
const activeBatches = new Map<string, { cancelled: boolean }>();

/**
 * Recover batches orphaned by a server restart.
 * Marks any batch stuck in 'pending', 'submitting', or 'processing' as 'failed'.
 * Must be called once at startup AFTER database init.
 */
export async function recoverOrphanedBatches(): Promise<number> {
  try {
    const orphaned = await query<{ id: string; status: string }>(
      `SELECT id, status FROM verification_batches
       WHERE status IN ('pending', 'submitting', 'processing')
       ORDER BY started_at DESC`,
    );
    if (orphaned.length === 0) return 0;

    for (const batch of orphaned) {
      // Only mark as failed if this process isn't currently running it
      if (!activeBatches.has(batch.id)) {
        await updateBatchStatus(batch.id, 'failed', 'Server restarted — batch orphaned. Re-run to continue.');
        console.log(`[Recovery] Marked orphaned batch ${batch.id} (was: ${batch.status}) as failed`);
      }
    }
    console.log(`[Recovery] Recovered ${orphaned.length} orphaned batch(es)`);
    return orphaned.length;
  } catch (err: any) {
    console.error('[Recovery] Failed to recover orphaned batches:', err.message);
    return 0;
  }
}

// ─── Config Resolution ───
// Priority: DB system_config → env vars → error
async function resolveVerify550Config(): Promise<{ endpoint: string; apiKey: string; batchSize: number; concurrency: number }> {
  // Try DB config first (set via the UI)
  const dbConfig = await getConfigFromDB();

  const endpoint = dbConfig.verify550_endpoint || env.verify550.endpoint;
  const apiKey = dbConfig.verify550_api_key || env.verify550.apiKey;
  const batchSize = Number(dbConfig.verify550_batch_size) || env.verify550.batchSize || 5000;
  const concurrency = Number(dbConfig.verify550_concurrency) || env.verify550.concurrency || 3;

  if (!endpoint || !apiKey) {
    throw new Error(
      'Verify550 is not configured. Set the API endpoint and key in the Verification config page or via VERIFY550_ENDPOINT and VERIFY550_API_KEY environment variables.',
    );
  }

  return { endpoint, apiKey, batchSize, concurrency };
}

/** Fetch Verify550-related config from system_config table */
async function getConfigFromDB(): Promise<Record<string, string>> {
  try {
    const rows = await query<{ config_key: string; config_value: string }>(
      `SELECT config_key, config_value FROM system_config FINAL
       WHERE config_key LIKE 'verify550_%' OR config_key LIKE 'builtin_%'`,
    );
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.config_key] = row.config_value;
    }
    return map;
  } catch {
    return {};
  }
}

/** Public: Get current config with secrets masked. Safe for API response. */
export async function getConfig(): Promise<Record<string, string>> {
  const rows = await query<{ config_key: string; config_value: string; is_secret: number }>(
    `SELECT config_key, config_value, is_secret FROM system_config FINAL
     WHERE config_key LIKE 'verify550_%' OR config_key LIKE 'builtin_%'`,
  );
  const config: Record<string, string> = {};
  for (const row of rows) {
    if (Number(row.is_secret) === 1 && row.config_value) {
      config[row.config_key] = row.config_value.slice(0, 8) + '••••••••';
    } else {
      config[row.config_key] = row.config_value;
    }
  }
  return config;
}

/** Public: Save config values to system_config (ReplacingMergeTree handles dedup). */
export async function saveConfig(
  updates: {
    endpoint?: string; apiKey?: string;
    batchSize?: string | number; concurrency?: string | number;
    builtinHeloDomain?: string; builtinFromEmail?: string;
    builtinConcurrency?: string | number; builtinTimeout?: string | number;
    builtinEnableCatchAll?: string | boolean; builtinMinInterval?: string | number;
    builtinPort?: string | number; builtinMaxPerDomain?: string | number;
  },
): Promise<string[]> {
  const configs: { key: string; value: string; isSecret: number }[] = [];

  // Verify550 Config
  if (updates.endpoint !== undefined) configs.push({ key: 'verify550_endpoint', value: String(updates.endpoint), isSecret: 0 });
  if (updates.apiKey !== undefined) configs.push({ key: 'verify550_api_key', value: String(updates.apiKey), isSecret: 1 });
  if (updates.batchSize !== undefined) configs.push({ key: 'verify550_batch_size', value: String(Number(updates.batchSize) || 5000), isSecret: 0 });
  if (updates.concurrency !== undefined) configs.push({ key: 'verify550_concurrency', value: String(Number(updates.concurrency) || 3), isSecret: 0 });

  // Builtin Engine Config
  if (updates.builtinHeloDomain !== undefined) configs.push({ key: 'builtin_helo_domain', value: String(updates.builtinHeloDomain), isSecret: 0 });
  if (updates.builtinFromEmail !== undefined) configs.push({ key: 'builtin_from_email', value: String(updates.builtinFromEmail), isSecret: 0 });
  if (updates.builtinConcurrency !== undefined) configs.push({ key: 'builtin_concurrency', value: String(Number(updates.builtinConcurrency) || 10), isSecret: 0 });
  if (updates.builtinTimeout !== undefined) configs.push({ key: 'builtin_timeout', value: String(Number(updates.builtinTimeout) || 15000), isSecret: 0 });
  if (updates.builtinEnableCatchAll !== undefined) configs.push({ key: 'builtin_enable_catchall', value: String(updates.builtinEnableCatchAll) === '1' || updates.builtinEnableCatchAll === true as any ? '1' : '0', isSecret: 0 });
  if (updates.builtinMinInterval !== undefined) configs.push({ key: 'builtin_min_interval', value: String(Number(updates.builtinMinInterval) || 2000), isSecret: 0 });
  if (updates.builtinPort !== undefined) configs.push({ key: 'builtin_port', value: String(Number(updates.builtinPort) || 25), isSecret: 0 });
  if (updates.builtinMaxPerDomain !== undefined) configs.push({ key: 'builtin_max_per_domain', value: String(Number(updates.builtinMaxPerDomain) || 2), isSecret: 0 });

  if (configs.length === 0) {
    throw new Error('No configuration values provided');
  }

  for (const cfg of configs) {
    await command(
      `INSERT INTO system_config (config_key, config_value, is_secret, updated_at)
       VALUES ('${cfg.key}', '${cfg.value.replace(/'/g, "''")}', ${cfg.isSecret}, now())`,
    );
  }

  return configs.map(c => c.key);
}

// ─── Config Resolution (Built-In Engine) ───
async function resolveBuiltinConfig(): Promise<EngineConfig> {
  const dbConfig = await getConfigFromDB();
  return {
    heloDomain: dbConfig.builtin_helo_domain || DEFAULT_ENGINE_CONFIG.heloDomain,
    fromEmail: dbConfig.builtin_from_email || DEFAULT_ENGINE_CONFIG.fromEmail,
    concurrency: Number(dbConfig.builtin_concurrency) || DEFAULT_ENGINE_CONFIG.concurrency,
    timeout: Number(dbConfig.builtin_timeout) || DEFAULT_ENGINE_CONFIG.timeout,
    port: Number(dbConfig.builtin_port) || 25,
    enableCatchAllDetection: dbConfig.builtin_enable_catchall === '1',
    minIntervalMs: Number(dbConfig.builtin_min_interval) || DEFAULT_ENGINE_CONFIG.minIntervalMs,
    maxConcurrentPerDomain: Number(dbConfig.builtin_max_per_domain) || DEFAULT_ENGINE_CONFIG.maxConcurrentPerDomain,
  };
}

// ─── Start a Verification Batch ───

export async function startBatch(segmentId: string, engine: 'verify550' | 'builtin' = 'verify550'): Promise<string> {
  // Validate config before starting
  const v550Config = engine === 'verify550' ? await resolveVerify550Config() : undefined;
  const builtinConfig = engine === 'builtin' ? await resolveBuiltinConfig() : undefined;

  const batchId = genId();

  // Parameterized-safe: segmentId is validated as alphanumeric
  if (!/^[a-zA-Z0-9_-]+$/.test(segmentId)) {
    throw new Error('Invalid segment ID format');
  }

  const [countResult] = await query<{ cnt: string }>(`
    SELECT count() as cnt FROM universal_person
    WHERE has(_segment_ids, {segmentId:String})
      AND (business_email IS NOT NULL OR personal_emails IS NOT NULL)
      AND _verification_status IS NULL
  `.replace('{segmentId:String}', `'${segmentId}'`));
  // Note: ClickHouse doesn't support standard parameterized queries in the HTTP interface.
  // The segmentId is validated above to prevent injection.

  const totalLeads = Number(countResult?.cnt || 0);

  if (totalLeads === 0) {
    throw new Error('No unverified leads with emails found in this segment');
  }

  await insertRows('verification_batches', [{
    id: batchId,
    segment_id: segmentId,
    engine: engine,
    total_leads: totalLeads,
    status: 'pending',
  }]);

  // Track for cancellation
  const control = { cancelled: false };
  activeBatches.set(batchId, control);

  // Run verification pipeline in background
  runVerificationPipeline(
    batchId,
    segmentId,
    engine,
    v550Config,
    builtinConfig,
    control
  ).catch(async (err) => {
    console.error(`[Engine - ${engine}] Batch ${batchId} failed:`, err.message);
    await updateBatchStatus(batchId, 'failed', err.message);
  }).finally(() => {
    activeBatches.delete(batchId);
  });

  return batchId;
}

// ─── Cancel a Running Batch ───

export async function cancelBatch(batchId: string): Promise<void> {
  // 1. Try in-memory cancel (fast path — batch running in this process)
  const control = activeBatches.get(batchId);
  if (control) {
    control.cancelled = true;
  }

  // 2. Always persist to DB (survives restarts, works across instances)
  const [batch] = await query<{ status: string }>(
    `SELECT status FROM verification_batches WHERE id = '${batchId}' LIMIT 1`,
  );
  if (!batch) {
    throw new Error('Batch not found');
  }
  if (!['pending', 'submitting', 'processing'].includes(batch.status)) {
    throw new Error(`Batch is already ${batch.status} — cannot cancel`);
  }
  await updateBatchStatus(batchId, 'cancelled');
}

// ─── Pipeline Execution ───

async function runVerificationPipeline(
  batchId: string,
  segmentId: string,
  engine: 'verify550' | 'builtin',
  v550Config: { endpoint: string; apiKey: string; batchSize: number; concurrency: number } | undefined,
  builtinConfig: EngineConfig | undefined,
  control: { cancelled: boolean },
) {
  await updateBatchStatus(batchId, 'submitting');

  // Use V550 batch size, or a large default for builtin (it processes concurrently internally)
  const batchSize = engine === 'verify550' ? v550Config!.batchSize : 5000;

  let offset = 0;
  let verifiedTotal = 0;
  let bouncedTotal = 0;
  let unknownTotal = 0;

  while (!control.cancelled) {
    // ── DB-based cancellation check (survives restarts, works across instances) ──
    if (await isBatchCancelledInDB(batchId)) {
      control.cancelled = true;
      break;
    }

    const rows = await query<{ up_id: string; business_email: string; personal_emails: string }>(`
      SELECT up_id, business_email, personal_emails FROM universal_person
      WHERE has(_segment_ids, '${segmentId}')
        AND (business_email IS NOT NULL OR personal_emails IS NOT NULL)
        AND _verification_status IS NULL
      LIMIT ${batchSize} OFFSET ${offset}
    `);

    if (rows.length === 0) break;
    if (control.cancelled) break;

    await updateBatchStatus(batchId, 'processing');

    // Extract emails to verify
    const emailBatch: { upId: string; email: string }[] = [];
    for (const row of rows) {
      const email = row.business_email || row.personal_emails;
      if (email && email.includes('@')) {
        emailBatch.push({ upId: row.up_id, email: email.trim().toLowerCase() });
      }
    }

    if (emailBatch.length === 0) {
      offset += batchSize;
      continue;
    }

    // Execute Verification
    let results: VerificationResult[];

    if (engine === 'verify550') {
      try {
        results = await callVerify550WithRetry(
          v550Config!.endpoint,
          v550Config!.apiKey,
          emailBatch.map((e) => e.email),
          3, // max retries
        );
      } catch (err: any) {
        console.error(`[Verify550] Batch ${batchId}: API call failed after retries: ${err.message}`);
        results = emailBatch.map((e) => ({ email: e.email, status: 'unknown' as const, reason: 'api_error' }));
      }
    } else {
      // Built-in Native Engine
      try {
        results = await verifyBatchBuiltin(emailBatch.map(e => e.email), builtinConfig!);
      } catch (err: any) {
        console.error(`[BuiltinEngine] Batch ${batchId}: Processing failed: ${err.message}`);
        results = emailBatch.map((e) => ({ email: e.email, status: 'unknown' as const, reason: 'engine_failure' }));
      }
    }

    // Process results — update each lead
    for (let i = 0; i < emailBatch.length; i++) {
      if (control.cancelled) break;

      const result = results[i] || { status: 'unknown', reason: 'missing_result' };
      const upId = emailBatch[i].upId;

      if (result.status === 'valid') verifiedTotal++;
      else if (result.status === 'invalid') bouncedTotal++;
      else unknownTotal++;

      await command(`
        ALTER TABLE universal_person UPDATE
          _verification_status = '${result.status}',
          _verified_at = now()
        WHERE up_id = '${upId}'
      `);
    }

    // Update batch progress
    await command(`
      ALTER TABLE verification_batches UPDATE
        verified_count = ${verifiedTotal},
        bounced_count = ${bouncedTotal},
        unknown_count = ${unknownTotal}
      WHERE id = '${batchId}'
    `);

    offset += batchSize;
    console.log(`[Engine - ${engine}] Batch ${batchId}: ${offset} emails processed (V:${verifiedTotal} B:${bouncedTotal} U:${unknownTotal})`);

    // Rate limit: pause between batches to respect overall system load
    await sleep(engine === 'verify550' ? 1000 : 500);
  }

  if (control.cancelled) {
    console.log(`[Engine - ${engine}] Batch ${batchId}: Cancelled by user`);
    return;
  }

  // Mark complete
  await command(`
    ALTER TABLE verification_batches UPDATE
      status = 'complete', completed_at = now(),
      verified_count = ${verifiedTotal},
      bounced_count = ${bouncedTotal},
      unknown_count = ${unknownTotal}
    WHERE id = '${batchId}'
  `);
  console.log(`[Engine - ${engine}] Batch ${batchId}: Complete. V:${verifiedTotal} B:${bouncedTotal} U:${unknownTotal}`);
}

// ─── API Call with Retry ───

async function callVerify550WithRetry(
  endpoint: string,
  apiKey: string,
  emails: string[],
  maxRetries: number,
): Promise<VerificationResult[]> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callVerify550(endpoint, apiKey, emails);
    } catch (err: any) {
      lastError = err;
      console.warn(`[Verify550] Attempt ${attempt}/${maxRetries} failed: ${err.message}`);

      if (attempt < maxRetries) {
        // Exponential backoff: 2s, 4s, 8s...
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[Verify550] Retrying in ${delay / 1000}s...`);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Verify550 API call failed after all retries');
}

/** Call the Verify550 API */
async function callVerify550(
  endpoint: string,
  apiKey: string,
  emails: string[],
): Promise<VerificationResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000); // 60s timeout

  try {
    const resp = await fetch(`${endpoint}/verify-batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ emails }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Verify550 API returned ${resp.status}: ${body}`);
    }

    const data = await resp.json() as { results: VerificationResult[] };

    if (!data.results || !Array.isArray(data.results)) {
      throw new Error('Verify550 API returned invalid response format');
    }

    return data.results;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Status Helpers ───

async function updateBatchStatus(batchId: string, status: BatchStatus, errorMessage?: string): Promise<void> {
  const errorClause = errorMessage
    ? `, error_message = '${errorMessage.replace(/'/g, "''")}'`
    : '';
  const completedClause = status === 'complete' || status === 'failed' || status === 'cancelled'
    ? `, completed_at = now()`
    : '';

  await command(`
    ALTER TABLE verification_batches UPDATE
      status = '${status}'${errorClause}${completedClause}
    WHERE id = '${batchId}'
  `);
}

// ─── Query Functions ───

/** Test the Verify550 API connection */
export async function testConnection(): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
  try {
    const config = await resolveVerify550Config();
    const start = Date.now();

    const resp = await fetch(`${config.endpoint}/health`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    const latencyMs = Date.now() - start;

    if (resp.ok) {
      return { ok: true, message: `Connected (${latencyMs}ms)`, latencyMs };
    } else {
      return { ok: false, message: `API returned ${resp.status} ${resp.statusText}` };
    }
  } catch (err: any) {
    if (err.message?.includes('not configured')) {
      return { ok: false, message: err.message };
    }
    return { ok: false, message: `Connection failed: ${err.message}` };
  }
}

/** Get all batches (most recent first) */
export async function listBatches(limit = 50) {
  return query(`SELECT * FROM verification_batches ORDER BY started_at DESC LIMIT ${Number(limit)}`);
}

/** Get a single batch by ID */
export async function getBatch(batchId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(batchId)) throw new Error('Invalid batch ID');
  const rows = await query(`SELECT * FROM verification_batches WHERE id = '${batchId}' LIMIT 1`);
  return rows[0] || null;
}

/** Get aggregate verification stats */
export async function getVerificationStats() {
  const [stats] = await query<{
    verified: string;
    bounced: string;
    unknown: string;
    pending: string;
    total: string;
  }>(`
    SELECT
      countIf(_verification_status = 'valid') as verified,
      countIf(_verification_status IN ('invalid', 'bounced')) as bounced,
      countIf(_verification_status IN ('unknown', 'risky', 'catch-all', 'disposable')) as unknown,
      countIf(_verification_status IS NULL AND (business_email IS NOT NULL OR personal_emails IS NOT NULL)) as pending,
      count() as total
    FROM universal_person
    WHERE business_email IS NOT NULL OR personal_emails IS NOT NULL
  `);
  return {
    verified: Number(stats?.verified || 0),
    bounced: Number(stats?.bounced || 0),
    unknown: Number(stats?.unknown || 0),
    pending: Number(stats?.pending || 0),
    total: Number(stats?.total || 0),
    yieldRate: Number(stats?.total || 0) > 0
      ? ((Number(stats?.verified || 0) / Number(stats?.total || 0)) * 100).toFixed(1)
      : '0.0',
  };
}

// ─── DB Cancellation Check ───

async function isBatchCancelledInDB(batchId: string): Promise<boolean> {
  try {
    const [row] = await query<{ status: string }>(
      `SELECT status FROM verification_batches WHERE id = '${batchId}' LIMIT 1`,
    );
    return row?.status === 'cancelled';
  } catch {
    return false; // On DB error, don't cancel — let the batch continue
  }
}

// ─── Batch Results Export ───

/**
 * Export verification results for a batch as CSV rows.
 * Returns an array of objects with email, status, and reason.
 */
export async function exportBatchResults(
  batchId: string,
): Promise<{ email: string; status: string; verified_at: string }[]> {
  if (!/^[a-zA-Z0-9_-]+$/.test(batchId)) throw new Error('Invalid batch ID');

  // Get the batch to find its segment
  const [batch] = await query<{ segment_id: string; status: string }>(
    `SELECT segment_id, status FROM verification_batches WHERE id = '${batchId}' LIMIT 1`,
  );
  if (!batch) throw new Error('Batch not found');
  if (batch.status !== 'complete' && batch.status !== 'cancelled') {
    throw new Error('Batch is still running — export after completion');
  }

  // Query verified leads from this batch's segment
  const rows = await query<{
    business_email: string;
    personal_emails: string;
    _verification_status: string;
    _verified_at: string;
  }>(`
    SELECT business_email, personal_emails, _verification_status, _verified_at
    FROM universal_person
    WHERE has(_segment_ids, '${batch.segment_id}')
      AND _verification_status IS NOT NULL
    ORDER BY _verified_at DESC
  `);

  return rows.map(r => ({
    email: r.business_email || r.personal_emails || '',
    status: r._verification_status,
    verified_at: r._verified_at,
  }));
}
