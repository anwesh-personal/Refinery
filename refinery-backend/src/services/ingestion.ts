import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { env } from '../config/env.js';
import { query, command, insertRows } from '../db/clickhouse.js';
import { genId } from '../utils/helpers.js';
import { Readable } from 'stream';
import { createGunzip } from 'zlib';
import { parse } from 'csv-parse';
import { ParquetReader } from '@dsnp/parquetjs';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as s3Sources from './s3sources.js';
import { esc, sanitizeValue, toClickHouseDateTime, safeErrorMessage } from '../utils/sanitize.js';
import { withRetry, isTransientError } from '../utils/retry.js';

// ═══════════════════════════════════════════════════════════════
// Concurrency-Controlled Ingestion Queue
//
// Limits parallel pipelines to MAX_CONCURRENT to prevent OOM,
// bandwidth saturation, and ClickHouse write contention.
// Queue depth is unlimited — submit 5,000 files if you want.
//
// Configurable from Server Config → System Settings:
//   ingestion.max_concurrent  (default: 5)
//   ingestion.batch_size      (default: 10,000)
//   node.heap_size_mb         (requires PM2 restart)
// ═══════════════════════════════════════════════════════════════
let MAX_CONCURRENT = 3; // default — reduced from 5 to prevent OOM with large parquet files
let BATCH_SIZE = 10_000;
let MAX_AUTO_RETRIES = 3;
let INSERT_TIMEOUT_MS = 300_000; // 5 min default
let RECOVERY_DELAY_MS = 5_000;   // 5s default
let activeCount = 0;
const waitQueue: Array<{ resolve: () => void }> = [];

// ── In-Memory Pause Control ──────────────────────────────────────────
// Per-job pause/resume without DB polling. flushBatch checks this set
// between every batch — if paused, it sleeps until resumed or shutdown.
const pausedJobs = new Set<string>();
const activeJobIds = new Set<string>(); // all jobs currently in runIngestionPipeline
const PAUSE_POLL_INTERVAL_MS = 2000; // check every 2s while paused

/** Pause a specific job. Takes effect at the next batch boundary. */
export function pauseJob(jobId: string): void {
  pausedJobs.add(jobId);
  console.log(`[Ingestion] ${jobId}: Pause requested — will pause at next batch boundary.`);
}

/** Resume a specific paused job. */
export function resumeJob(jobId: string): void {
  pausedJobs.delete(jobId);
  console.log(`[Ingestion] ${jobId}: Resumed.`);
}

/** Pause ALL active jobs — uses activeJobIds which tracks from pipeline entry. */
export function pauseAllJobs(): string[] {
  const paused: string[] = [];
  for (const jobId of activeJobIds) {
    pausedJobs.add(jobId);
    paused.push(jobId);
  }
  console.log(`[Ingestion] Pause ALL — ${paused.length} job(s) will pause at next batch boundary.`);
  return paused;
}

/** Resume ALL paused jobs. */
export function resumeAllJobs(): string[] {
  const resumed = [...pausedJobs];
  pausedJobs.clear();
  console.log(`[Ingestion] Resume ALL — ${resumed.length} job(s) resumed.`);
  return resumed;
}

/** Check if a job is paused. */
export function isJobPaused(jobId: string): boolean {
  return pausedJobs.has(jobId);
}

/** Get all paused job IDs. */
export function getPausedJobs(): string[] {
  return [...pausedJobs];
}

// ── In-Memory Progress Store ──────────────────────────────────────────
// Tracks ingestion progress WITHOUT ALTER TABLE mutations.
// Progress is read from memory by the /active-progress API,
// and only written to DB on job completion.
// This eliminates 95%+ of ALTER TABLE mutations during bulk ingestion.
interface ProgressEntry {
  rowsIngested: number;
  rowsSkipped: number;
  updatedAt: number;
}
const progressStore = new Map<string, ProgressEntry>();

/** Update in-memory progress (zero DB cost). Called from flushBatch. */
function trackProgress(jobId: string, rowsIngested: number, rowsSkipped: number): void {
  progressStore.set(jobId, { rowsIngested, rowsSkipped, updatedAt: Date.now() });
}

/** Get in-memory progress for a job. Returns null if not tracked. */
export function getJobProgress(jobId: string): ProgressEntry | null {
  return progressStore.get(jobId) ?? null;
}

/** Finalize: write to DB and remove from memory. Called on job completion. */
async function finalizeProgress(jobId: string, totalRows: number, totalSkipped: number): Promise<void> {
  progressStore.delete(jobId);
  await command(`
    ALTER TABLE ingestion_jobs UPDATE
      rows_ingested = ${totalRows},
      rows_skipped = ${totalSkipped}
    WHERE id = '${esc(jobId)}'
  `);
}

// ── Columns included in _search_text for general text search ──────────
// Domain/email/phone/LinkedIn searches already use specific column sets
// in database.ts's buildWhereConditions(). _search_text covers GENERAL
// text search only: person names, company, title, location, industry.
// Curated list keeps storage lean at any scale. LZ4 compresses well.
const SEARCH_TEXT_COLUMNS = new Set([
  'first_name', 'last_name',
  'company_name', 'company_domain',
  'job_title', 'job_title_normalized',
  'personal_city', 'personal_state',
  'professional_city', 'professional_state',
  'primary_industry', 'department',
]);

/**
 * Build _search_text from curated high-value columns.
 * Lean per-row footprint, scales to any table size.
 */
function buildSearchText(row: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const col of SEARCH_TEXT_COLUMNS) {
    const val = row[col];
    if (val == null || typeof val !== 'string' || !val) continue;
    parts.push(val.toLowerCase());
  }
  return parts.join(' ');
}

/** Load ingestion tuning from system_config (call on startup + config change) */
export async function loadIngestionConfig(): Promise<void> {
  const { getConfigInt } = await import('./config.js');
  MAX_CONCURRENT = await getConfigInt('ingestion.max_concurrent', 3);
  BATCH_SIZE = await getConfigInt('ingestion.batch_size', 10_000);
  MAX_AUTO_RETRIES = await getConfigInt('ingestion.max_auto_retries', 3);
  INSERT_TIMEOUT_MS = (await getConfigInt('ingestion.insert_timeout_sec', 300)) * 1000;
  RECOVERY_DELAY_MS = (await getConfigInt('ingestion.recovery_delay_sec', 5)) * 1000;
  console.log(`[Ingestion] Config loaded: max_concurrent=${MAX_CONCURRENT}, batch_size=${BATCH_SIZE}, max_retries=${MAX_AUTO_RETRIES}, insert_timeout=${INSERT_TIMEOUT_MS / 1000}s, recovery_delay=${RECOVERY_DELAY_MS / 1000}s`);
}

async function acquirePipelineSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return;
  }
  // Wait until a slot opens
  return new Promise<void>((resolve) => {
    waitQueue.push({ resolve });
  });
}

function releasePipelineSlot(): void {
  if (waitQueue.length > 0) {
    // Hand slot to next waiting job
    const next = waitQueue.shift()!;
    next.resolve();
  } else {
    activeCount = Math.max(0, activeCount - 1);
  }
}

