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
import { parse } from 'csv-parse';
import * as s3Sources from './s3sources.js';

/** Sanitise a string for inclusion in ClickHouse SQL */
function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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

/** List files in a source bucket — uses dynamic source if sourceId given, else env */
export async function listSourceFiles(prefix?: string, sourceId?: string): Promise<{ key: string; size: number; modified: string }[]> {
  let client: S3Client;
  let bucket: string;

  if (sourceId) {
    const src = await s3Sources.getSource(sourceId);
    if (!src) throw new Error(`S3 source '${sourceId}' not found`);
    client = s3Sources.buildClient(src);
    bucket = src.bucket;
    prefix = prefix || src.prefix || undefined;
  } else {
    client = getSourceClient();
    bucket = env.s3Source.bucket;
  }

  const resp = await client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    MaxKeys: 100,
  }));

  return (resp.Contents || []).map((obj) => ({
    key: obj.Key || '',
    size: obj.Size || 0,
    modified: obj.LastModified?.toISOString() || '',
  }));
}

/** Get all ingestion jobs */
export async function getJobs() {
  return query('SELECT * FROM ingestion_jobs ORDER BY started_at DESC LIMIT 50');
}

/** Get ingestion stats */
export async function getIngestionStats() {
  const [stats] = await query<{
    total_jobs: string;
    total_rows: string;
    total_bytes: string;
    pending: string;
  }>(`
    SELECT 
      count() as total_jobs,
      sum(rows_ingested) as total_rows,
      sum(file_size_bytes) as total_bytes,
      countIf(status = 'pending' OR status = 'downloading') as pending
    FROM ingestion_jobs
  `);
  return stats;
}

/**
 * Start an ingestion job:
 * 1. Download from source S3 (dynamic or env-based)
 * 2. Upload to Linode Object Storage
 * 3. Stream-parse CSV and insert into ClickHouse
 */
export async function startIngestionJob(sourceKey: string, sourceId?: string): Promise<string> {
  const jobId = genId();
  const fileName = sourceKey.split('/').pop() || sourceKey;

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

  // Run the actual pipeline in the background (non-blocking)
  runIngestionPipeline(jobId, sourceKey, fileName, sourceClient, sourceBucket).catch(async (err) => {
    console.error(`[Ingestion] Job ${jobId} failed:`, err.message);
    await command(`
      ALTER TABLE ingestion_jobs UPDATE 
        status = 'failed', error_message = '${esc(String(err.message || 'Unknown error'))}'
      WHERE id = '${esc(jobId)}'
    `);
  });

  return jobId;
}

async function runIngestionPipeline(jobId: string, sourceKey: string, fileName: string, sourceClient: S3Client, sourceBucket: string) {
  const storageClient = getStorageClient();

  // Step 1: Download from S3
  console.log(`[Ingestion] ${jobId}: Downloading ${sourceKey} from ${sourceBucket}...`);
  const getResp = await sourceClient.send(new GetObjectCommand({
    Bucket: sourceBucket,
    Key: sourceKey,
  }));

  const bodyStream = getResp.Body as Readable;
  const fileSize = getResp.ContentLength || 0;

  // Step 2: Upload to Object Storage (MinIO)
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
    partSize: 10 * 1024 * 1024, // 10MB parts
  });
  await upload.done();

  // Step 3: Re-download from Object Storage and stream into ClickHouse
  console.log(`[Ingestion] ${jobId}: Ingesting into ClickHouse...`);
  await command(`ALTER TABLE ingestion_jobs UPDATE status = 'ingesting' WHERE id = '${esc(jobId)}'`);

  const storageResp = await storageClient.send(new GetObjectCommand({
    Bucket: env.objectStorage.bucket,
    Key: storageKey,
  }));

  // Track CSV headers for dynamic column creation
  let csvHeaders: string[] = [];

  const csvStream = (storageResp.Body as Readable).pipe(
    parse({
      columns: (header: string[]) => {
        csvHeaders = header.map((h: string) => h.toLowerCase().trim());
        return csvHeaders;
      },
      skip_empty_lines: true,
      relax_column_count: true,
    }),
  );

  // Step 3a: Auto-detect and add missing columns to ClickHouse
  // We need to read the first row to trigger header parsing, then handle schema
  const iterator = csvStream[Symbol.asyncIterator]();
  const firstResult = await iterator.next();

  if (!firstResult.done && csvHeaders.length > 0) {
    // Get existing columns from ClickHouse
    const existingCols = await query<{ name: string }>(`
      SELECT name FROM system.columns 
      WHERE database = '${esc(env.clickhouse.database)}' AND table = 'universal_person'
    `);
    const existingSet = new Set(existingCols.map(c => c.name));

    // Find columns in CSV that don't exist in the table
    const missingCols = csvHeaders.filter(h => !existingSet.has(h));

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

  // Step 3b: Insert all rows (including the first one we already read)
  let batch: Record<string, unknown>[] = [];
  let totalRows = 0;
  const BATCH_SIZE = 10000;

  // Process first row
  if (!firstResult.done) {
    const row = firstResult.value as Record<string, unknown>;
    row._ingestion_job_id = jobId;
    batch.push(row);
  }

  // Process remaining rows
  for await (const row of csvStream) {
    (row as Record<string, unknown>)._ingestion_job_id = jobId;
    batch.push(row as Record<string, unknown>);

    if (batch.length >= BATCH_SIZE) {
      await insertRows('universal_person', batch);
      totalRows += batch.length;
      batch = [];
      if (totalRows % 100000 === 0) {
        console.log(`[Ingestion] ${jobId}: ${totalRows.toLocaleString()} rows inserted...`);
      }
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    await insertRows('universal_person', batch);
    totalRows += batch.length;
  }

  // Mark complete
  await command(`
    ALTER TABLE ingestion_jobs UPDATE 
      status = 'complete', rows_ingested = ${totalRows}, completed_at = now()
    WHERE id = '${esc(jobId)}'
  `);
  console.log(`[Ingestion] ${jobId}: Complete — ${totalRows.toLocaleString()} rows ingested.`);
}
