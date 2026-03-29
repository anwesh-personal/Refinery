// ═══════════════════════════════════════════════════════════
// Verification Tool Handlers
// Wraps existing /api/verify/* routes for agent use
// ═══════════════════════════════════════════════════════════

import type { ToolResult, ToolContext } from '../types.js';
import { internalApi } from './_internal.js';

/** Start a new email verification pipeline job */
export async function startVerification(
  args: { emails: string[]; checks?: Record<string, boolean> },
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    if (!args.emails || args.emails.length === 0) {
      return { success: false, error: 'No emails provided.' };
    }
    if (args.emails.length > 200_000) {
      return { success: false, error: 'Maximum 200,000 emails per job. Split into batches.' };
    }

    const body: any = { emails: args.emails };
    if (args.checks) body.checks = args.checks;

    const result = await internalApi<any>('/api/verify/jobs', ctx, {
      method: 'POST',
      body,
      timeout: 60_000,
    });

    return {
      success: true,
      data: {
        jobId: result.id,
        totalEmails: result.total_emails,
        status: 'running',
        message: `Verification job started for ${result.total_emails} emails. Use get_verification_status to track progress.`,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/** Check verification job progress */
export async function getVerificationStatus(
  args: { job_id: string },
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    if (!args.job_id) return { success: false, error: 'job_id is required.' };

    const job = await internalApi<any>(`/api/verify/jobs/${args.job_id}`, ctx);
    const pct = job.total_emails > 0
      ? Math.round((Number(job.processed_count) / Number(job.total_emails)) * 100)
      : 0;

    return {
      success: true,
      data: {
        status: job.status,
        totalEmails: Number(job.total_emails),
        processedCount: Number(job.processed_count),
        safeCount: Number(job.safe_count),
        riskyCount: Number(job.risky_count),
        rejectedCount: Number(job.rejected_count),
        uncertainCount: Number(job.uncertain_count),
        percentComplete: pct,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        errorMessage: job.error_message || null,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/** Get paginated results from a completed verification job */
export async function getVerificationResults(
  args: { job_id: string; classification?: string; limit?: number; offset?: number },
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    if (!args.job_id) return { success: false, error: 'job_id is required.' };

    const params = new URLSearchParams({
      include: 'results',
      limit: String(Math.min(args.limit || 100, 500)),
      offset: String(args.offset || 0),
    });
    if (args.classification && args.classification !== 'all') {
      params.set('classification', args.classification);
    }

    const job = await internalApi<any>(`/api/verify/jobs/${args.job_id}?${params}`, ctx, {
      timeout: 60_000,
    });

    return {
      success: true,
      data: {
        results: job.results || [],
        totalResults: job.totalResults || 0,
        pagination: job.pagination || null,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/** List all verification jobs with status and counts */
export async function listVerificationJobs(
  _args: Record<string, never>,
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    const data = await internalApi<any>('/api/verify/jobs', ctx);
    // data is an array of jobs
    const jobs = (Array.isArray(data) ? data : data.jobs || []).map((j: any) => ({
      id: j.id,
      status: j.status,
      totalEmails: Number(j.total_emails),
      processedCount: Number(j.processed_count),
      safeCount: Number(j.safe_count),
      riskyCount: Number(j.risky_count),
      rejectedCount: Number(j.rejected_count),
      uncertainCount: Number(j.uncertain_count),
      startedAt: j.started_at,
      completedAt: j.completed_at,
    }));

    return { success: true, data: { jobs } };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