/** Get current queue status — useful for monitoring */
export function getQueueStatus(): { active: number; queued: number; paused: number; maxConcurrent: number; batchSize: number } {
  return { active: activeCount, queued: waitQueue.length, paused: pausedJobs.size, maxConcurrent: MAX_CONCURRENT, batchSize: BATCH_SIZE };
}

/**
 * Recover stale ingestion jobs on startup.
 *
 * When PM2 restarts the process, any in-flight background workers are killed
 * but their ClickHouse job records still say "downloading" / "uploading" / "ingesting" etc.
 *
 * Recovery strategy:
 *   - pending / downloading → safe to re-enqueue (no data written yet)
 *   - uploading → safe to re-enqueue (S3 upload was interrupted, start fresh)
 *   - ingesting → delete partial rows by job ID first, THEN re-enqueue
 *   - retry_count >= 3 → permanently mark as failed (prevents infinite crash loops)
 *
 * Returns the number of jobs recovered.
 */
export async function recoverStaleIngestionJobs(): Promise<number> {
  const staleStatuses = ['pending', 'downloading', 'uploading', 'ingesting', 'paused'];

  // Fetch all stale jobs (need details for per-job decisions)
  const staleJobs = await query<{
    id: string;
    source_key: string;
    source_bucket: string;
    status: string;
    rows_ingested: string;
    retry_count: number;
  }>(
    `SELECT id, source_key, source_bucket, status, rows_ingested, retry_count
     FROM ingestion_jobs
     WHERE status IN ('${staleStatuses.join("','")}')
     ORDER BY started_at ASC`
  );

  if (staleJobs.length === 0) return 0;

  let reEnqueued = 0;
  let hardFailed = 0;
  let partialDataCleaned = 0;

  // ─── Phase 1: Categorize and handle each stale job ───
  const jobsToRetry: typeof staleJobs = [];

  for (const job of staleJobs) {
    const retryCount = Number(job.retry_count) || 0;

    // Exceeded retry cap → permanent failure (prevents infinite crash loops from bad files)
    if (retryCount >= MAX_AUTO_RETRIES) {
      await command(`
        ALTER TABLE ingestion_jobs UPDATE
          status = 'failed',
          error_message = 'Exceeded ${MAX_AUTO_RETRIES} automatic retry attempts — manual retry required'
        WHERE id = '${esc(job.id)}'
      `);
      hardFailed++;
      continue;
    }

    // If job was mid-insert (ingesting), clean up partial data first
    const partialRows = Number(job.rows_ingested) || 0;
    if (job.status === 'ingesting' && partialRows > 0) {
      try {
        await command(`ALTER TABLE universal_person DELETE WHERE _ingestion_job_id = '${esc(job.id)}'`);
        partialDataCleaned += partialRows;
        console.log(`[Ingestion] Recovery: cleaned ${partialRows.toLocaleString()} partial rows for job ${job.id}`);
      } catch (e: any) {
        // If cleanup fails, mark as failed instead of risking duplicates
        console.error(`[Ingestion] Recovery: failed to clean partial rows for ${job.id}: ${e.message}`);
        await command(`
          ALTER TABLE ingestion_jobs UPDATE
            status = 'failed',
            error_message = 'Recovery failed: could not clean partial rows — ${safeErrorMessage(e.message)}'
          WHERE id = '${esc(job.id)}'
        `);
        hardFailed++;
        continue;
      }
    }

    // Reset job to pending with incremented retry count
    await command(`
      ALTER TABLE ingestion_jobs UPDATE
        status = 'pending',
        rows_ingested = 0,
        error_message = NULL,
        retry_count = ${retryCount + 1}
      WHERE id = '${esc(job.id)}'
    `);

    jobsToRetry.push(job);
    reEnqueued++;
  }

  // ─── Phase 2: Re-enqueue recovered jobs through the pipeline ───
  // Delay slightly to let the event loop stabilize after startup
  if (jobsToRetry.length > 0) {
    setTimeout(async () => {
      for (const job of jobsToRetry) {
        try {
          // Resolve S3 source from the stored bucket
          const [source] = await query<{ id: string }>(
            `SELECT id FROM s3_sources WHERE bucket = '${esc(job.source_bucket)}' AND is_active = 1 LIMIT 1`
          );

          await retryIngestionJob(job.id, job.source_key, source?.id);
          console.log(`[Ingestion] Recovery: re-enqueued job ${job.id} (retry #${(Number(job.retry_count) || 0) + 1})`);
        } catch (e: any) {
          console.error(`[Ingestion] Recovery: failed to re-enqueue ${job.id}:`, e.message);
          // Mark as failed — don't let a bad re-enqueue crash the whole startup
          await command(`
            ALTER TABLE ingestion_jobs UPDATE
              status = 'failed',
              error_message = 'Recovery re-enqueue failed: ${safeErrorMessage(e.message)}'
            WHERE id = '${esc(job.id)}'
          `).catch(() => {});
        }
      }
    }, RECOVERY_DELAY_MS); // configurable delay — let server fully boot before firing pipelines
  }

  // ─── Phase 3: Clean up orphaned temp directories ───
  try {
    const tmpBase = os.tmpdir();
    const entries = await fs.promises.readdir(tmpBase);
    const orphaned = entries.filter(e => e.startsWith('refinery-ingest-') || e.startsWith('refinery-preview-'));
    for (const dir of orphaned) {
      await fs.promises.rm(path.join(tmpBase, dir), { recursive: true, force: true }).catch(() => {});
    }
    if (orphaned.length > 0) {
      console.log(`[Ingestion] ⚠ Cleaned ${orphaned.length} orphaned temp directories.`);
    }
  } catch { /* tmpdir read failure is non-fatal */ }

  console.log(`[Ingestion] Recovery: ${reEnqueued} re-enqueued, ${hardFailed} permanently failed, ${partialDataCleaned.toLocaleString()} partial rows cleaned.`);
  return staleJobs.length;
}

/**
 * Graceful shutdown — drain in-flight jobs and reject new queue entries.
 * Call this on SIGTERM/SIGINT so PM2 doesn't hard-kill mid-write.
 */
let shuttingDown = false;
export function startGracefulShutdown(): Promise<void> {
  shuttingDown = true;
  console.log(`[Ingestion] Shutdown requested — waiting for ${activeCount} active job(s) to finish...`);

  // Reject all queued (not yet started) jobs immediately
  while (waitQueue.length > 0) {
    const waiter = waitQueue.shift()!;
    // Resolve so the worker runs, but since shuttingDown is true
    // it will be caught by the pipeline and marked failed
    waiter.resolve();
  }

  // Wait for active jobs to finish (poll every 2s, max 120s)
  return new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (activeCount <= 0) {
        clearInterval(check);
        console.log('[Ingestion] All jobs drained. Safe to exit.');
        resolve();
      }
    }, 2000);
    // Hard timeout — don't block shutdown forever
    setTimeout(() => { clearInterval(check); resolve(); }, 120_000);
  });
}

/** Detect file format from extension */
type FileFormat = 'csv' | 'csv.gz' | 'parquet' | 'unknown';
function detectFormat(fileName: string): FileFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.parquet') || lower.endsWith('.pqt')) return 'parquet';
  if (lower.endsWith('.csv.gz') || lower.endsWith('.tsv.gz') || lower.endsWith('.txt.gz')) return 'csv.gz';
  if (lower.endsWith('.gz')) return 'csv.gz'; // assume gzipped CSV
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) return 'csv';
  return 'unknown';
}

