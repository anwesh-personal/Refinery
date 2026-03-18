import { env } from '../config/env.js';
import { query } from '../db/clickhouse.js';
import { createClient } from '@supabase/supabase-js';
import FormData from 'form-data';
import fs from 'fs';

// ═══════════════════════════════════════════════════════════════
// Verify550 Proxy Service
//
// Proxies all requests to Verify550 API keeping the secret key
// server-side. Resolves API key with priority:
//   1. Per-user key (from Supabase profiles.verify550_api_key)
//   2. Org-wide key (from ClickHouse system_config)
//   3. Env var (VERIFY550_API_KEY)
// ═══════════════════════════════════════════════════════════════

const V550_BASE = 'https://app.verify550.com/api';

const supabaseAdmin = createClient(
  env.supabase.url,
  env.supabase.secretKey || '',
  { auth: { persistSession: false } }
);

/**
 * Resolve the Verify550 API secret for a given user.
 * Priority: user personal key → org system_config → env var
 */
export async function resolveApiKey(userId?: string): Promise<string> {
  // 1. Try user's personal key
  if (userId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('verify550_api_key')
        .eq('id', userId)
        .single();
      if (!error && data?.verify550_api_key) return data.verify550_api_key;
    } catch (err: any) {
      console.warn(`[Verify550] Failed to fetch personal key for user ${userId}: ${err.message}`);
    }
  }

  // 2. Try org-wide key from ClickHouse system_config
  try {
    const rows = await query<{ config_value: string }>(
      `SELECT config_value FROM system_config WHERE config_key = 'verify550_api_key' FINAL LIMIT 1`
    );
    if (rows[0]?.config_value) return rows[0].config_value;
  } catch (err: any) {
     console.warn(`[Verify550] Failed to fetch org key from clickhouse: ${err.message}`);
  }

  // 3. Fall back to env var
  if (env.verify550?.apiKey) return env.verify550.apiKey;

  throw new Error('Verify550 configuration missing. Add an API key globally in Verification Config or in your Personal Settings.');
}

/** Get credit count */
export async function getCredits(apiKey: string): Promise<number> {
  const resp = await fetch(`${V550_BASE}/getCredit?secret=${encodeURIComponent(apiKey)}`);
  if (!resp.ok) throw new Error(`Verify550 API error: HTTP ${resp.status}`);
  const text = await resp.text();
  const count = Number(text);
  if (isNaN(count)) throw new Error(`Invalid credit response: ${text}`);
  return count;
}

/** Verify a single email */
export async function verifySingle(apiKey: string, email: string): Promise<string> {
  const resp = await fetch(
    `${V550_BASE}/verifyemail?secret=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}`
  );
  if (!resp.ok) throw new Error(`Verify550 API error: HTTP ${resp.status}`);
  return (await resp.text()).trim();
}

/** Upload a CSV file for bulk verification from disk to handle massive files safely */
export async function uploadBulk(
  apiKey: string, 
  filename: string, 
  filePath: string
): Promise<{ success: boolean; message: string; id: string; job_id: string; filename: string }> {
  try {
    const formData = new FormData();
    formData.append('file_contents', fs.createReadStream(filePath), {
      filename,
      contentType: 'text/csv'
    });

    const resp = await fetch(
      `${V550_BASE}/bulk?secret=${encodeURIComponent(apiKey)}&filename=${encodeURIComponent(filename)}`,
      { 
        method: 'POST', 
        headers: formData.getHeaders(),
        body: formData as any 
      }
    );
    
    if (!resp.ok) throw new Error(`Verify550 bulk upload failed: HTTP ${resp.status}`);
    return await resp.json() as any;
  } finally {
    // Always sweep the temp file afterward
    fs.unlink(filePath, () => {});
  }
}

/** Get job details */
export async function getJob(apiKey: string, jobId: string): Promise<any> {
  const resp = await fetch(`${V550_BASE}/getjob/${encodeURIComponent(jobId)}?secret=${encodeURIComponent(apiKey)}`);
  if (!resp.ok) throw new Error(`Verify550 API error: HTTP ${resp.status}`);
  return await resp.json();
}

/** Get all completed jobs */
export async function getCompletedJobs(apiKey: string): Promise<any[]> {
  const resp = await fetch(`${V550_BASE}/completedjobs?secret=${encodeURIComponent(apiKey)}`);
  if (!resp.ok) throw new Error(`Verify550 API error: HTTP ${resp.status}`);
  const data = await resp.json() as any;
  return Array.isArray(data) ? data : (data?.data || []);
}

/** Get all running jobs */
export async function getRunningJobs(apiKey: string): Promise<any[]> {
  const resp = await fetch(`${V550_BASE}/runningjobs?secret=${encodeURIComponent(apiKey)}`);
  if (!resp.ok) throw new Error(`Verify550 API error: HTTP ${resp.status}`);
  const data = await resp.json() as any;
  return Array.isArray(data) ? data : (data?.data || []);
}

/** Export job results — returns a binary .zip buffer */
export async function exportJob(
  apiKey: string,
  jobId: string,
  format?: 'xlsx' | 'csv',
  categories?: string[]
): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const params = new URLSearchParams({ secret: apiKey });
  if (format) params.set('format', format);
  if (categories && categories.length > 0) params.set('categories', categories.join(','));

  const exportUrl = `${V550_BASE}/jobexport/${encodeURIComponent(jobId)}?${params.toString()}`;
  const resp = await fetch(exportUrl);
  if (!resp.ok) throw new Error(`Verify550 export failed: HTTP ${resp.status}`);

  const arrayBuffer = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = resp.headers.get('content-type') || 'application/zip';
  const contentDisp = resp.headers.get('content-disposition') || '';
  const filenameMatch = contentDisp.match(/filename="?([^"]+)"?/);
  const filename = filenameMatch?.[1] || `verify550-${jobId}.zip`;

  return { buffer, contentType, filename };
}
