import { query, command, insertRows } from '../db/clickhouse.js';
import { genId } from '../utils/helpers.js';
import cron from 'node-cron';
import * as ingestion from './ingestion.js';

/** Sanitise a string for ClickHouse SQL */
function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/* ── Interfaces ── */
export interface IngestionRule {
  id: string;
  source_id: string;
  label: string;
  prefix_pattern: string;
  file_types: string[];
  min_date: string | null;
  max_file_size_mb: number | null;
  min_file_size_mb: number | null;
  schedule: string;
  enabled: number;
  skip_duplicates: number;
  created_at: string;
  last_run_at: string | null;
  last_run_status: string | null;
  files_found_last_run: number | null;
  files_ingested_last_run: number | null;
}

export interface CreateRuleParams {
  source_id: string;
  label: string;
  prefix_pattern?: string;
  file_types?: string[];
  min_date?: string;
  max_file_size_mb?: number;
  min_file_size_mb?: number;
  schedule?: string;
  enabled?: boolean;
  skip_duplicates?: boolean;
}

/* ── CRUD ── */
export async function listRules(): Promise<IngestionRule[]> {
  return query<IngestionRule>('SELECT * FROM ingestion_rules ORDER BY created_at DESC');
}

export async function getRule(id: string): Promise<IngestionRule | null> {
  const [rule] = await query<IngestionRule>(`SELECT * FROM ingestion_rules WHERE id = '${esc(id)}'`);
  return rule || null;
}

export async function createRule(params: CreateRuleParams): Promise<string> {
  const id = genId();
  await insertRows('ingestion_rules', [{
    id,
    source_id: params.source_id,
    label: params.label,
    prefix_pattern: params.prefix_pattern || '',
    file_types: params.file_types || ['csv', 'gz', 'parquet'],
    min_date: params.min_date || null,
    max_file_size_mb: params.max_file_size_mb || null,
    min_file_size_mb: params.min_file_size_mb || null,
    schedule: params.schedule || '0 */6 * * *',
    enabled: params.enabled !== false ? 1 : 0,
    skip_duplicates: params.skip_duplicates !== false ? 1 : 0,
  }]);
  if (params.enabled !== false) {
    registerCronJob(id, params.schedule || '0 */6 * * *');
  }
  return id;
}

export async function updateRule(id: string, params: Partial<CreateRuleParams>): Promise<void> {
  const sets: string[] = [];
  if (params.label !== undefined) sets.push(`label = '${esc(params.label)}'`);
  if (params.prefix_pattern !== undefined) sets.push(`prefix_pattern = '${esc(params.prefix_pattern)}'`);
  if (params.file_types !== undefined) sets.push(`file_types = [${params.file_types.map(t => `'${esc(t)}'`).join(',')}]`);
  if (params.min_date !== undefined) sets.push(params.min_date ? `min_date = '${esc(params.min_date)}'` : `min_date = NULL`);
  if (params.max_file_size_mb !== undefined) sets.push(params.max_file_size_mb ? `max_file_size_mb = ${params.max_file_size_mb}` : `max_file_size_mb = NULL`);
  if (params.min_file_size_mb !== undefined) sets.push(params.min_file_size_mb ? `min_file_size_mb = ${params.min_file_size_mb}` : `min_file_size_mb = NULL`);
  if (params.schedule !== undefined) sets.push(`schedule = '${esc(params.schedule)}'`);
  if (params.enabled !== undefined) sets.push(`enabled = ${params.enabled ? 1 : 0}`);
  if (params.skip_duplicates !== undefined) sets.push(`skip_duplicates = ${params.skip_duplicates ? 1 : 0}`);

  if (sets.length === 0) return;

  await command(`ALTER TABLE ingestion_rules UPDATE ${sets.join(', ')} WHERE id = '${esc(id)}'`);

  // Re-register cron
  unregisterCronJob(id);
  const rule = await getRule(id);
  if (rule && rule.enabled) {
    registerCronJob(id, rule.schedule);
  }
}

export async function deleteRule(id: string): Promise<void> {
  unregisterCronJob(id);
  await command(`ALTER TABLE ingestion_rules DELETE WHERE id = '${esc(id)}'`);
}

export async function toggleRule(id: string, enabled: boolean): Promise<void> {
  await command(`ALTER TABLE ingestion_rules UPDATE enabled = ${enabled ? 1 : 0} WHERE id = '${esc(id)}'`);
  if (enabled) {
    const rule = await getRule(id);
    if (rule) registerCronJob(id, rule.schedule);
  } else {
    unregisterCronJob(id);
  }
}

/* ═══════════════════════════════════════════════════════════
   Execution Locks — prevent conflicts between overlapping rules
   
   1. executingRules: prevents the SAME rule from running twice
      if the previous tick hasn't finished yet.
   2. inFlightFiles: prevents TWO DIFFERENT rules from both
      ingesting the same file simultaneously (the "chicken-egg"
      scenario where both see a file as "not yet ingested" and
      both start a job for it).
   ═══════════════════════════════════════════════════════════ */
const executingRules = new Set<string>();
const inFlightFiles = new Set<string>();