/** Build an S3 client for the env-based source bucket (legacy fallback) */
function getSourceClient(): S3Client {
  return new S3Client({
    region: env.s3Source.region,
    credentials: {
      accessKeyId: env.s3Source.accessKey,
      secretAccessKey: env.s3Source.secretKey,
    },
  });
}

/** Build an S3-compatible client for Object Storage (MinIO / any S3-compatible) */
function getStorageClient(): S3Client {
  return new S3Client({
    region: 'us-east-1',
    endpoint: env.objectStorage.endpoint,
    credentials: {
      accessKeyId: env.objectStorage.accessKey,
      secretAccessKey: env.objectStorage.secretKey,
    },
    forcePathStyle: true,
  });
}

/** Test connection to env-based source bucket (legacy) */
export async function testSourceConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = getSourceClient();
    await client.send(new HeadBucketCommand({ Bucket: env.s3Source.bucket }));
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** Test connection to Object Storage (MinIO) */
export async function testStorageConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = getStorageClient();
    await client.send(new HeadBucketCommand({ Bucket: env.objectStorage.bucket }));
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** List files from an S3 source with folder/file separation */
export async function listSourceFiles(prefix?: string, sourceId?: string) {
  let client: S3Client;
  let bucket: string;
  let defaultPrefix: string | undefined;

  if (sourceId) {
    const src = await s3Sources.getSource(sourceId);
    if (!src) throw new Error(`S3 source '${sourceId}' not found`);
    client = s3Sources.buildClient(src);
    bucket = src.bucket;
    defaultPrefix = src.prefix || undefined;
  } else {
    client = getSourceClient();
    bucket = env.s3Source.bucket;
    defaultPrefix = undefined;
  }

  const effectivePrefix = prefix !== undefined && prefix !== '' ? prefix : (defaultPrefix || '');

  // Paginate through ALL results — S3 returns max 1000 per page
  const allFolders: string[] = [];
  const allFiles: Array<{ key: string; size: number; modified: string }> = [];
  let continuationToken: string | undefined;

  do {
    const resp = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: effectivePrefix,
      Delimiter: '/',
      MaxKeys: 1000,
      ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
    }));

    for (const cp of resp.CommonPrefixes || []) {
      if (cp.Prefix) allFolders.push(cp.Prefix);
    }

    for (const obj of resp.Contents || []) {
      if (obj.Key && obj.Key !== effectivePrefix) {
        allFiles.push({
          key: obj.Key,
          size: obj.Size || 0,
          modified: obj.LastModified?.toISOString() || '',
        });
      }
    }

    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  return { folders: allFolders, files: allFiles, prefix: effectivePrefix };
}

/**
 * Preview first N rows of a CSV/GZ file from S3 without downloading fully.
 * Uses HTTP Range / streaming to read only what's needed.
 */
export async function previewFile(
  sourceKey: string,
  sourceId?: string,
  maxRows = 20
): Promise<{ columns: string[]; rows: string[][]; totalPreviewRows: number; format: string }> {
  let client: S3Client;
  let bucket: string;

  if (sourceId) {
    const src = await s3Sources.getSource(sourceId);
    if (!src) throw new Error(`S3 source '${sourceId}' not found`);
    client = s3Sources.buildClient(src);
    bucket = src.bucket;
  } else {
    client = getSourceClient();
    bucket = env.s3Source.bucket;
  }

  const format = detectFormat(sourceKey);
  if (format === 'unknown') {
    throw new Error(`Preview not supported for this file type. Supported: CSV, CSV.GZ, Parquet.`);
  }

  // ─── Parquet Preview ───
  // Parquet requires a full download because the footer (schema) is at EOF.
  // Download to temp, read schema + first N rows, clean up.
  if (format === 'parquet') {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'refinery-preview-'));
    const tmpFile = path.join(tmpDir, sourceKey.split('/').pop() || 'preview.parquet');
    try {
      const getResp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: sourceKey }));
      const bodyStream = getResp.Body as Readable;

      // Write to temp file
      const writeStream = fs.createWriteStream(tmpFile);
      await new Promise<void>((resolve, reject) => {
        bodyStream.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        bodyStream.on('error', reject);
      });

      // Read Parquet schema + rows
      const reader = await ParquetReader.openFile(tmpFile);
      const schema = reader.getSchema();
      const columns = Object.keys(schema.fields);
      const rows: string[][] = [];
      const cursor = reader.getCursor();
      let record: Record<string, unknown> | null;

      while ((record = await cursor.next() as Record<string, unknown> | null)) {
        const row = columns.map(col => {
          const val = record![col];
          if (val === null || val === undefined) return '';
          if (typeof val === 'object') return JSON.stringify(val);
          return String(val);
        });
        rows.push(row);
        if (rows.length >= maxRows) break;
      }
      await reader.close();

      return { columns, rows, totalPreviewRows: rows.length, format };
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // ─── CSV / CSV.GZ Preview ───
  const getResp = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: sourceKey,
  }));

  const bodyStream = getResp.Body as Readable;

  return new Promise((resolve, reject) => {
    const columns: string[] = [];
    const rows: string[][] = [];
    let headerSeen = false;

    let inputStream: Readable = bodyStream;
    if (format === 'csv.gz') {
      const gunzip = createGunzip();
      inputStream = bodyStream.pipe(gunzip);
    }

    const parser = inputStream.pipe(parse({
      skip_empty_lines: true,
      relax_column_count: true,
    }));

    parser.on('data', (row: string[]) => {
      if (!headerSeen) {
        columns.push(...row);
        headerSeen = true;
        return;
      }
      rows.push(row);
      if (rows.length >= maxRows) {
        parser.destroy(); // Stop reading — we have enough
      }
    });

    parser.on('end', () => {
      resolve({ columns, rows, totalPreviewRows: rows.length, format });
    });

    parser.on('close', () => {
      // Also fire on destroy()
      resolve({ columns, rows, totalPreviewRows: rows.length, format });
    });

    parser.on('error', (err) => {
      // If we destroyed intentionally, it's fine
      if (rows.length > 0) {
        resolve({ columns, rows, totalPreviewRows: rows.length, format });
      } else {
        reject(err);
      }
    });
  });
}

/** Get list of ingestion jobs */
export async function getJobs(limit = 100) {
  return query(`SELECT * FROM ingestion_jobs ORDER BY started_at DESC LIMIT ${limit}`);
}

/** Get ingestion stats */
export async function getIngestionStats() {
  const [row] = await query<{
    total_rows: string; total_bytes: string; pending: string; latest_file: string;
  }>(`
    SELECT
      (SELECT count() FROM universal_person) as total_rows,
      (SELECT sum(file_size_bytes) FROM ingestion_jobs WHERE status = 'complete') as total_bytes,
      (SELECT count() FROM ingestion_jobs WHERE status IN ('pending','downloading','uploading','ingesting')) as pending,
      (SELECT file_name FROM ingestion_jobs ORDER BY started_at DESC LIMIT 1) as latest_file
  `);
  const stats = row || { total_rows: '0', total_bytes: '0', pending: '0', latest_file: '' };
  return { ...stats, queue: getQueueStatus() };
}

