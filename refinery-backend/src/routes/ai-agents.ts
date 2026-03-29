import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../services/supabaseAdmin.js';
import { callAI } from '../services/aiClient.js';

const router = Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════════
// AI Agent Routes — Conversational agents with tool use
// ═══════════════════════════════════════════════════════════

// ── List all agents (public) ──
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
      .select().single();
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
      .from('ai_agent_conversations').select('id, agent_id').eq('id', convId).single();
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const { data: agent } = await supabaseAdmin.from('ai_agents').select('*').eq('id', conv.agent_id).single();
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    // 2. Save user message
    await supabaseAdmin.from('ai_agent_messages').insert({ conversation_id: convId, role: 'user', content: message });

    // 3. Build conversation context
    const { data: history } = await supabaseAdmin
      .from('ai_agent_messages').select('role, content')
      .eq('conversation_id', convId).order('created_at', { ascending: true }).limit(40);

    // 4. Gather system context + KB
    const systemContext = await gatherContext(agent.id, agent.capabilities || []);

    // 5. Custom instructions
    const customBlock = agent.custom_instructions ? `\n=== CUSTOM INSTRUCTIONS ===\n${agent.custom_instructions}` : '';

    // 6. Build the full prompt
    const systemPrompt = `${agent.system_prompt}${customBlock}

=== CURRENT SYSTEM CONTEXT ===
${systemContext}

=== CONVERSATION RULES ===
- You are chatting with a user. Be conversational but expert.
- If the user asks you to DO something (score leads, analyze data, etc.), tell them exactly what you would do and with what parameters.
- Reference the system context when relevant.
- Keep responses focused and actionable. No filler.
- Use markdown formatting for clarity (bold, lists, code blocks).
- When presenting data, use tables or structured formatting.`;

    const conversationHistory = (history || [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content}`)
      .join('\n\n');

    const userPrompt = conversationHistory ? `${conversationHistory}\n\nUSER: ${message}` : `USER: ${message}`;

    // 7. Resolve provider+model via 3-tier cascade:
    //    Tier 1: Agent-specific override (provider_id + model_id on ai_agents row)
    //    Tier 2: System default — `agent_chat` service config
    //    Tier 3: First enabled provider with a selected_model (ultimate fallback)
    const resolved = await resolveAgentProvider(agent);

    if (!resolved) {
      await supabaseAdmin.from('ai_agent_messages').insert({
        conversation_id: convId, role: 'assistant',
        content: '⚠️ No AI provider configured.\n\nGo to **AI Settings** → activate a provider and choose a model. All agents will automatically use it.',
        latency_ms: Date.now() - start,
      });
      return res.json({ reply: '⚠️ No AI provider configured. Go to AI Settings → activate a provider and choose a model.', latencyMs: Date.now() - start });
    }

    // 8. Call AI with resolved provider+model
    const aiResult = await callAI(resolved.serviceSlug, systemPrompt, userPrompt, {
      maxTokens: agent.max_tokens || 4096,
      temperature: parseFloat(agent.temperature) || 0.5,
      userId,
    });

    const latency = Date.now() - start;

    if (!aiResult.success) {
      await supabaseAdmin.from('ai_agent_messages').insert({
        conversation_id: convId, role: 'assistant',
        content: `⚠️ I encountered an issue: ${aiResult.error}\n\nPlease check AI Settings → Service Assignments.`,
        latency_ms: latency,
      });
      return res.json({ reply: `⚠️ AI provider error: ${aiResult.error}`, latencyMs: latency });
    }

    // 8. Save assistant response
    await supabaseAdmin.from('ai_agent_messages').insert({
      conversation_id: convId, role: 'assistant', content: aiResult.response,
      tokens_used: aiResult.tokensUsed || 0, latency_ms: latency,
      provider_used: aiResult.providerLabel, model_used: aiResult.model,
    });

    // 9. Auto-title
    if ((history || []).length <= 2) {
      const title = message.length > 60 ? message.slice(0, 57) + '...' : message;
      await supabaseAdmin.from('ai_agent_conversations').update({ title }).eq('id', convId);
    }

    res.json({
      reply: aiResult.response, latencyMs: latency,
      tokensUsed: aiResult.tokensUsed, provider: aiResult.providerLabel,
      model: aiResult.model, wasFallback: aiResult.wasFallback,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
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
// Agent Management — update agent settings, prompts, KB
// ═══════════════════════════════════════════════════════════

// ── Get all agents (admin — full details) ──
router.get('/admin/all', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin.from('ai_agents').select('*').order('name');
    if (error) throw error;
    res.json({ agents: data || [] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Update agent ──
router.put('/admin/:id', async (req: Request, res: Response) => {
  try {
    const updates: Record<string, any> = {};
    const allowed = ['name', 'role', 'avatar_emoji', 'accent_color', 'system_prompt', 'greeting', 'capabilities', 'enabled', 'temperature', 'max_tokens', 'custom_instructions', 'avatar_url', 'provider_id', 'model_id'];
    for (const k of allowed) { if (req.body[k] !== undefined) updates[k] = req.body[k]; }
    const { data, error } = await supabaseAdmin.from('ai_agents').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ agent: data });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Knowledge Base CRUD ──
router.get('/admin/:agentId/knowledge', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('ai_agent_knowledge').select('*').eq('agent_id', req.params.agentId).order('priority', { ascending: false });
    if (error) throw error;
    res.json({ entries: data || [] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/:agentId/knowledge', async (req: Request, res: Response) => {
  try {
    const { title, content, category, priority } = req.body;
    const { data, error } = await supabaseAdmin.from('ai_agent_knowledge')
      .insert({ agent_id: req.params.agentId, title, content, category: category || 'general', priority: priority || 0 })
      .select().single();
    if (error) throw error;
    res.json({ entry: data });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/admin/knowledge/:id', async (req: Request, res: Response) => {
  try {
    const updates: Record<string, any> = {};
    for (const k of ['title', 'content', 'category', 'priority', 'enabled']) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    const { data, error } = await supabaseAdmin.from('ai_agent_knowledge').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ entry: data });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/admin/knowledge/:id', async (req: Request, res: Response) => {
  try {
    await supabaseAdmin.from('ai_agent_knowledge').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// Provider Resolution — 3-tier cascading default
//
// Tier 1: Agent has its own provider_id + model_id set → use those
// Tier 2: `agent_chat` service config has provider_id → use that
// Tier 3: First enabled provider with a selected_model → use that
//
// This means: activate ANY provider + choose a model → all agents work.
// Override an agent individually → that agent keeps its setting.
// ═══════════════════════════════════════════════════════════

async function resolveAgentProvider(agent: any): Promise<{ serviceSlug: string } | null> {
  // Tier 1: Agent-specific override
  if (agent.provider_id && agent.model_id) {
    // We need the agent_chat service config to exist so callAI can log properly.
    // Upsert a temp row pointing to this provider so callAI() resolves it.
    await supabaseAdmin.from('ai_service_config')
      .upsert({
        service_slug: `agent_${agent.slug}`,
        service_name: `Agent: ${agent.name}`,
        provider_id: agent.provider_id,
        model_id: agent.model_id,
      }, { onConflict: 'service_slug' });
    return { serviceSlug: `agent_${agent.slug}` };
  }

  // Tier 2: System default — `agent_chat` service config
  const { data: svc } = await supabaseAdmin
    .from('ai_service_config')
    .select('provider_id, model_id')
    .eq('service_slug', 'agent_chat')
    .single();

  if (svc?.provider_id) {
    return { serviceSlug: 'agent_chat' };
  }

  // Tier 3: First enabled provider with a selected model → auto-link to agent_chat
  const { data: providers } = await supabaseAdmin
    .from('ai_providers')
    .select('id, selected_model')
    .eq('enabled', true)
    .not('selected_model', 'eq', '')
    .order('priority', { ascending: true })
    .limit(1);

  if (providers && providers.length > 0) {
    const p = providers[0];
    // Auto-cascade: set this as the agent_chat default so all agents auto-inherit
    await supabaseAdmin.from('ai_service_config')
      .upsert({
        service_slug: 'agent_chat',
        service_name: 'AI Agent Chat (System Default)',
        provider_id: p.id,
        model_id: p.selected_model,
      }, { onConflict: 'service_slug' });
    console.log(`[AI] Auto-cascaded provider ${p.id} / ${p.selected_model} to agent_chat (Tier 3)`);
    return { serviceSlug: 'agent_chat' };
  }

  return null; // No provider available anywhere
}

// ═══════════════════════════════════════════════════════════
// Context Gatherer — feeds agents with KB + system data
// ═══════════════════════════════════════════════════════════

async function gatherContext(agentId: string, _capabilities: string[]): Promise<string> {
  const parts: string[] = [];

  // KB entries
  try {
    const { data: kb } = await supabaseAdmin.from('ai_agent_knowledge')
      .select('title, content, category').eq('agent_id', agentId).eq('enabled', true)
      .order('priority', { ascending: false });
    if (kb && kb.length > 0) {
      parts.push('=== KNOWLEDGE BASE ===');
      kb.forEach(k => parts.push(`[${k.category.toUpperCase()}] ${k.title}:\n${k.content}`));
      parts.push('');
    }
  } catch {}

  // Verification jobs
  try {
    const { data: jobs } = await supabaseAdmin.from('verification_jobs')
      .select('id, status, total_processed, safe, uncertain, risky, unknown, created_at')
      .order('created_at', { ascending: false }).limit(5);
    if (jobs && jobs.length > 0) {
      parts.push('RECENT VERIFICATION JOBS:');
      jobs.forEach(j => parts.push(`  Job ${j.id.slice(0, 8)}: ${j.status} | ${j.total_processed} processed | safe=${j.safe} uncertain=${j.uncertain} risky=${j.risky} unknown=${j.unknown} | ${new Date(j.created_at).toLocaleDateString()}`));
    } else {
      parts.push('No verification jobs found.');
    }
  } catch { parts.push('Could not load verification jobs.'); }

  // AI usage
  try {
    const { data: usage } = await supabaseAdmin.from('ai_usage_log')
      .select('service_slug, tokens_used, latency_ms, success')
      .order('created_at', { ascending: false }).limit(50);
    if (usage && usage.length > 0) {
      const n = usage.length;
      const t = usage.reduce((s, u) => s + (u.tokens_used || 0), 0);
      const l = Math.round(usage.reduce((s, u) => s + (u.latency_ms || 0), 0) / n);
      const e = usage.filter(u => !u.success).length;
      parts.push(`\nAI USAGE (last ${n} calls): ${t} tokens | ${l}ms avg | ${e} errors`);
    }
  } catch {}

  // Providers
  try {
    const { data: p } = await supabaseAdmin.from('ai_providers')
      .select('label, provider_type, selected_model').eq('enabled', true);
    if (p && p.length > 0) {
      parts.push(`\nACTIVE PROVIDERS: ${p.map(x => `${x.label} (${x.provider_type}/${x.selected_model})`).join(', ')}`);
    }
  } catch {}

  return parts.join('\n') || 'No system data available.';
}

export default router;
