import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../services/supabaseAdmin.js';
import { callAI } from '../services/aiClient.js';

const router = Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════════
// AI Agent Routes — Conversational agents with tool use
// ═══════════════════════════════════════════════════════════

// ── List all agents ──
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('ai_agents')
      .select('id, slug, name, role, avatar_emoji, accent_color, greeting, capabilities, enabled')
      .eq('enabled', true)
      .order('name');
    if (error) throw error;
    res.json({ agents: data || [] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── List conversations for an agent ──
router.get('/:slug/conversations', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { data: agent } = await supabaseAdmin.from('ai_agents').select('id').eq('slug', req.params.slug).single();
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const { data, error } = await supabaseAdmin
      .from('ai_agent_conversations')
      .select('id, title, pinned, created_at, updated_at')
      .eq('agent_id', agent.id)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ conversations: data || [] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Create conversation ──
router.post('/:slug/conversations', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { data: agent } = await supabaseAdmin.from('ai_agents').select('id').eq('slug', req.params.slug).single();
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const { data, error } = await supabaseAdmin
      .from('ai_agent_conversations')
      .insert({ agent_id: agent.id, user_id: userId, title: req.body.title || 'New Conversation' })
      .select()
      .single();
    if (error) throw error;
    res.json({ conversation: data });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Get messages for a conversation ──
router.get('/conversations/:convId/messages', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('ai_agent_messages')
      .select('id, role, content, tool_name, tool_input, tool_output, tokens_used, latency_ms, provider_used, model_used, created_at')
      .eq('conversation_id', req.params.convId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw error;
    res.json({ messages: data || [] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Send message (the core agent executor) ──
router.post('/conversations/:convId/messages', async (req: Request, res: Response) => {
  const start = Date.now();
  try {
    const userId = (req as any).user?.id;
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Message required' });

    const convId = req.params.convId;

    // 1. Resolve conversation → agent
    const { data: conv } = await supabaseAdmin
      .from('ai_agent_conversations')
      .select('id, agent_id')
      .eq('id', convId)
      .single();
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const { data: agent } = await supabaseAdmin
      .from('ai_agents')
      .select('*')
      .eq('id', conv.agent_id)
      .single();
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    // 2. Save user message
    await supabaseAdmin.from('ai_agent_messages').insert({
      conversation_id: convId, role: 'user', content: message,
    });

    // 3. Build conversation context
    const { data: history } = await supabaseAdmin
      .from('ai_agent_messages')
      .select('role, content')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .limit(40);

    // 4. Gather system context (latest stats for the agent)
    const systemContext = await gatherContext(agent.capabilities || []);

    // 5. Build the full prompt
    const systemPrompt = `${agent.system_prompt}

=== CURRENT SYSTEM CONTEXT ===
${systemContext}

=== CONVERSATION RULES ===
- You are chatting with a user. Be conversational but expert.
- If the user asks you to DO something (score leads, analyze data, etc.), tell them exactly what you would do and with what parameters.
- Reference the system context when relevant (e.g., "I see you have X verification jobs with Y results").
- Keep responses focused and actionable. No filler.
- Use markdown formatting for clarity (bold, lists, code blocks).
- When presenting data, use tables or structured formatting.`;

    const conversationHistory = (history || [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content}`)
      .join('\n\n');

    const userPrompt = conversationHistory
      ? `${conversationHistory}\n\nUSER: ${message}`
      : `USER: ${message}`;

    // 6. Call AI
    // Use the supervisor service config for all agents (they share the same provider)
    // If a specific agent service config exists, it would be used via serviceSlug
    const serviceSlug = 'campaign_optimizer'; // Use any configured service — agents share AI providers
    const aiResult = await callAI(serviceSlug, systemPrompt, userPrompt, {
      maxTokens: 4096,
      temperature: 0.5,
      userId,
    });

    const latency = Date.now() - start;

    if (!aiResult.success) {
      // Save error as assistant message
      await supabaseAdmin.from('ai_agent_messages').insert({
        conversation_id: convId, role: 'assistant',
        content: `⚠️ I encountered an issue: ${aiResult.error}\n\nPlease check that an AI provider is assigned in AI Settings → Service Assignments.`,
        latency_ms: latency,
      });
      return res.json({
        reply: `⚠️ AI provider error: ${aiResult.error}`,
        latencyMs: latency,
      });
    }

    // 7. Save assistant response
    await supabaseAdmin.from('ai_agent_messages').insert({
      conversation_id: convId, role: 'assistant', content: aiResult.response,
      tokens_used: aiResult.tokensUsed || 0,
      latency_ms: latency,
      provider_used: `${aiResult.providerLabel}`,
      model_used: aiResult.model,
    });

    // 8. Auto-title the conversation if it's the first exchange
    if ((history || []).length <= 2) {
      const title = message.length > 60 ? message.slice(0, 57) + '...' : message;
      await supabaseAdmin.from('ai_agent_conversations').update({ title }).eq('id', convId);
    }

    res.json({
      reply: aiResult.response,
      latencyMs: latency,
      tokensUsed: aiResult.tokensUsed,
      provider: aiResult.providerLabel,
      model: aiResult.model,
      wasFallback: aiResult.wasFallback,
    });

  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Delete conversation ──
router.delete('/conversations/:convId', async (req: Request, res: Response) => {
  try {
    await supabaseAdmin.from('ai_agent_messages').delete().eq('conversation_id', req.params.convId);
    await supabaseAdmin.from('ai_agent_conversations').delete().eq('id', req.params.convId);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Update conversation (title, pin) ──
router.put('/conversations/:convId', async (req: Request, res: Response) => {
  try {
    const updates: Record<string, any> = {};
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.pinned !== undefined) updates.pinned = req.body.pinned;
    const { data, error } = await supabaseAdmin.from('ai_agent_conversations').update(updates).eq('id', req.params.convId).select().single();
    if (error) throw error;
    res.json({ conversation: data });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// Context Gatherer — feeds agents with real system data
// ═══════════════════════════════════════════════════════════

async function gatherContext(capabilities: string[]): Promise<string> {
  const parts: string[] = [];

  // Always include basic system stats
  try {
    const { data: jobs } = await supabaseAdmin
      .from('verification_jobs')
      .select('id, status, total_processed, safe, uncertain, risky, unknown, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    if (jobs && jobs.length > 0) {
      parts.push('RECENT VERIFICATION JOBS:');
      jobs.forEach(j => {
        parts.push(`  Job ${j.id.slice(0, 8)}: ${j.status} | ${j.total_processed} processed | safe=${j.safe} uncertain=${j.uncertain} risky=${j.risky} unknown=${j.unknown} | ${new Date(j.created_at).toLocaleDateString()}`);
      });
    } else {
      parts.push('No verification jobs found in the system.');
    }
  } catch { parts.push('Could not load verification jobs.'); }

  // AI usage stats
  try {
    const { data: usage } = await supabaseAdmin
      .from('ai_usage_log')
      .select('service_slug, tokens_used, latency_ms, success')
      .order('created_at', { ascending: false })
      .limit(50);

    if (usage && usage.length > 0) {
      const totalCalls = usage.length;
      const totalTokens = usage.reduce((s, u) => s + (u.tokens_used || 0), 0);
      const avgLatency = Math.round(usage.reduce((s, u) => s + (u.latency_ms || 0), 0) / totalCalls);
      const errors = usage.filter(u => !u.success).length;
      parts.push(`\nAI USAGE (last ${totalCalls} calls): ${totalTokens} tokens | ${avgLatency}ms avg latency | ${errors} errors`);
    }
  } catch {}

  // Provider info
  try {
    const { data: providers } = await supabaseAdmin
      .from('ai_providers')
      .select('label, provider_type, enabled, validated, selected_model')
      .eq('enabled', true);
    if (providers && providers.length > 0) {
      parts.push(`\nACTIVE AI PROVIDERS: ${providers.map(p => `${p.label} (${p.provider_type}/${p.selected_model})`).join(', ')}`);
    }
  } catch {}

  return parts.join('\n') || 'No system data available.';
}

export default router;