// ═══════════════════════════════════════════════════════════════
// Active Progress & ETA
// ═══════════════════════════════════════════════════════════════

export interface JobProgress {
  id: string;
  fileName: string;
  status: string;
  rowsIngested: number;
  fileSizeBytes: number;
  startedAt: string;
  elapsedSec: number;
  rowsPerSec: number;       // real-time throughput
  etaRemainingSec: number | null;  // estimated seconds remaining (null if unknown)
}

export interface ActiveProgressResult {
  jobs: JobProgress[];
  queueDepth: number;       // jobs waiting in memory queue
  maxConcurrent: number;
  avgRowsPerSec: number;    // avg throughput from recent completed jobs
  overallEtaSec: number | null;  // estimated seconds until ALL jobs done
}

/**
 * Compute real-time progress & ETA for ALL active ingestion jobs.
 *
 * Per-job ETA is computed from (file_size_bytes / throughput_bytes_per_sec).
 * We estimate bytes_per_row from the current job's own data:
 *   bytes_per_row = file_size_bytes / estimated_total_rows
 * Since we don't have total_rows until done, we use
 *   estimated_total_rows ≈ rows_ingested * (file_size_bytes / bytes_consumed_so_far)
 * But bytes_consumed_so_far requires streaming state we don't have.
 *
 * Simpler approach: use avg bytes_per_row from recently completed jobs to estimate
 * total_rows for current jobs. Then ETA = (estimated_total - rows_ingested) / rows_per_sec.
 */
export async function getActiveProgress(): Promise<ActiveProgressResult> {
  const now = new Date();

  // 1. Get all active jobs
  const activeJobs = await query<{
    id: string; file_name: string; status: string;
    rows_ingested: string; file_size_bytes: string; started_at: string;
  }>(`
    SELECT id, file_name, status, rows_ingested, file_size_bytes, started_at
    FROM ingestion_jobs
    WHERE status IN ('pending', 'downloading', 'uploading', 'ingesting')
    ORDER BY started_at ASC
  `);

  // 2. Get avg bytes_per_row from recent completed jobs (last 20)
  //    This gives us a conversion factor: file_size_bytes / rows_ingested ≈ bytes per row
  const [avgRow] = await query<{ avg_bpr: string; avg_rps: string }>(`
    SELECT
      avg(bpr) as avg_bpr,
      avg(rps) as avg_rps
    FROM (
      SELECT
        file_size_bytes / rows_ingested as bpr,
        rows_ingested / greatest(dateDiff('second', started_at, completed_at), 1) as rps
      FROM ingestion_jobs
      WHERE status = 'complete'
        AND rows_ingested > 0
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC
      LIMIT 20
    ) AS recent_jobs
  `);

  const avgBytesPerRow = Number(avgRow?.avg_bpr) || 500; // fallback: 500 bytes/row
  const avgRowsPerSec = Number(avgRow?.avg_rps) || 5000; // fallback: 5K rows/sec

  // 3. Compute per-job progress (merge in-memory progress for real-time accuracy)
  const jobs: JobProgress[] = activeJobs.map(j => {
    // In-memory progress is more current than DB (DB only updates on completion)
    const memProgress = getJobProgress(j.id);
    const rowsIngested = memProgress?.rowsIngested ?? (Number(j.rows_ingested) || 0);
    const fileSizeBytes = Number(j.file_size_bytes) || 0;
    const startedAt = new Date(j.started_at);
    const elapsedSec = Math.max(1, (now.getTime() - startedAt.getTime()) / 1000);
    const rowsPerSec = rowsIngested > 0 ? rowsIngested / elapsedSec : 0;

    // Estimate total rows from file size and avg bytes per row
    const estimatedTotalRows = fileSizeBytes > 0 ? Math.round(fileSizeBytes / avgBytesPerRow) : 0;
    const remainingRows = Math.max(0, estimatedTotalRows - rowsIngested);

    // ETA: only meaningful when actively ingesting with measurable throughput
    let etaRemainingSec: number | null = null;
    if (j.status === 'ingesting' && rowsPerSec > 0 && estimatedTotalRows > 0) {
      etaRemainingSec = Math.round(remainingRows / rowsPerSec);
    }

    return {
      id: j.id,
      fileName: j.file_name,
      status: j.status,
      rowsIngested,
      fileSizeBytes,
      startedAt: j.started_at,
      elapsedSec: Math.round(elapsedSec),
      rowsPerSec: Math.round(rowsPerSec),
      etaRemainingSec,
    };
  });

  // 4. Overall queue ETA
  // Sum ETAs of active ingesting jobs + estimate for pending/downloading/uploading jobs
  const { queued } = getQueueStatus();
  const activeIngestingEtaSum = jobs
    .filter(j => j.etaRemainingSec !== null)
    .reduce((sum, j) => sum + (j.etaRemainingSec || 0), 0);

  // For pending/waiting jobs: estimate from avg file size and avg throughput
  const pendingJobs = jobs.filter(j => j.status !== 'ingesting');
  const avgFileSizeBytes = pendingJobs.length > 0
    ? pendingJobs.reduce((s, j) => s + j.fileSizeBytes, 0) / pendingJobs.length
    : 0;
  const avgFileRows = avgFileSizeBytes > 0 ? avgFileSizeBytes / avgBytesPerRow : 0;
  const pendingEtaPerJob = avgRowsPerSec > 0 ? avgFileRows / avgRowsPerSec : 0;

  // Total waiting jobs = currently pending + in memory queue
  const totalWaitingJobs = pendingJobs.length + queued;
  // They process MAX_CONCURRENT at a time
  const batchesRemaining = Math.ceil(totalWaitingJobs / MAX_CONCURRENT);
  const pendingEtaTotal = batchesRemaining * pendingEtaPerJob;

  const overallEtaSec = activeJobs.length > 0
    ? Math.round(activeIngestingEtaSum + pendingEtaTotal)
    : null;

  return {
    jobs,
    queueDepth: queued,
    maxConcurrent: MAX_CONCURRENT,
    avgRowsPerSec: Math.round(avgRowsPerSec),
    overallEtaSec,
  };
}

// ═══════════════════════════════════════════════════════════════
// File Status Lookup (for browser badges)
// ═══════════════════════════════════════════════════════════════

export interface FileStatus {
  sourceKey: string;
  status: string;       // complete, rolled_back, failed, pending, etc.
  rowsIngested: number;
  jobId: string;
}

/**
 * Get the latest ingestion job status for each source key.
 * Used by the file browser to show "already ingested" / "rolled back" badges.
 */
