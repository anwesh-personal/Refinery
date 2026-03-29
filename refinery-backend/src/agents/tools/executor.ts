// ═══════════════════════════════════════════════════════════
// Tool Executor — Routes LLM tool calls to the correct handler
//
// Flow: LLM returns tool_use → executor validates → handler runs → result returned
// ═══════════════════════════════════════════════════════════

import type { ToolCall, ToolResult, ToolContext, ToolExecutionLog } from './types.js';
import { TOOL_REGISTRY } from './registry.js';
import { supabaseAdmin } from '../../services/supabaseAdmin.js';

// Rate limiting — in-memory counters per userId:toolName
const rateLimits = new Map<string, { count: number; resetAt: number }>();

/** Execute a tool call from the LLM */
export async function executeTool(
  call: ToolCall,
  context: ToolContext
): Promise<ToolResult> {
  const tool = TOOL_REGISTRY[call.name];

  // Unknown tool
  if (!tool) {
    return { success: false, error: `Unknown tool: "${call.name}". Available tools: ${Object.keys(TOOL_REGISTRY).join(', ')}` };
  }

  // Authorization: agent must be allowed to use this tool
  if (!tool.agents.includes(context.agentSlug)) {
    return { success: false, error: `Agent "${context.agentSlug}" is not authorized to use tool "${call.name}".` };
  }

  // Rate limiting
  const rateKey = `${context.userId}:${call.name}`;
  const now = Date.now();
  const rateEntry = rateLimits.get(rateKey);

  if (rateEntry && rateEntry.resetAt > now) {
    const maxPerMinute = call.name === 'query_database' ? 10 : call.name.startsWith('start_') ? 2 : 20;
    if (rateEntry.count >= maxPerMinute) {
      return { success: false, error: `Rate limit exceeded for "${call.name}". Max ${maxPerMinute} calls per minute. Try again shortly.` };
    }
    rateEntry.count++;
  } else {
    rateLimits.set(rateKey, { count: 1, resetAt: now + 60_000 });
  }

  // Execute the handler
  const startMs = Date.now();
  let result: ToolResult;
  try {
    result = await tool.handler(call.arguments, context);
  } catch (err: any) {
    result = { success: false, error: `Tool execution crashed: ${err.message}` };
  }
  const durationMs = Date.now() - startMs;

  // Log execution (fire-and-forget — never block the response)
  logExecution({
    agentSlug: context.agentSlug,
    userId: context.userId,
    conversationId: context.conversationId,
    toolName: call.name,
    arguments: call.arguments,
    result: { success: result.success, error: result.error },
    durationMs,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  // Truncate large results to prevent token explosion when sent back to LLM
  if (result.success && result.data) {
    result.data = truncateForLLM(result.data);
  }

  return result;
}

/** Truncate tool results to stay within token budget */
function truncateForLLM(data: any, maxChars = 16_000): any {
  const json = JSON.stringify(data);
  if (json.length <= maxChars) return data;

  // If it has a rows/results array, slice it
  if (Array.isArray(data.rows)) {
    const sliced = data.rows.slice(0, 50);
    return { ...data, rows: sliced, _truncated: true, _note: `Showing first 50 of ${data.rows.length} rows` };
  }
  if (Array.isArray(data.results)) {
    const sliced = data.results.slice(0, 50);
    return { ...data, results: sliced, _truncated: true, _note: `Showing first 50 of ${data.results.length} results` };
  }
  if (Array.isArray(data.jobs)) {
    return { ...data, jobs: data.jobs.slice(0, 20), _truncated: true };
  }

  // Last resort: stringify and cut
  return { _truncated: true, _preview: json.slice(0, maxChars), _totalLength: json.length };
}

/** Log tool execution to audit log (non-blocking) */
async function logExecution(log: ToolExecutionLog): Promise<void> {
  try {
    await supabaseAdmin.from('audit_log').insert({
      action: 'tool_execution',
      resource_type: 'agent_tool',
      resource_id: log.toolName,
      user_id: log.userId,
      details: {
        agent: log.agentSlug,
        conversation: log.conversationId,
        tool: log.toolName,
        args: sanitizeArgs(log.arguments),
        success: log.result.success,
        error: log.result.error || null,
        durationMs: log.durationMs,
      },
    });
  } catch {
    // Never fail on logging
  }
}

/** Remove sensitive data from logged arguments (e.g., full email lists) */
function sanitizeArgs(args: Record<string, any>): Record<string, any> {
  const safe = { ...args };
  // Don't log full email arrays — just the count
  if (Array.isArray(safe.emails)) {
    safe.emails = `[${safe.emails.length} emails]`;
  }
  // Don't log full query results
  if (typeof safe.query === 'string' && safe.query.length > 500) {
    safe.query = safe.query.slice(0, 500) + '...';
  }
  return safe;
}
