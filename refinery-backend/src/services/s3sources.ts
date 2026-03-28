import { S3Client, HeadBucketCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { query, command, insertRows } from '../db/clickhouse.js';
import { genId } from '../utils/helpers.js';
import { esc } from '../utils/sanitize.js';

/* ── Constants ── */
const DEFAULT_REGION = 'us-east-1';

/* ── Types ── */
export interface S3Source {
  id: string;
  label: string;
  bucket: string;
  region: string;
  access_key: string;
  secret_key: string;
  prefix: string;
  is_active: number;
  last_tested_at: string | null;
  last_test_ok: number;
  created_at: string;
  updated_at: string;
}

export interface S3SourceInput {
  label: string;
  bucket: string;
  region?: string;
  accessKey: string;
  secretKey: string;
  prefix?: string;
}

/** Build an S3 client from a source record or raw credentials */
export function buildClient(src: { region?: string; access_key: string; secret_key: string }): S3Client {
  return new S3Client({
    region: src.region || DEFAULT_REGION,
    credentials: {
      accessKeyId: src.access_key,
      secretAccessKey: src.secret_key,
    },
  });
}

/** Mask credentials for safe API responses */
export function maskCredentials<T extends { access_key?: string; secret_key?: string }>(source: T): T {
  return {
    ...source,
    access_key: source.access_key ? source.access_key.slice(0, 8) + '••••' : '',
    secret_key: source.secret_key ? '••••••••' + source.secret_key.slice(-4) : '',
  };
}

/* ── CRUD Operations ── */

/** List all active S3 sources */
export async function listSources(): Promise<S3Source[]> {
  return query<S3Source>('SELECT * FROM s3_sources FINAL WHERE is_active = 1 ORDER BY label');
}

/** Get a single source by ID */
export async function getSource(id: string): Promise<S3Source | null> {
  const rows = await query<S3Source>(`SELECT * FROM s3_sources FINAL WHERE id = '${esc(id)}' LIMIT 1`);
  return rows[0] || null;
}

/** Create a new S3 source */
export async function createSource(input: S3SourceInput): Promise<string> {
  const id = genId();
  await insertRows('s3_sources', [{
    id,
    label: input.label,
    bucket: input.bucket,
    region: input.region || DEFAULT_REGION,
    access_key: input.accessKey,
    secret_key: input.secretKey,
    prefix: input.prefix || '',
    is_active: 1,
  }]);
  return id;
}

/** Update an existing S3 source (ReplacingMergeTree — insert new version) */
export async function updateSource(id: string, input: Partial<S3SourceInput>): Promise<void> {
  const existing = await getSource(id);
  if (!existing) throw new Error(`Source ${id} not found`);

  await insertRows('s3_sources', [{
    id,
    label: input.label ?? existing.label,
    bucket: input.bucket ?? existing.bucket,
    region: input.region ?? existing.region,
    access_key: input.accessKey ?? existing.access_key,
    secret_key: input.secretKey ?? existing.secret_key,
    prefix: input.prefix ?? existing.prefix,
    is_active: existing.is_active,
    created_at: existing.created_at,
    updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  }]);
}

/** Hard-delete a source */
export async function deleteSource(id: string): Promise<void> {
  await command(`ALTER TABLE s3_sources DELETE WHERE id = '${esc(id)}'`);
}

/* ── Testing ── */

/** Test an already-saved S3 source's connection */
export async function testSource(id: string): Promise<{ ok: boolean; fileCount?: number; error?: string }> {
  const source = await getSource(id);
  if (!source) throw new Error(`Source ${id} not found`);

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  try {
    const client = buildClient(source);
    await client.send(new HeadBucketCommand({ Bucket: source.bucket }));

    const list = await client.send(new ListObjectsV2Command({
      Bucket: source.bucket,
      Prefix: source.prefix || undefined,
      MaxKeys: 5,
    }));

    // Persist test result
    await insertRows('s3_sources', [{
      ...source,
      last_tested_at: now,
      last_test_ok: 1,
      updated_at: now,
    }]);

    return { ok: true, fileCount: list.KeyCount || 0 };
  } catch (e: any) {
    await insertRows('s3_sources', [{
      ...source,
      last_tested_at: now,
      last_test_ok: 0,
      updated_at: now,
    }]);

    return { ok: false, error: e.message };
  }
}

/** Test credentials without saving (pre-save validation) */
export async function testCredentials(input: S3SourceInput): Promise<{ ok: boolean; fileCount?: number; error?: string }> {
  try {
    const client = buildClient({
      region: input.region,
      access_key: input.accessKey,
      secret_key: input.secretKey,
    });

    await client.send(new HeadBucketCommand({ Bucket: input.bucket }));

    const list = await client.send(new ListObjectsV2Command({
      Bucket: input.bucket,
      Prefix: input.prefix || undefined,
      MaxKeys: 5,
    }));

    return { ok: true, fileCount: list.KeyCount || 0 };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** List files from a specific source */
export async function listSourceFiles(id: string, prefix?: string) {
  const source = await getSource(id);
  if (!source) throw new Error(`Source ${id} not found`);

  const client = buildClient(source);
  const effectivePrefix = prefix || source.prefix || '';

  // Paginate through ALL files
  const allFiles: Array<{ key: string; size: number; modified: string }> = [];
  let continuationToken: string | undefined;

  do {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: source.bucket,
      Prefix: effectivePrefix,
      MaxKeys: 1000,
      ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
    }));

    for (const f of result.Contents || []) {
      allFiles.push({
        key: f.Key || '',
        size: f.Size || 0,
        modified: f.LastModified?.toISOString() || '',
      });
    }

    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  return allFiles;
}
