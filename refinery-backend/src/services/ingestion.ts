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

/** Sanitise a string for inclusion in ClickHouse SQL */
function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ═══════════════════════════════════════════════════════════════
// Concurrency-Controlled Ingestion Queue
//
// Limits parallel pipelines to MAX_CONCURRENT to prevent OOM,
// bandwidth saturation, and ClickHouse write contention.
// Queue depth is unlimited — submit 5,000 files if you want.
// ═══════════════════════════════════════════════════════════════
const MAX_CONCURRENT = 5;
let activeCount = 0;
const waitQueue: Array<{ resolve: () => void }> = [];

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
export function getQueueStatus(): { active: number; queued: number; maxConcurrent: number } {
  return { active: activeCount, queued: waitQueue.length, maxConcurrent: MAX_CONCURRENT };
}

/**
 * Recover stale ingestion jobs on startup.
 *
 * When PM2 restarts the process, any in-flight background workers are killed
 * but their ClickHouse job records still say "downloading" / "uploading" etc.
 * This function marks them as failed so they don't appear as perpetually "in progress".
 *
 * Returns the number of jobs recovered.
 */
export async function recoverStaleIngestionJobs(): Promise<number> {
  const staleStatuses = ['pending', 'downloading', 'uploading', 'ingesting'];
  const [countResult] = await query<{ cnt: string }>(
    `SELECT count() as cnt FROM ingestion_jobs WHERE status IN ('${staleStatuses.join("','")}')`
  );
  const count = Number(countResult?.cnt || 0);

  if (count > 0) {
    await command(`
      ALTER TABLE ingestion_jobs UPDATE
        status = 'failed',
        error_message = 'Interrupted by server restart — re-ingest to retry'
      WHERE status IN ('${staleStatuses.join("','")}')
    `);
    console.log(`[Ingestion] ⚠ Recovered ${count} stale job(s) — marked as failed.`);
  }

  return count;
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

  const resp = await client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: effectivePrefix,
    Delimiter: '/',
    MaxKeys: 1000,
  }));

  const folders = (resp.CommonPrefixes || []).map(cp => cp.Prefix!).filter(Boolean);
  const files = (resp.Contents || [])
    .filter(obj => obj.Key && obj.Key !== effectivePrefix)
    .map(obj => ({
      key: obj.Key!,
      size: obj.Size || 0,
      modified: obj.LastModified?.toISOString() || '',
    }));

  return { folders, files, prefix: effectivePrefix };
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
  if (format === 'unknown' || format === 'parquet') {
    throw new Error(`Preview not supported for ${format} files. Only CSV and gzipped CSV are previewable.`);
  }

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
export async function getJobs(limit = 50) {
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

/**
 * Start an ingestion job:
 * 1. Download from source S3 (dynamic or env-based)
 * 2. Upload to Linode Object Storage
 * 3. Parse file (CSV / GZ / Parquet) and insert into ClickHouse
 */
export async function startIngestionJob(sourceKey: string, sourceId?: string): Promise<string> {
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

  // Create job record
  await insertRows('ingestion_jobs', [{
    id: jobId,
    source_bucket: sourceBucket,
    source_key: sourceKey,
    file_name: fileName,
    status: 'downloading',
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
          status = 'failed', error_message = '${esc(String(err.message || 'Unknown error'))}'
        WHERE id = '${esc(jobId)}'
      `);
    } finally {
      releasePipelineSlot();
    }
  })();

  return jobId;
}

/**
 * Bulk ingestion — batch-insert all job records in ONE ClickHouse call,
 * then fire background workers. No file count limit.
 * This avoids the socket hang up caused by 500+ sequential insertRows calls.
 */
export async function startBulkIngestion(sourceKeys: string[], sourceId?: string): Promise<string[]> {
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

  for (const key of sourceKeys) {
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
    });
  }

  if (rows.length === 0) {
    throw new Error('No supported files found in the provided list.');
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
            status = 'failed', error_message = '${esc(String(err.message || 'Unknown error'))}'
          WHERE id = '${esc(job.id)}'
        `);
      } finally {
        releasePipelineSlot();
      }
    })();
  }

  return jobs.map(j => j.id);
}

