// ═══════════════════════════════════════════════════════════
// Segment Tool Handlers
// List, create, and count segments for Cortex agent
// ═══════════════════════════════════════════════════════════

import type { ToolResult, ToolContext } from '../types.js';
import { internalApi } from './_internal.js';

/** List all defined segments */
export async function listSegments(
  _args: Record<string, never>,
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    const data = await internalApi<any>('/api/segments', ctx);
    const segments = (Array.isArray(data) ? data : data.segments || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      description: s.description || '',
      rowCount: s.row_count || s.total_count || 0,
      createdAt: s.created_at,
    }));
    return { success: true, data: { segments, count: segments.length } };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/** Create a new segment with filter rules */
export async function createSegment(
  args: { name: string; description?: string; filters: any },
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    if (!args.name?.trim()) return { success: false, error: 'Segment name is required.' };
    if (!args.filters) return { success: false, error: 'Filter rules are required.' };

    const result = await internalApi<any>('/api/segments', ctx, {
      method: 'POST',
      body: {
        name: args.name.trim(),
        description: args.description || '',
        filters: args.filters,
      },
    });

    return {
      success: true,
      data: {
        id: result.id,
        name: result.name,
        rowCount: result.row_count || 0,
        message: `Segment "${result.name}" created with ${result.row_count || 0} matching leads.`,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/** Get row count for a specific segment */
export async function getSegmentCount(
  args: { segment_id: string },
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    if (!args.segment_id) return { success: false, error: 'segment_id is required.' };
    const data = await internalApi<any>(`/api/segments/${args.segment_id}/count`, ctx);
    return {
      success: true,
      data: {
        segmentId: args.segment_id,
        rowCount: data.count || data.row_count || 0,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