export async function getFileStatuses(sourceKeys: string[]): Promise<Record<string, FileStatus>> {
  if (sourceKeys.length === 0) return {};

  const keyList = sourceKeys.map(k => `'${esc(k)}'`).join(',');
  const rows = await query<{
    source_key: string; id: string; status: string; rows_ingested: string;
  }>(
    `SELECT source_key, id, status, rows_ingested
     FROM ingestion_jobs
     WHERE source_key IN (${keyList})
     ORDER BY started_at DESC`
  );

  // Keep the latest job per source_key
  const result: Record<string, FileStatus> = {};
  for (const row of rows) {
    if (result[row.source_key]) continue;
    result[row.source_key] = {
      sourceKey: row.source_key,
      status: row.status,
      rowsIngested: Number(row.rows_ingested) || 0,
      jobId: row.id,
    };
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// Duplicate Detection
// ═══════════════════════════════════════════════════════════════

export interface DuplicateInfo {
  sourceKey: string;
  fileName: string;
  existingJobId: string;
  status: string;
  rowsIngested: number;
  ingestedAt: string;
}

/**
 * Check which source keys already have non-failed ingestion jobs.
 * Returns structured info about each duplicate for UI display.
 */
export async function checkDuplicates(sourceKeys: string[]): Promise<DuplicateInfo[]> {
  if (sourceKeys.length === 0) return [];

  const keyList = sourceKeys.map(k => `'${esc(k)}'`).join(',');
  const existing = await query<{
    source_key: string; id: string; status: string; rows_ingested: string; started_at: string;
  }>(
    `SELECT source_key, id, status, rows_ingested, started_at
     FROM ingestion_jobs
     WHERE source_key IN (${keyList})
       AND status IN ('complete', 'pending', 'downloading', 'uploading', 'ingesting')
     ORDER BY started_at DESC`
  );

  // Deduplicate: keep only the latest job per source_key
  const seen = new Set<string>();
  const dupes: DuplicateInfo[] = [];
  for (const row of existing) {
    if (seen.has(row.source_key)) continue;
    seen.add(row.source_key);
    dupes.push({
      sourceKey: row.source_key,
      fileName: row.source_key.split('/').pop() || row.source_key,
      existingJobId: row.id,
      status: row.status,
      rowsIngested: Number(row.rows_ingested) || 0,
      ingestedAt: row.started_at,
    });
  }
  return dupes;
}

// ═══════════════════════════════════════════════════════════════
// Single-file Ingestion
// ═══════════════════════════════════════════════════════════════

/**
 * Start an ingestion job:
 * 1. Download from source S3 to local temp
 * 2. Parse file and insert into ClickHouse
 * 3. Archive raw file to MinIO (background)
 *
 * @param force — if true, skip duplicate check and ingest anyway
 */
export async function startIngestionJob(sourceKey: string, sourceId?: string, performedBy?: string, performedByName?: string, force = false, fileModifiedAt?: string): Promise<string> {
  if (shuttingDown) throw new Error('Server is shutting down — cannot start new ingestion jobs.');

  const jobId = genId();
  const fileName = sourceKey.split('/').pop() || sourceKey;
  const format = detectFormat(fileName);

  if (format === 'unknown') {
    throw new Error(`Unsupported file format: ${fileName}. Supported: .csv, .csv.gz, .gz, .parquet`);
  }

  // Resolve S3 source — dynamic if sourceId provided, else env fallback
  let sourceBucket: string;
  let sourceClient: S3Client;

  if (sourceId) {
    const src = await s3Sources.getSource(sourceId);
    if (!src) throw new Error(`S3 source '${sourceId}' not found`);
    sourceBucket = src.bucket;
    sourceClient = s3Sources.buildClient(src);
  } else {
    sourceBucket = env.s3Source.bucket;
    sourceClient = getSourceClient();
  }

  // Duplicate prevention — reject if file already ingested (unless forced)
  if (!force) {
    const dupes = await checkDuplicates([sourceKey]);
    if (dupes.length > 0) {
      const d = dupes[0];
      const err: any = new Error(
        `"${d.fileName}" is already ingested (job ${d.existingJobId}, ${d.rowsIngested.toLocaleString()} rows, status: ${d.status}). Use force=true to re-ingest.`
      );
      err.code = 'DUPLICATE_INGESTION';
      err.duplicate = d;
      throw err;
    }
  } else {
    console.log(`[Ingestion] Force-ingesting ${sourceKey} (duplicate check bypassed)`);
  }

  // Create job record
  await insertRows('ingestion_jobs', [{
    id: jobId,
    source_bucket: sourceBucket,
    source_key: sourceKey,
    file_name: fileName,
    status: 'downloading',
    ...(performedBy ? { performed_by: performedBy } : {}),
    ...(performedByName ? { performed_by_name: performedByName } : {}),
    ...(fileModifiedAt ? { file_modified_at: toClickHouseDateTime(new Date(fileModifiedAt)) } : {}),
  }]);

  // Run the actual pipeline in the background with concurrency control
  (async () => {
    await acquirePipelineSlot();
    console.log(`[Ingestion] ${jobId}: Slot acquired (${activeCount}/${MAX_CONCURRENT} active, ${waitQueue.length} queued)`);
    try {
      await runIngestionPipeline(jobId, sourceKey, fileName, format, sourceClient, sourceBucket);
    } catch (err: any) {
      console.error(`[Ingestion] Job ${jobId} failed:`, err.message);
      await command(`
        ALTER TABLE ingestion_jobs UPDATE 
          status = 'failed', error_message = '${safeErrorMessage(err.message)}'
        WHERE id = '${esc(jobId)}'
      `);
    } finally {
      releasePipelineSlot();
    }
  })();

  return jobId;
}

/**
 * Retry an existing job — re-run its pipeline using the same job ID.
 * The caller is responsible for cleaning partial data and resetting status first.
 */
export async function retryIngestionJob(jobId: string, sourceKey: string, sourceId?: string): Promise<void> {
  if (shuttingDown) throw new Error('Server is shutting down — cannot retry jobs.');

  const fileName = sourceKey.split('/').pop() || sourceKey;
  const format = detectFormat(fileName);

  // Resolve S3 source
  let sourceBucket: string;
  let sourceClient: S3Client;

  if (sourceId) {
    const src = await s3Sources.getSource(sourceId);
    if (!src) throw new Error(`S3 source '${sourceId}' not found`);
    sourceBucket = src.bucket;
    sourceClient = s3Sources.buildClient(src);
  } else {
    sourceBucket = env.s3Source.bucket;
    sourceClient = getSourceClient();
  }

  // Fire pipeline in background with concurrency control
  (async () => {
    await acquirePipelineSlot();
    console.log(`[Ingestion] ${jobId}: Retry slot acquired (${activeCount}/${MAX_CONCURRENT} active, ${waitQueue.length} queued)`);
    try {
      await runIngestionPipeline(jobId, sourceKey, fileName, format, sourceClient, sourceBucket);
    } catch (err: any) {
      console.error(`[Ingestion] Retry ${jobId} failed:`, err.message);
      await command(`
        ALTER TABLE ingestion_jobs UPDATE 
          status = 'failed', error_message = '${safeErrorMessage(err.message)}'
        WHERE id = '${esc(jobId)}'
      `);
    } finally {
      releasePipelineSlot();
    }
  })();
}

/**
 * Bulk ingestion — batch-insert all job records in ONE ClickHouse call,
 * then fire background workers. No file count limit.
 * This avoids the socket hang up caused by 500+ sequential insertRows calls.
 */
export interface BulkIngestionResult {
  jobIds: string[];
  skipped: DuplicateInfo[];
}

export async function startBulkIngestion(
  sourceKeys: string[],
  sourceId?: string,
  performedBy?: string,
  performedByName?: string,
  force = false,
  fileModifiedDates?: Record<string, string>,
): Promise<BulkIngestionResult> {
  if (shuttingDown) throw new Error('Server is shutting down — cannot start new ingestion jobs.');

  // Duplicate prevention — filter out already-ingested files unless forced
  let keysToIngest = sourceKeys;
  let skipped: DuplicateInfo[] = [];

  if (!force) {
    const dupes = await checkDuplicates(sourceKeys);
    if (dupes.length > 0) {
      const dupeKeys = new Set(dupes.map(d => d.sourceKey));
      keysToIngest = sourceKeys.filter(k => !dupeKeys.has(k));
      skipped = dupes;
      console.log(`[Ingestion] Bulk: ${dupes.length} files already ingested (skipped). ${keysToIngest.length} new files to ingest.`);
    }
  } else {
    console.log(`[Ingestion] Bulk: Force mode — skipping duplicate check for ${sourceKeys.length} files.`);
  }

  // Resolve S3 source once (not per file)
  let sourceBucket: string;
  let sourceClient: S3Client;

  if (sourceId) {
    const src = await s3Sources.getSource(sourceId);
    if (!src) throw new Error(`S3 source '${sourceId}' not found`);
    sourceBucket = src.bucket;
    sourceClient = s3Sources.buildClient(src);
  } else {
    sourceBucket = env.s3Source.bucket;
    sourceClient = getSourceClient();
  }

  // Prepare all job records
  const jobs: Array<{ id: string; key: string; fileName: string; format: FileFormat }> = [];
  const rows: Array<Record<string, any>> = [];

  for (const key of keysToIngest) {
    const fileName = key.split('/').pop() || key;
    const format = detectFormat(fileName);
    if (format === 'unknown') continue; // skip unsupported files silently

    const jobId = genId();
    jobs.push({ id: jobId, key, fileName, format });
    rows.push({
      id: jobId,
      source_bucket: sourceBucket,
      source_key: key,
      file_name: fileName,
      status: 'pending',
      ...(performedBy ? { performed_by: performedBy } : {}),
      ...(performedByName ? { performed_by_name: performedByName } : {}),
      ...(fileModifiedDates?.[key] ? { file_modified_at: toClickHouseDateTime(new Date(fileModifiedDates[key])) } : {}),
    });
  }

  if (rows.length === 0 && skipped.length === 0) {
    throw new Error('No supported files found in the provided list.');
  }

  if (rows.length === 0 && skipped.length > 0) {
    // All files were already ingested
    return { jobIds: [], skipped };
  }

  // Single batch insert — all jobs at once
  await insertRows('ingestion_jobs', rows);

  console.log(`[Ingestion] Bulk: Created ${jobs.length} jobs in one batch. Firing background workers.`);

  // Fire background workers (concurrency queue handles throttling)
  for (const job of jobs) {
    (async () => {
      await acquirePipelineSlot();
      console.log(`[Ingestion] ${job.id}: Slot acquired (${activeCount}/${MAX_CONCURRENT} active, ${waitQueue.length} queued)`);
      try {
        await command(`ALTER TABLE ingestion_jobs UPDATE status = 'downloading' WHERE id = '${esc(job.id)}'`);
        await runIngestionPipeline(job.id, job.key, job.fileName, job.format, sourceClient, sourceBucket);
      } catch (err: any) {
        console.error(`[Ingestion] Job ${job.id} failed:`, err.message);
        await command(`
          ALTER TABLE ingestion_jobs UPDATE 
            status = 'failed', error_message = '${safeErrorMessage(err.message)}'
          WHERE id = '${esc(job.id)}'
        `);
      } finally {
        releasePipelineSlot();
      }
    })();
  }

  return { jobIds: jobs.map(j => j.id), skipped };
}

async function runIngestionPipeline(jobId: string, sourceKey: string, fileName: string, format: FileFormat, sourceClient: S3Client, sourceBucket: string) {
  // Abort immediately if server is shutting down — prevents queued jobs from starting new work
  if (shuttingDown) {
    throw new Error('Server is shutting down — pipeline aborted before start.');
  }

  const storageClient = getStorageClient();
  let totalRows = 0;
  activeJobIds.add(jobId); // Track from pipeline entry for pauseAllJobs

  // ─── Step 1: Download from S3 to temp file (with retry) ───
  // Transient network failures (ECONNRESET, ETIMEDOUT, etc.) are retried
  // up to 4 times with exponential backoff. Partial downloads are cleaned up.
  console.log(`[Ingestion] ${jobId}: Downloading ${sourceKey} from ${sourceBucket}... (format: ${format})`);

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'refinery-ingest-'));
  const tmpFile = path.join(tmpDir, fileName);

  let fileSize = 0;

  try {
    await withRetry(
      async () => {
        // Clean up partial download from prior attempt
        await fs.promises.unlink(tmpFile).catch(() => {});

        const getResp = await sourceClient.send(new GetObjectCommand({
          Bucket: sourceBucket,
          Key: sourceKey,
        }));

        const bodyStream = getResp.Body as Readable;
        fileSize = getResp.ContentLength || 0;

        const writeStream = fs.createWriteStream(tmpFile);
        await new Promise<void>((resolve, reject) => {
          bodyStream.pipe(writeStream);
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
          bodyStream.on('error', reject);
        });
      },
      {
        maxAttempts: 4,
        baseDelayMs: 3000,
        maxDelayMs: 30_000,
        isRetryable: isTransientError,
        onRetry: (err, attempt, delay) => {
          console.warn(`[Ingestion] ${jobId}: Download failed (${err.message}), retrying in ${delay / 1000}s (attempt ${attempt}/4)...`);
        },
      },
    );

    await command(`ALTER TABLE ingestion_jobs UPDATE file_size_bytes = ${fileSize} WHERE id = '${esc(jobId)}'`);

    // ─── Step 2: Archive to MinIO (non-blocking, runs in background) ───
    console.log(`[Ingestion] ${jobId}: Archiving to Object Storage (background)...`);
    const storageKey = `ingestion/${jobId}/${fileName}`;
    const archivePromise = (async () => {
      try {
        const archiveStream = fs.createReadStream(tmpFile);
        const upload = new Upload({
          client: storageClient,
          params: {
            Bucket: env.objectStorage.bucket,
            Key: storageKey,
            Body: archiveStream,
          },
          queueSize: 4,
          partSize: 10 * 1024 * 1024,
        });
        await upload.done();
        console.log(`[Ingestion] ${jobId}: Archived to ${storageKey}`);
      } catch (archiveErr: any) {
        // Archive failure is non-fatal — the data is still in ClickHouse
        console.error(`[Ingestion] ${jobId}: Archive to MinIO failed (non-fatal): ${archiveErr.message}`);
      }
    })();

    // ─── Step 3: Parse from temp file and ingest into ClickHouse ───
    console.log(`[Ingestion] ${jobId}: Ingesting into ClickHouse (${format})...`);
    await command(`ALTER TABLE ingestion_jobs UPDATE status = 'ingesting' WHERE id = '${esc(jobId)}'`);

    // ─── Shared helpers ───
    async function syncSchema(headers: string[]) {
      const existingCols = await query<{ name: string }>(`
        SELECT name FROM system.columns
        WHERE database = '${esc(env.clickhouse.database)}' AND table = 'universal_person'
      `);
      const existingSet = new Set(existingCols.map(c => c.name));
      const missingCols = headers.filter(h => !existingSet.has(h));

      if (missingCols.length > 0) {
        console.log(`[Ingestion] ${jobId}: Adding ${missingCols.length} new columns: ${missingCols.join(', ')}`);
        for (const col of missingCols) {
          try {
            await command(`ALTER TABLE universal_person ADD COLUMN IF NOT EXISTS \`${col}\` Nullable(String)`);
          } catch (e: any) {
            console.warn(`[Ingestion] ${jobId}: Could not add column '${col}': ${e.message}`);
          }
        }
      }
    }

    let lastProgressUpdate = Date.now();
    let totalSkipped = 0;

    /**
     * Backpressure check: query ClickHouse's active parts count.
     * If too many parts are pending merge, pause to let merges catch up.
     * This is how production data pipelines prevent write saturation.
     */
    const BACKPRESSURE_PARTS_THRESHOLD = 300;
    const BACKPRESSURE_CHECK_INTERVAL = 50; // check every N batches (not every batch — avoid query spam)
    let batchCount = 0;

    async function waitForBackpressure(): Promise<void> {
      batchCount++;
      if (batchCount % BACKPRESSURE_CHECK_INTERVAL !== 0) return;

      try {
        const [row] = await query<{ cnt: string }>(`
          SELECT count() as cnt FROM system.parts
          WHERE database = '${esc(env.clickhouse.database)}'
            AND table = 'universal_person'
            AND active = 1
        `, { timeoutMs: 5000 });

        const activeParts = Number(row?.cnt) || 0;
        if (activeParts > BACKPRESSURE_PARTS_THRESHOLD) {
          console.warn(`[Ingestion] ${jobId}: Backpressure — ${activeParts} active parts (threshold: ${BACKPRESSURE_PARTS_THRESHOLD}). Pausing for merges...`);
          // Poll every 5s until parts drop below threshold (max 60s wait)
          for (let wait = 0; wait < 12; wait++) {
            await new Promise(r => setTimeout(r, 5000));
            const [recheck] = await query<{ cnt: string }>(`
              SELECT count() as cnt FROM system.parts
              WHERE database = '${esc(env.clickhouse.database)}'
                AND table = 'universal_person'
                AND active = 1
            `, { timeoutMs: 5000 });
            const current = Number(recheck?.cnt) || 0;
            if (current <= BACKPRESSURE_PARTS_THRESHOLD) {
              console.log(`[Ingestion] ${jobId}: Backpressure cleared (${current} parts). Resuming.`);
              break;
            }
          }
        }
      } catch {
        // Backpressure check is advisory — failure is non-fatal
      }
    }

    async function flushBatch(batch: Record<string, unknown>[]) {
      if (batch.length === 0) return;

      // Abort between batches during shutdown — safe boundary (no partial writes)
      if (shuttingDown) {
        throw new Error('Server is shutting down — pipeline aborted between batches.');
      }

      // ── Pause gate ─────────────────────────────────────────────────
      // If this job is paused, sleep here until resumed or shutdown.
      // The current batch stays in memory — resume continues from this exact point.
      if (pausedJobs.has(jobId)) {
        await command(`ALTER TABLE ingestion_jobs UPDATE status = 'paused' WHERE id = '${esc(jobId)}'`).catch(() => {});
        console.log(`[Ingestion] ${jobId}: Paused at ${totalRows.toLocaleString()} rows. Waiting for resume...`);
        while (pausedJobs.has(jobId) && !shuttingDown) {
          await new Promise(r => setTimeout(r, PAUSE_POLL_INTERVAL_MS));
        }
        if (shuttingDown) {
          throw new Error('Server is shutting down — pipeline aborted while paused.');
        }
        await command(`ALTER TABLE ingestion_jobs UPDATE status = 'ingesting' WHERE id = '${esc(jobId)}'`).catch(() => {});
        console.log(`[Ingestion] ${jobId}: Resumed at ${totalRows.toLocaleString()} rows. Continuing...`);
      }

      // Check backpressure before inserting
      await waitForBackpressure();

      await withRetry(
        () => insertRows('universal_person', batch, { timeoutMs: INSERT_TIMEOUT_MS }),
        {
          maxAttempts: 5,
          baseDelayMs: 5000,
          maxDelayMs: 60_000,
          isRetryable: isTransientError,
          onRetry: (err, attempt, delay) => {
            console.warn(`[Ingestion] ${jobId}: Batch insert failed (${err.message}), retrying in ${delay / 1000}s (attempt ${attempt}/5)...`);
          },
        },
      );

      totalRows += batch.length;

      // Hybrid progress: in-memory (every batch) + DB flush (every 60s for crash visibility)
      trackProgress(jobId, totalRows, totalSkipped);
      const now = Date.now();
      if (now - lastProgressUpdate >= 60_000) {
        await command(`ALTER TABLE ingestion_jobs UPDATE rows_ingested = ${totalRows} WHERE id = '${esc(jobId)}'`).catch(() => {});
        lastProgressUpdate = now;
      }

      if (totalRows % 100000 === 0) {
        console.log(`[Ingestion] ${jobId}: ${totalRows.toLocaleString()} rows inserted...`);
      }
    }

    // ─── Format-specific parsing ───
    if (format === 'csv' || format === 'csv.gz') {
      const rawStream = fs.createReadStream(tmpFile);
      const decompressed = format === 'csv.gz' ? rawStream.pipe(createGunzip()) : rawStream;
      let csvHeaders: string[] = [];

      const csvStream = decompressed.pipe(
        parse({
          columns: (header: string[]) => {
            csvHeaders = header.map((h: string) => h.toLowerCase().trim());
            return csvHeaders;
          },
          skip_empty_lines: true,
          relax_column_count: true,
          relax_quotes: true,            // tolerate unescaped quotes in fields
          skip_records_with_error: true,  // skip malformed rows instead of crashing
          on_record: (record: Record<string, unknown>) => record, // passthrough (needed for skip to work)
        }),
      );

      // Track skipped records via the parser's 'skip' event
      csvStream.on('skip', (err: Error) => {
        totalSkipped++;
        // Log first 10 skipped rows for debugging, then stay quiet
        if (totalSkipped <= 10) {
          console.warn(`[Ingestion] ${jobId}: Skipped malformed row #${totalSkipped}: ${err.message?.substring(0, 120)}`);
        } else if (totalSkipped === 11) {
          console.warn(`[Ingestion] ${jobId}: Suppressing further skip warnings (>10 skipped)...`);
        }
      });

      const iterator = csvStream[Symbol.asyncIterator]();
      const firstResult = await iterator.next();

      if (!firstResult.done && csvHeaders.length > 0) {
        await syncSchema(csvHeaders);
      }

      let batch: Record<string, unknown>[] = [];

      function sanitizeCsvRow(row: Record<string, unknown>): Record<string, unknown> {
        const clean: Record<string, unknown> = {
          _ingestion_job_id: jobId,
          _source_file_name: fileName,
        };
        for (const [key, val] of Object.entries(row)) {
          clean[key] = sanitizeValue(val);
        }
        // Ensure every row has a unique up_id (required for keyset pagination)
        // Preserves source-provided IDs; generates one only if missing/empty
        if (!clean.up_id) clean.up_id = genId();
        // Build _search_text dynamically from curated columns
        clean._search_text = buildSearchText(clean);
        return clean;
      }

      if (!firstResult.done) {
        batch.push(sanitizeCsvRow(firstResult.value as Record<string, unknown>));
      }

      for await (const row of csvStream) {
        batch.push(sanitizeCsvRow(row as Record<string, unknown>));
        if (batch.length >= BATCH_SIZE) {
          await flushBatch(batch);
          batch = [];
        }
      }
      await flushBatch(batch);

    } else if (format === 'parquet') {
      const reader = await ParquetReader.openFile(tmpFile);
      const schema = reader.getSchema();
      const fieldNames = Object.keys(schema.fields).map(f => f.toLowerCase().trim());

      await syncSchema(fieldNames);

      const cursor = reader.getCursor();
      let batch: Record<string, unknown>[] = [];
      let record: Record<string, unknown> | null;

      while ((record = await cursor.next() as Record<string, unknown> | null)) {
        const normalized: Record<string, unknown> = { _ingestion_job_id: jobId, _source_file_name: fileName };
        for (const [key, val] of Object.entries(record)) {
          normalized[key.toLowerCase().trim()] = sanitizeValue(val);
        }
        // Ensure every row has a unique up_id (required for keyset pagination)
        if (!normalized.up_id) normalized.up_id = genId();
        // Build _search_text dynamically from curated columns
        normalized._search_text = buildSearchText(normalized);
        batch.push(normalized);

        if (batch.length >= BATCH_SIZE) {
          await flushBatch(batch);
          batch = [];
        }
      }
      await flushBatch(batch);
      await reader.close();
    }

    // Finalize: single atomic DB update — progress + status + completion
    // Archive is NON-BLOCKING — job is complete as soon as data is in ClickHouse.
    // MinIO upload continues in background and logs its own success/failure.
    progressStore.delete(jobId);
    await command(`
      ALTER TABLE ingestion_jobs UPDATE
        status = 'complete',
        rows_ingested = ${totalRows},
        rows_skipped = ${totalSkipped},
        completed_at = now()
      WHERE id = '${esc(jobId)}'
    `);
    const skipNote = totalSkipped > 0 ? ` (${totalSkipped.toLocaleString()} rows skipped)` : '';
    console.log(`[Ingestion] ${jobId}: Complete — ${totalRows.toLocaleString()} rows ingested${skipNote} (${format}).`);

    // Wait for archive before temp cleanup (so we don't delete the file mid-upload)
    // This does NOT block job completion — status is already 'complete' above.
    await archivePromise;

  } finally {
    // Clean up tracking state — prevents stale entries on failure or completion
    activeJobIds.delete(jobId);
    pausedJobs.delete(jobId);
    // Clean up temp files
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
  }
}

