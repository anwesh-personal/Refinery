import { query, command, insertRows } from '../db/clickhouse.js';
import { genId, sleep } from '../utils/helpers.js';
import { env } from '../config/env.js';

/** Start a mail queue job from a target list */
export async function startQueueJob(targetListId: string): Promise<string> {
  const jobId = genId();

  const lists = await query<{ email_count: string }>(`
    SELECT email_count FROM target_lists FINAL WHERE id = '${targetListId}' LIMIT 1
  `);
  const list = lists[0];
  if (!list) throw new Error(`Target list ${targetListId} not found`);

  await insertRows('queue_jobs', [{
    id: jobId,
    target_list_id: targetListId,
    total_emails: Number(list.email_count),
    status: 'queued',
  }]);

  // Start dispatch in background
  runMailDispatch(jobId, targetListId).catch(async (err) => {
    console.error(`[Queue] Job ${jobId} failed:`, err.message);
    await command(`
      ALTER TABLE queue_jobs UPDATE
        status = 'failed'
      WHERE id = '${jobId}'
    `);
  });

  return jobId;
}

async function runMailDispatch(jobId: string, targetListId: string) {
  const lists = await query<{ segment_id: string }>(`
    SELECT segment_id FROM target_lists FINAL WHERE id = '${targetListId}' LIMIT 1
  `);
  if (!lists[0]) throw new Error('Target list not found');

  const segmentId = (lists[0] as any).segment_id;

  await command(`ALTER TABLE queue_jobs UPDATE status = 'sending', started_at = now() WHERE id = '${jobId}'`);

  // Fetch verified emails in batches
  const BATCH = 100;
  let offset = 0;
  let sent = 0;
  let failed = 0;
  const rateLimit = env.smtp.rateLimitPerHour;
  const msPerEmail = Math.floor(3600000 / rateLimit);

  while (true) {
    // Check if paused
    const [job] = await query<{ status: string }>(`SELECT status FROM queue_jobs WHERE id = '${jobId}' LIMIT 1`);
    if (job?.status === 'paused') {
      console.log(`[Queue] Job ${jobId}: Paused. Waiting...`);
      await sleep(5000);
      continue;
    }

    const rows = await query<{ up_id: string; business_email: string; personal_emails: string; first_name: string }>(`
      SELECT up_id, business_email, personal_emails, first_name
      FROM universal_person
      WHERE has(_segment_ids, '${segmentId}')
        AND _verification_status = 'valid'
        AND (business_email IS NOT NULL OR personal_emails IS NOT NULL)
      LIMIT ${BATCH} OFFSET ${offset}
    `);

    if (rows.length === 0) break;

    for (const row of rows) {
      const email = row.business_email || row.personal_emails;
      if (!email) continue;

      try {
        await sendEmail(email, row.first_name || 'there');
        sent++;
      } catch {
        failed++;
      }

      // Rate limiting
      await sleep(msPerEmail);
    }

    // Update progress
    await command(`
      ALTER TABLE queue_jobs UPDATE
        sent_count = ${sent}, failed_count = ${failed}
      WHERE id = '${jobId}'
    `);

    offset += BATCH;
  }

  await command(`
    ALTER TABLE queue_jobs UPDATE
      status = 'complete', completed_at = now(),
      sent_count = ${sent}, failed_count = ${failed}
    WHERE id = '${jobId}'
  `);
  console.log(`[Queue] Job ${jobId}: Complete. Sent: ${sent}, Failed: ${failed}`);
}

async function sendEmail(to: string, firstName: string): Promise<void> {
  if (!env.smtp.host) {
    console.log(`[Queue] SMTP not configured — simulating send to ${to}`);
    return;
  }

  // In production, integrate with your SMTP relay / SES here
  // For now, this is the integration point
  const resp = await fetch(`https://${env.smtp.host}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.smtp.fromEmail,
      to,
      subject: 'Hello',
      html: `<p>Hi ${firstName},</p>`,
    }),
  });

  if (!resp.ok) {
    throw new Error(`SMTP error: ${resp.status}`);
  }
}

/** Pause a running job */
export async function pauseJob(jobId: string) {
  await command(`ALTER TABLE queue_jobs UPDATE status = 'paused' WHERE id = '${jobId}'`);
}

/** Resume a paused job */
export async function resumeJob(jobId: string) {
  await command(`ALTER TABLE queue_jobs UPDATE status = 'sending' WHERE id = '${jobId}'`);
}

/** List all queue jobs */
export async function listQueueJobs() {
  return query('SELECT * FROM queue_jobs ORDER BY created_at DESC LIMIT 50');
}

/** Get queue stats */
export async function getQueueStats() {
  const [stats] = await query<{
    queued: string;
    sent: string;
    failed: string;
    active: string;
  }>(`
    SELECT
      countIf(status = 'queued') as queued,
      sum(sent_count) as sent,
      sum(failed_count) as failed,
      countIf(status = 'sending') as active
    FROM queue_jobs
  `);
  return stats;
}
