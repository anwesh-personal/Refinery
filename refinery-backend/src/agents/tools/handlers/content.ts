// ═══════════════════════════════════════════════════════════
// Content Tool Handlers
// Email copy generation for Muse agent
// ═══════════════════════════════════════════════════════════

import type { ToolResult, ToolContext } from '../types.js';
import { internalApi } from './_internal.js';

/** Generate email copy variants */
export async function generateEmailCopy(
  args: {
    type: 'cold_outreach' | 'follow_up' | 're_engagement' | 'announcement' | 'newsletter';
    product: string;
    audience: string;
    tone?: string;
    variants?: number;
  },
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    if (!args.product?.trim()) return { success: false, error: 'Product/service description is required.' };
    if (!args.audience?.trim()) return { success: false, error: 'Target audience description is required.' };

    // Use the content generation route which already handles the LLM call
    const result = await internalApi<any>('/api/ai/content-generation/generate', ctx, {
      method: 'POST',
      body: {
        type: args.type || 'cold_outreach',
        product: args.product,
        audience: args.audience,
        tone: args.tone || 'professional',
        variants: Math.min(args.variants || 3, 5),
      },
      timeout: 60_000,
    });

    return {
      success: true,
      data: {
        variants: result.variants || result.data || [],
        type: args.type,
        tone: args.tone || 'professional',
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