// ═══════════════════════════════════════════════════════════════
// Rollback & Archive
// ═══════════════════════════════════════════════════════════════

/**
 * Rollback a job — instantly delete all leads ingested by this job
 * and mark the job as 'rolled_back'.
 * Returns the number of rows deleted.
 */
export async function rollbackJob(jobId: string, performedBy?: string, performedByName?: string): Promise<{ rowsDeleted: number; fileName: string }> {
  const id = esc(jobId);

  // Get job info
  const [job] = await query<{ file_name: string; rows_ingested: string; status: string }>(
    `SELECT file_name, rows_ingested, status FROM ingestion_jobs WHERE id = '${id}' LIMIT 1`
  );
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status === 'rolled_back') throw new Error(`Job ${jobId} has already been rolled back`);

  // Count rows that will be deleted
  const [countResult] = await query<{ cnt: string }>(
    `SELECT count() as cnt FROM universal_person WHERE _ingestion_job_id = '${id}'`
  );
  const rowsToDelete = Number(countResult?.cnt || 0);

  // Delete the leads
  if (rowsToDelete > 0) {
    await command(`ALTER TABLE universal_person DELETE WHERE _ingestion_job_id = '${id}'`);
  }

  // Mark job as rolled back
  const byClause = performedByName ? ` by ${esc(performedByName)}` : '';
  await command(`
    ALTER TABLE ingestion_jobs UPDATE
      status = 'rolled_back',
      error_message = 'Rolled back${byClause} — ${rowsToDelete} rows deleted'
    WHERE id = '${id}'
  `);

  console.log(`[Ingestion] Rollback ${jobId}: Deleted ${rowsToDelete} rows from ${job.file_name}`);
  return { rowsDeleted: rowsToDelete, fileName: job.file_name };
}