async function runIngestionPipeline(jobId: string, sourceKey: string, fileName: string, format: FileFormat, sourceClient: S3Client, sourceBucket: string) {
  const storageClient = getStorageClient();
  const BATCH_SIZE = 10000;
  let totalRows = 0;

  // Step 1: Download from S3
  console.log(`[Ingestion] ${jobId}: Downloading ${sourceKey} from ${sourceBucket}... (format: ${format})`);
  const getResp = await sourceClient.send(new GetObjectCommand({
    Bucket: sourceBucket,
    Key: sourceKey,
  }));

  const bodyStream = getResp.Body as Readable;
  const fileSize = getResp.ContentLength || 0;

  // Step 2: Upload to Object Storage (MinIO) — archive the raw file
  console.log(`[Ingestion] ${jobId}: Uploading to Object Storage...`);
  await command(`ALTER TABLE ingestion_jobs UPDATE status = 'uploading', file_size_bytes = ${fileSize} WHERE id = '${esc(jobId)}'`);

  const storageKey = `ingestion/${jobId}/${fileName}`;
  const upload = new Upload({
    client: storageClient,
    params: {
      Bucket: env.objectStorage.bucket,
      Key: storageKey,
      Body: bodyStream,
    },
    queueSize: 4,
    partSize: 10 * 1024 * 1024,
  });
  await upload.done();

  // Step 3: Re-download from Object Storage and ingest into ClickHouse
  console.log(`[Ingestion] ${jobId}: Ingesting into ClickHouse (${format})...`);
  await command(`ALTER TABLE ingestion_jobs UPDATE status = 'ingesting' WHERE id = '${esc(jobId)}'`);

  const storageResp = await storageClient.send(new GetObjectCommand({
    Bucket: env.objectStorage.bucket,
    Key: storageKey,
  }));
  const rawStream = storageResp.Body as Readable;

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

  async function flushBatch(batch: Record<string, unknown>[]) {
    if (batch.length === 0) return;
    await insertRows('universal_person', batch);
    totalRows += batch.length;
    // Update progress in the job record so the UI can show live row counts
    await command(`ALTER TABLE ingestion_jobs UPDATE rows_ingested = ${totalRows} WHERE id = '${esc(jobId)}'`);
    if (totalRows % 100000 === 0) {
      console.log(`[Ingestion] ${jobId}: ${totalRows.toLocaleString()} rows inserted...`);
    }
  }

  // ─── Format-specific parsing ───
  if (format === 'csv' || format === 'csv.gz') {
    // Decompress if gzipped, then pipe through csv-parse
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
      }),
    );

    // Read first row to trigger header parsing
    const iterator = csvStream[Symbol.asyncIterator]();
    const firstResult = await iterator.next();

    if (!firstResult.done && csvHeaders.length > 0) {
      await syncSchema(csvHeaders);
    }

    // Insert all rows
    let batch: Record<string, unknown>[] = [];

    if (!firstResult.done) {
      const row = firstResult.value as Record<string, unknown>;
      row._ingestion_job_id = jobId;
      row._source_file_name = fileName;
      batch.push(row);
    }

    for await (const row of csvStream) {
      (row as Record<string, unknown>)._ingestion_job_id = jobId;
      (row as Record<string, unknown>)._source_file_name = fileName;
      batch.push(row as Record<string, unknown>);
      if (batch.length >= BATCH_SIZE) {
        await flushBatch(batch);
        batch = [];
      }
    }
    await flushBatch(batch);

  } else if (format === 'parquet') {
    // Parquet: write to temp file, then read with parquetjs cursor
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'refinery-pq-'));
    const tmpFile = path.join(tmpDir, fileName);

    try {
      // Write stream to temp file
      const writeStream = fs.createWriteStream(tmpFile);
      await new Promise<void>((resolve, reject) => {
        rawStream.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      // Open parquet file
      const reader = await ParquetReader.openFile(tmpFile);
      const schema = reader.getSchema();
      const fieldNames = Object.keys(schema.fields).map(f => f.toLowerCase().trim());

      // Sync schema with ClickHouse
      await syncSchema(fieldNames);

      // Read rows via cursor
      const cursor = reader.getCursor();
      let batch: Record<string, unknown>[] = [];
      let record: Record<string, unknown> | null;

      while ((record = await cursor.next() as Record<string, unknown> | null)) {
        // Normalize keys to lowercase
        const normalized: Record<string, unknown> = { _ingestion_job_id: jobId, _source_file_name: fileName };
        for (const [key, val] of Object.entries(record)) {
          normalized[key.toLowerCase().trim()] = val != null ? String(val) : null;
        }
        batch.push(normalized);

        if (batch.length >= BATCH_SIZE) {
          await flushBatch(batch);
          batch = [];
        }
      }
      await flushBatch(batch);
      await reader.close();
    } finally {
      // Clean up temp files
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
    }
  }

  // Mark complete
  await command(`
    ALTER TABLE ingestion_jobs UPDATE 
      status = 'complete', rows_ingested = ${totalRows}, completed_at = now()
    WHERE id = '${esc(jobId)}'
  `);
  console.log(`[Ingestion] ${jobId}: Complete — ${totalRows.toLocaleString()} rows ingested (${format}).`);
}

// ═══════════════════════════════════════════════════════════════
// Rollback & Archive
// ═══════════════════════════════════════════════════════════════

/**
 * Rollback a job — instantly delete all leads ingested by this job
 * and mark the job as 'rolled_back'.
 * Returns the number of rows deleted.
 */
export async function rollbackJob(jobId: string): Promise<{ rowsDeleted: number; fileName: string }> {
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
  await command(`
    ALTER TABLE ingestion_jobs UPDATE
      status = 'rolled_back',
      error_message = 'Rolled back — ${rowsToDelete} rows deleted'
    WHERE id = '${id}'
  `);

  console.log(`[Ingestion] Rollback ${jobId}: Deleted ${rowsToDelete} rows from ${job.file_name}`);
  return { rowsDeleted: rowsToDelete, fileName: job.file_name };
}

/**
 * Archive a job — schedule its leads for deletion after `days` days.
 * The leads remain queryable until the TTL expires, then cleanupArchivedJobs() purges them.
 */
export async function archiveJob(jobId: string, days: number = 7): Promise<{ deleteAfter: string; fileName: string }> {
  const id = esc(jobId);

  const [job] = await query<{ file_name: string; status: string }>(
    `SELECT file_name, status FROM ingestion_jobs WHERE id = '${id}' LIMIT 1`
  );
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status === 'rolled_back') throw new Error(`Job ${jobId} has already been rolled back`);
  if (job.status === 'archived') throw new Error(`Job ${jobId} is already archived`);

  const deleteAfter = new Date(Date.now() + days * 86400000)
    .toISOString().replace('T', ' ').slice(0, 19);

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
