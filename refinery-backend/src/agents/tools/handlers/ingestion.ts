// ═══════════════════════════════════════════════════════════
// Ingestion Tool Handlers
// S3 source listing and ingestion job management for Overseer
// ═══════════════════════════════════════════════════════════

import type { ToolResult, ToolContext } from '../types.js';
import { internalApi } from './_internal.js';

/** List configured S3/MinIO data sources */
export async function listS3Sources(
  _args: Record<string, never>,
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    const data = await internalApi<any>('/api/ingestion/sources', ctx);
    const sources = (Array.isArray(data) ? data : data.sources || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      bucket: s.bucket,
      region: s.region || 'us-east-1',
      lastUsed: s.last_used || null,
    }));
    return { success: true, data: { sources, count: sources.length } };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/** Start an S3 ingestion job */
export async function startIngestion(
  args: { source_id: string; files: string[]; column_mapping?: Record<string, string> },
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    if (!args.source_id) return { success: false, error: 'source_id is required.' };
    if (!args.files || args.files.length === 0) return { success: false, error: 'At least one file path is required.' };

    const result = await internalApi<any>('/api/ingestion/start', ctx, {
      method: 'POST',
      body: {
        sourceId: args.source_id,
        files: args.files,
        columnMapping: args.column_mapping || {},
      },
      timeout: 60_000,
    });

    return {
      success: true,
      data: {
        jobId: result.id || result.jobId,
        status: 'running',
        filesCount: args.files.length,
        message: `Ingestion job started for ${args.files.length} file(s).`,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