/**
 * Archive a job — schedule its leads for deletion after `days` days.
 * The leads remain queryable until the TTL expires, then cleanupArchivedJobs() purges them.
 */
export async function archiveJob(jobId: string, days: number = 7, performedBy?: string, performedByName?: string): Promise<{ deleteAfter: string; fileName: string }> {
  const id = esc(jobId);

  const [job] = await query<{ file_name: string; status: string }>(
    `SELECT file_name, status FROM ingestion_jobs WHERE id = '${id}' LIMIT 1`
  );
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status === 'rolled_back') throw new Error(`Job ${jobId} has already been rolled back`);
  if (job.status === 'archived') throw new Error(`Job ${jobId} is already archived`);

  const deleteAfter = toClickHouseDateTime(new Date(Date.now() + days * 86400000));

  await command(`
    ALTER TABLE ingestion_jobs UPDATE
      status = 'archived',
      archived_at = now(),
      delete_after = '${deleteAfter}'
    WHERE id = '${id}'
  `);

  console.log(`[Ingestion] Archived ${jobId} (${job.file_name}) — will delete after ${deleteAfter}`);
  return { deleteAfter, fileName: job.file_name };
}

/**
 * Cleanup archived jobs whose TTL has expired.
 * Deletes the leads from universal_person and marks the job as rolled_back.
 * Intended to run on a schedule (hourly).
 */