/* ── Rule Execution ── */
export async function executeRule(id: string): Promise<{ filesFound: number; filesIngested: number; skipped: number }> {
  // Guard: prevent overlapping execution of the same rule
  if (executingRules.has(id)) {
    console.warn(`[AutoIngest] Rule '${id}' is already executing — skipping this tick.`);
    return { filesFound: 0, filesIngested: 0, skipped: 0 };
  }

  executingRules.add(id);
  try {
    const rule = await getRule(id);
    if (!rule) throw new Error(`Rule '${id}' not found`);

    console.log(`[AutoIngest] Rule '${rule.label}' (${id}): Scanning...`);

    // List files from the source with the rule's prefix
    const { files } = await ingestion.listSourceFiles(rule.prefix_pattern || undefined, rule.source_id);

    // Filter by file type
    const allowedTypes = new Set(rule.file_types.map(t => t.toLowerCase()));
    let matched = files.filter(f => {
      const name = f.key.split('/').pop()?.toLowerCase() || '';
      if (name.endsWith('.parquet') || name.endsWith('.pqt')) return allowedTypes.has('parquet');
      if (name.endsWith('.gz')) return allowedTypes.has('gz');
      if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) return allowedTypes.has('csv');
      return false;
    });

    // Filter by date if set
    if (rule.min_date) {
      const minTime = new Date(rule.min_date).getTime();
      matched = matched.filter(f => new Date(f.modified).getTime() >= minTime);
    }

    // Filter by max file size
    if (rule.max_file_size_mb) {
      const maxBytes = rule.max_file_size_mb * 1024 * 1024;
      matched = matched.filter(f => f.size <= maxBytes);
    }

    // Filter by min file size
    if (rule.min_file_size_mb) {
      const minBytes = rule.min_file_size_mb * 1024 * 1024;
      matched = matched.filter(f => f.size >= minBytes);
    }

    const filesFound = matched.length;
    let filesIngested = 0;
    let skipped = 0;

    // Skip duplicates — check against ALL non-failed jobs (complete + in-progress)
    // This prevents double-ingestion when two rules fire close together
    let alreadyIngested = new Set<string>();
    if (rule.skip_duplicates) {
      const existing = await query<{ source_key: string }>(
        `SELECT DISTINCT source_key FROM ingestion_jobs WHERE status IN ('complete', 'pending', 'downloading', 'uploading', 'ingesting')`
      );
      alreadyIngested = new Set(existing.map(r => r.source_key));
    }

    for (const file of matched) {
      // Skip if already ingested or currently in-flight in another job
      if (rule.skip_duplicates && alreadyIngested.has(file.key)) {
        skipped++;
        continue;
      }

      // Cross-rule dedup: skip if another rule is processing this file RIGHT NOW
      if (inFlightFiles.has(file.key)) {
        console.log(`[AutoIngest] File '${file.key}' is being ingested by another rule — skipping.`);
        skipped++;
        continue;
      }

      // Claim the file globally before starting
      inFlightFiles.add(file.key);

      try {
        await ingestion.startIngestionJob(file.key, rule.source_id);
        filesIngested++;
      } catch (e: any) {
        console.error(`[AutoIngest] Failed to start ingestion for ${file.key}: ${e.message}`);
      } finally {
        // Release after 10s to let the job register in DB before another rule checks
        setTimeout(() => inFlightFiles.delete(file.key), 10000);
      }
    }

    // Update rule stats
    await command(`
      ALTER TABLE ingestion_rules UPDATE
        last_run_at = now(),
        last_run_status = '${filesIngested > 0 ? 'success' : (filesFound === 0 ? 'empty' : 'skipped')}',
        files_found_last_run = ${filesFound},
        files_ingested_last_run = ${filesIngested}
      WHERE id = '${esc(id)}'
    `);

    console.log(`[AutoIngest] Rule '${rule.label}': Found ${filesFound}, Ingested ${filesIngested}, Skipped ${skipped}`);
    return { filesFound, filesIngested, skipped };
  } finally {
    executingRules.delete(id);
  }
}

/* ── Cron Scheduler ── */
const cronJobs = new Map<string, cron.ScheduledTask>();

function registerCronJob(ruleId: string, schedule: string) {
  unregisterCronJob(ruleId);
  if (!cron.validate(schedule)) {
    console.warn(`[AutoIngest] Invalid cron schedule for rule ${ruleId}: ${schedule}`);
    return;
  }
  const task = cron.schedule(schedule, async () => {
    try {
      await executeRule(ruleId);
    } catch (e: any) {
      console.error(`[AutoIngest] Cron error for rule ${ruleId}:`, e.message);
    }
  });
  cronJobs.set(ruleId, task);
  console.log(`[AutoIngest] Registered cron for rule ${ruleId}: ${schedule}`);
}

function unregisterCronJob(ruleId: string) {
  const existing = cronJobs.get(ruleId);
  if (existing) {
    existing.stop();
    cronJobs.delete(ruleId);
  }
}

/** Called on server startup — loads all enabled rules and registers their cron jobs */
export async function setupScheduler(): Promise<void> {
  try {
    const rules = await query<IngestionRule>(`SELECT * FROM ingestion_rules WHERE enabled = 1`);
    for (const rule of rules) {
      registerCronJob(rule.id, rule.schedule);
    }
    console.log(`[AutoIngest] Scheduler initialized: ${rules.length} active rules`);
  } catch (e: any) {
    console.error('[AutoIngest] Failed to initialize scheduler:', e.message);
  }
}
