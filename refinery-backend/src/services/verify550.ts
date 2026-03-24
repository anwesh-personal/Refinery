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
      `SELECT config_value FROM system_config FINAL WHERE config_key = 'verify550_api_key' LIMIT 1`
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

// ═══════════════════════════════════════════════════════════════
// V550 → ClickHouse Import System
//
// Maps all 26 Verify550 categories to our internal status:
//   valid   — safe to send (ok, ok_for_all)
//   risky   — use with caution (unknown, antispam_system, soft_bounce, departmental, invalid_vendor_response)
//   invalid — do not send (email_disabled, dead_server, invalid_mx, invalid_syntax, smtp_protocol, hard_bounces)
//   threat  — blacklist immediately (complainers, sleeper_cell, seeds, email_bot, spamcops, spamtraps, etc.)
// ═══════════════════════════════════════════════════════════════

import AdmZip from 'adm-zip';
import { command } from '../db/clickhouse.js';

export const CATEGORY_STATUS_MAP: Record<string, 'valid' | 'risky' | 'invalid' | 'threat'> = {
  // ✅ Safe
  ok: 'valid',
  ok_for_all: 'valid',
  // ⚠️ Risky
  unknown: 'risky',
  antispam_system: 'risky',
  soft_bounce: 'risky',
  departmental: 'risky',
  invalid_vendor_response: 'risky',
  // ❌ Dead
  email_disabled: 'invalid',
  dead_server: 'invalid',
  invalid_mx: 'invalid',
  invalid_syntax: 'invalid',
  smtp_protocol: 'invalid',
  hard_bounces: 'invalid',
  // 🚫 Threats
  complainers: 'threat',
  sleeper_cell: 'threat',
  seeds: 'threat',
  email_bot: 'threat',
  spamcops: 'threat',
  spamtraps: 'threat',
  threat_endings: 'threat',
  threat_string: 'threat',
  // V550 bulk API uses "thread" spelling (inconsistency in their API)
  thread_endings: 'threat',
  thread_string: 'threat',
  advisory_trap: 'threat',
  blacklisted: 'threat',
  disposables: 'threat',
  bot_clickers: 'threat',
  litigators: 'threat',
  lashback: 'threat',
};

/**
 * Download a V550 job's results, unzip the .zip, parse CSVs to extract emails by category.
 * Returns a map of category → email[].
 */
export async function exportAndParseJobEmails(
  apiKey: string,
  jobId: string,
  categories?: string[],
): Promise<Map<string, string[]>> {
  const { buffer } = await exportJob(apiKey, jobId, 'csv', categories);

  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const categoryEmails = new Map<string, string[]>();

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const filename = entry.name.toLowerCase();
    if (!filename.endsWith('.csv') && !filename.endsWith('.txt')) continue;

    // V550 names files like "ok.csv", "email_disabled.csv", etc.
    const category = filename.replace(/\.[^.]+$/, '').toLowerCase();
    const content = entry.getData().toString('utf-8');
    const lines = content.split(/\r?\n/).filter(l => l.trim());

    const emails: string[] = [];
    for (const line of lines) {
      // Each line is just an email (V550 CSV format)
      const email = line.trim().replace(/^["']|["']$/g, '').toLowerCase();
      if (email && email.includes('@') && !email.startsWith('email')) {
        emails.push(email);
      }
    }

    if (emails.length > 0) {
      categoryEmails.set(category, emails);
    }
  }

  return categoryEmails;
}

/**
 * Import a completed V550 job's results into ClickHouse.
 * For each email, updates _verification_status, _verified_at, and _v550_category.
 * Returns counts of how many were matched & updated per status.
 */
export async function importJobToClickHouse(
  apiKey: string,
  jobId: string,
): Promise<{
  totalProcessed: number;
  matched: number;
  updated: { valid: number; risky: number; invalid: number; threat: number };
  categories: Record<string, number>;
}> {
  // 1. Get job detail to know which categories have data
  const jobDetail = await getJob(apiKey, jobId);
  const jobData = jobDetail?.data || jobDetail;
  if (!jobData || jobData.status !== 'finished') {
    throw new Error(`Job ${jobId} is not finished (status: ${jobData?.status || 'unknown'})`);
  }

  const suppressionResults: Record<string, number> = jobData.suppression_results || {};
  const activeCategories = Object.entries(suppressionResults)
    .filter(([_, count]) => count > 0)
    .map(([cat]) => cat);

  if (activeCategories.length === 0) {
    throw new Error('No categories with results found in this job');
  }

  // 2. Export all categories at once & parse
  const categoryEmails = await exportAndParseJobEmails(apiKey, jobId, activeCategories);

  let totalProcessed = 0;
  let matched = 0;
  const updated = { valid: 0, risky: 0, invalid: 0, threat: 0 };
  const categoryCounts: Record<string, number> = {};

  // 3. For each category, match emails against ClickHouse and update
  for (const [category, emails] of categoryEmails) {
    const status = CATEGORY_STATUS_MAP[category] || 'risky';
    categoryCounts[category] = emails.length;
    totalProcessed += emails.length;

    // Process in batches of 500 to avoid SQL length limits
    const BATCH_SIZE = 500;
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      const emailList = batch.map(e => `'${e.replace(/'/g, "''")}'`).join(',');

      // Map V550 status to our internal status
      const internalStatus = status === 'threat' ? 'invalid' : status;
      const bouncedFlag = status === 'invalid' || status === 'threat' ? 1 : 0;

      // Count matches before update
      const [matchCount] = await query<{ cnt: string }>(`
        SELECT count() as cnt FROM universal_person
        WHERE lower(business_email) IN (${emailList})
           OR lower(personal_emails) IN (${emailList})
      `);
      const batchMatched = Number(matchCount?.cnt || 0);
      matched += batchMatched;
      updated[status] += batchMatched;

      // Update matching leads
      if (batchMatched > 0) {
        await command(`
          ALTER TABLE universal_person UPDATE
            _verification_status = '${internalStatus}',
            _v550_category = '${category}',
            _verified_at = now(),
            _bounced = ${bouncedFlag}
          WHERE (lower(business_email) IN (${emailList})
             OR lower(personal_emails) IN (${emailList}))
            AND (_verification_status IS NULL
              OR _verification_status != '${internalStatus}'
              OR _v550_category IS NULL
              OR _v550_category != '${category}')
        `);
      }
    }
  }

  console.log(`[V550 Import] Job ${jobId}: ${totalProcessed} emails processed, ${matched} matched in DB. Valid:${updated.valid} Risky:${updated.risky} Invalid:${updated.invalid} Threat:${updated.threat}`);

  return { totalProcessed, matched, updated, categories: categoryCounts };
}