export async function cleanupArchivedJobs(): Promise<number> {
  const expiredJobs = await query<{ id: string; file_name: string }>(
    `SELECT id, file_name FROM ingestion_jobs
     WHERE status = 'archived' AND delete_after IS NOT NULL AND delete_after <= now()`
  );

  if (expiredJobs.length === 0) return 0;

  let totalDeleted = 0;
  for (const job of expiredJobs) {
    try {
      const result = await rollbackJob(job.id);
      totalDeleted += result.rowsDeleted;
      console.log(`[Ingestion] Auto-cleaned archived job ${job.id} (${job.file_name}): ${result.rowsDeleted} rows deleted`);
    } catch (e: any) {
      console.error(`[Ingestion] Failed to clean archived job ${job.id}:`, e.message);
    }
  }

  return totalDeleted;
}

/** Start the hourly archive cleanup scheduler */
export function startArchiveCleanupScheduler(): void {
  const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  setInterval(async () => {
    try {
      const cleaned = await cleanupArchivedJobs();
      if (cleaned > 0) {
        console.log(`[Ingestion] Archive cleanup: ${cleaned} rows purged from expired archives`);
      }
    } catch (e: any) {
      console.error('[Ingestion] Archive cleanup error:', e.message);
    }
  }, INTERVAL_MS);
  console.log('[Ingestion] Archive cleanup scheduler started (runs hourly)');
}
