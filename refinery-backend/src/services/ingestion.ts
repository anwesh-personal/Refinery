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

/** Build an S3 client for the 5x5 Co-Op source bucket */
function getSourceClient(): S3Client {
  return new S3Client({
    region: env.s3Source.region,
    credentials: {
      accessKeyId: env.s3Source.accessKey,
      secretAccessKey: env.s3Source.secretKey,
    },
  });
}

/** Build an S3-compatible client for Linode Object Storage */
function getLinodeClient(): S3Client {
  return new S3Client({
    region: 'us-east-1',
    endpoint: env.linodeObj.endpoint,
    credentials: {
      accessKeyId: env.linodeObj.accessKey,
      secretAccessKey: env.linodeObj.secretKey,
    },
    forcePathStyle: true,
  });
}

/** Test connection to 5x5 source bucket */
export async function testSourceConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = getSourceClient();
    await client.send(new HeadBucketCommand({ Bucket: env.s3Source.bucket }));
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** Test connection to Linode Object Storage */
export async function testLinodeConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = getLinodeClient();
    await client.send(new HeadBucketCommand({ Bucket: env.linodeObj.bucket }));
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** List files in the 5x5 source bucket */
export async function listSourceFiles(prefix?: string): Promise<{ key: string; size: number; modified: string }[]> {
  const client = getSourceClient();
  const resp = await client.send(new ListObjectsV2Command({
    Bucket: env.s3Source.bucket,
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
 * 1. Download from 5x5 S3
 * 2. Upload to Linode Object Storage
 * 3. Stream-parse CSV and insert into ClickHouse
 */
export async function startIngestionJob(sourceKey: string): Promise<string> {
  const jobId = genId();
  const fileName = sourceKey.split('/').pop() || sourceKey;

  // Create job record
  await insertRows('ingestion_jobs', [{
    id: jobId,
    source_bucket: env.s3Source.bucket,
    source_key: sourceKey,
    file_name: fileName,
    status: 'downloading',
  }]);

  // Run the actual pipeline in the background (non-blocking)
  runIngestionPipeline(jobId, sourceKey, fileName).catch(async (err) => {
    console.error(`[Ingestion] Job ${jobId} failed:`, err.message);
    await command(`
      ALTER TABLE ingestion_jobs UPDATE 
        status = 'failed', error_message = '${err.message.replace(/'/g, "\\'")}'
      WHERE id = '${jobId}'
    `);
  });

  return jobId;
}

async function runIngestionPipeline(jobId: string, sourceKey: string, fileName: string) {
  const sourceClient = getSourceClient();
  const linodeClient = getLinodeClient();

  // Step 1: Download from S3
  console.log(`[Ingestion] ${jobId}: Downloading ${sourceKey}...`);
  const getResp = await sourceClient.send(new GetObjectCommand({
    Bucket: env.s3Source.bucket,
    Key: sourceKey,
  }));

  const bodyStream = getResp.Body as Readable;
  const fileSize = getResp.ContentLength || 0;

  // Step 2: Upload to Linode (streaming tee — simultaneous upload)
  console.log(`[Ingestion] ${jobId}: Uploading to Linode...`);
  await command(`ALTER TABLE ingestion_jobs UPDATE status = 'uploading', file_size_bytes = ${fileSize} WHERE id = '${jobId}'`);

  const linodeKey = `ingestion/${jobId}/${fileName}`;
  const upload = new Upload({
    client: linodeClient,
    params: {
      Bucket: env.linodeObj.bucket,
      Key: linodeKey,
      Body: bodyStream,
    },
    queueSize: 4,
    partSize: 10 * 1024 * 1024, // 10MB parts
  });
  await upload.done();

  // Step 3: Re-download from Linode and stream into ClickHouse
  console.log(`[Ingestion] ${jobId}: Ingesting into ClickHouse...`);
  await command(`ALTER TABLE ingestion_jobs UPDATE status = 'ingesting' WHERE id = '${jobId}'`);

  const linodeResp = await linodeClient.send(new GetObjectCommand({
    Bucket: env.linodeObj.bucket,
    Key: linodeKey,
  }));

  const csvStream = (linodeResp.Body as Readable).pipe(
    parse({
      columns: (header: string[]) => header.map((h: string) => h.toLowerCase().trim()),
      skip_empty_lines: true,
      relax_column_count: true,
    }),
  );

  let batch: Record<string, unknown>[] = [];
  let totalRows = 0;
  const BATCH_SIZE = 10000;

  for await (const row of csvStream) {
    row._ingestion_job_id = jobId;
    batch.push(row);

    if (batch.length >= BATCH_SIZE) {
      await insertRows('universal_person', batch);
      totalRows += batch.length;
      batch = [];
      // Update progress every batch
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
    WHERE id = '${jobId}'
  `);
  console.log(`[Ingestion] ${jobId}: Complete — ${totalRows.toLocaleString()} rows ingested.`);
}
