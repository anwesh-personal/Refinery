import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';
import { supabaseAdmin } from '../../../services/supabaseAdmin.js';

// ═══════════════════════════════════════════════════════════
// get_agent_activity — Crucible oversees other agents
// ═══════════════════════════════════════════════════════════

const getAgentActivity: ToolDefinition = {
  name: 'get_agent_activity',
  description: 'Get activity logs, performance stats, and recent conversations for any agent. Use when asked about how an agent is performing, what they discussed, or their usage stats.',
  parameters: {
    type: 'object',
    properties: {
      agent_slug: {
        type: 'string',
        description: 'Agent slug to check (e.g. "data_scientist", "smtp_specialist", "seo_strategist", "verification_engineer")',
      },
      include_conversations: {
        type: 'boolean',
        description: 'If true, include recent conversation content. Default false.',
      },
      limit: {
        type: 'number',
        description: 'Number of recent conversations to fetch. Default 5.',
      },
    },
    required: ['agent_slug'],
  },
  riskLevel: 'read',
  agents: ['supervisor'],

  handler: async (args: any, _ctx: ToolContext): Promise<ToolResult> => {
    try {
      const { agent_slug } = args;
      const includeConvos = args.include_conversations || false;
      const limit = args.limit || 5;

      // Get agent info
      const { data: agent } = await supabaseAdmin
        .from('ai_agents').select('id, name, slug, role, enabled')
        .eq('slug', agent_slug).single();

      if (!agent) return { success: false, error: `Agent "${agent_slug}" not found` };

      // Get usage stats
      const { data: usage } = await supabaseAdmin
        .from('ai_usage_log').select('tokens_used, latency_ms, success, created_at')
        .eq('agent_slug', agent_slug)
        .order('created_at', { ascending: false }).limit(50);

      const totalCalls = usage?.length || 0;
      const totalTokens = usage?.reduce((s, u) => s + (u.tokens_used || 0), 0) || 0;
      const avgLatency = totalCalls > 0
        ? Math.round((usage?.reduce((s, u) => s + (u.latency_ms || 0), 0) || 0) / totalCalls)
        : 0;
      const errorRate = totalCalls > 0
        ? `${((usage?.filter(u => !u.success).length || 0) / totalCalls * 100).toFixed(1)}%`
        : '0%';

      // Get recent conversations
      const { data: convos } = await supabaseAdmin
        .from('ai_agent_conversations').select('id, title, created_at')
        .eq('agent_id', agent.id)
        .order('created_at', { ascending: false }).limit(limit);

      let conversationDetails: any[] = [];
      if (includeConvos && convos) {
        for (const c of convos.slice(0, 3)) {
          const { data: msgs } = await supabaseAdmin
            .from('ai_agent_messages').select('role, content, created_at')
            .eq('conversation_id', c.id)
            .order('created_at', { ascending: true }).limit(10);
          conversationDetails.push({
            title: c.title,
            date: c.created_at,
            messages: msgs?.map(m => ({ role: m.role, content: m.content?.slice(0, 200) })) || [],
          });
        }
      }

      // Get boardroom participation
      const { data: reports } = await supabaseAdmin
        .from('ai_boardroom_reports').select('status, latency_ms, tokens_used, created_at')
        .eq('agent_slug', agent_slug)
        .order('created_at', { ascending: false }).limit(10);

      const boardroomStats = {
        totalMeetings: reports?.length || 0,
        avgLatency: reports?.length
          ? Math.round((reports.reduce((s, r) => s + (r.latency_ms || 0), 0)) / reports.length)
          : 0,
        failures: reports?.filter(r => r.status === 'failed').length || 0,
      };

      return {
        success: true,
        data: {
          agent: { name: agent.name, slug: agent.slug, role: agent.role, enabled: agent.enabled },
          performanceStats: {
            recentCalls: totalCalls,
            totalTokens,
            avgLatencyMs: avgLatency,
            errorRate,
          },
          boardroomStats,
          recentConversations: convos?.map(c => ({ title: c.title, date: c.created_at })) || [],
          conversationDetails: includeConvos ? conversationDetails : undefined,
        },
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },
};

export default getAgentActivity;
