import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../services/supabaseAdmin.js';
import { callAI } from '../services/aiClient.js';
import { callAIWithTools, type ChatMessage } from '../services/aiClient.js';
import { buildSystemManifest } from '../agents/manifest.js';
import { getToolsForAgent } from '../agents/tools/registry.js';
import { toOpenAITools } from '../agents/tools/types.js';
import { executeTool } from '../agents/tools/executor.js';

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

// ── Send message (the core agent executor with tool calling) ──
router.post('/conversations/:convId/messages', async (req: Request, res: Response) => {
  const start = Date.now();
  try {
    const userId = (req as any).user?.id;
    const accessToken = String(req.headers.authorization || '').replace('Bearer ', '');
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
      .from('ai_agent_messages').select('role, content, tool_name, tool_input, tool_output')
      .eq('conversation_id', convId).order('created_at', { ascending: true }).limit(40);

    // 4. Gather system context + KB + manifest
    const systemContext = await gatherContext(agent.id, agent.capabilities || []);
    const manifest = buildSystemManifest(agent.slug);
    const customBlock = agent.custom_instructions ? `\n=== CUSTOM INSTRUCTIONS ===\n${agent.custom_instructions}` : '';

    // 5. Build the full system prompt with manifest
    const systemPrompt = `${manifest}\n\n${agent.system_prompt}${customBlock}\n\n=== LIVE SYSTEM CONTEXT ===\n${systemContext}\n\n=== CONVERSATION RULES ===
- You are chatting with a user. Be conversational but expert.
- If the user asks you to DO something, USE YOUR TOOLS to actually do it.
- Reference the system context when relevant.
- Keep responses focused and actionable. No filler.
- Use markdown formatting for clarity (bold, lists, code blocks, tables).`;

    // 6. Get tools for this agent
    const agentTools = getToolsForAgent(agent.slug);
    const openAITools = toOpenAITools(agentTools);

    // 7. Build messages array (proper chat format for tool-calling)
    const chatMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add history
    for (const m of (history || [])) {
      if (m.role === 'user' || m.role === 'assistant') {
        chatMessages.push({ role: m.role as 'user' | 'assistant', content: m.content });
      }
    }

    // 8. Resolve provider
    const resolved = await resolveAgentProvider(agent);
    if (!resolved) {
      await supabaseAdmin.from('ai_agent_messages').insert({
        conversation_id: convId, role: 'assistant',
        content: '⚠️ No AI provider configured.\n\nGo to **AI Settings** → activate a provider and choose a model.',
        latency_ms: Date.now() - start,
      });
      return res.json({ reply: '⚠️ No AI provider configured. Go to AI Settings → activate a provider and choose a model.', latencyMs: Date.now() - start });
    }

    // 9. Call AI with tools
    let aiResult = await callAIWithTools(resolved.serviceSlug, chatMessages, openAITools, {
      maxTokens: agent.max_tokens || 4096,
      temperature: parseFloat(agent.temperature) || 0.5,
      userId,
    });

    // 10. Handle tool calls (multi-turn loop — max 3 rounds)
    let toolRounds = 0;
    while (aiResult.success && aiResult.toolCalls?.length && toolRounds < 3) {
      toolRounds++;

      // Add assistant's tool-calling message to context
      chatMessages.push({
        role: 'assistant',
        content: aiResult.response || `Calling tool: ${aiResult.toolCalls[0].name}`,
      });

      // Execute each tool call
      for (const tc of aiResult.toolCalls) {
        const toolResult = await executeTool(
          { id: tc.id, name: tc.name, arguments: tc.arguments },
          { userId: String(userId), agentSlug: agent.slug, conversationId: String(convId), accessToken }
        );

        // Save tool execution to messages
        await supabaseAdmin.from('ai_agent_messages').insert({
          conversation_id: convId, role: 'assistant',
          content: `🔧 Used tool: **${tc.name}**`,
          tool_name: tc.name,
          tool_input: tc.arguments,
          tool_output: toolResult.data || toolResult.error,
        });

        // Add tool result to conversation for LLM
        chatMessages.push({
          role: 'tool',
          content: JSON.stringify(toolResult),
          tool_call_id: tc.id,
          name: tc.name,
        });
      }

      // Call LLM again with tool results
      aiResult = await callAIWithTools(resolved.serviceSlug, chatMessages, openAITools, {
        maxTokens: agent.max_tokens || 4096,
        temperature: parseFloat(agent.temperature) || 0.5,
        userId,
      });
    }

    const latency = Date.now() - start;

    if (!aiResult.success) {
      await supabaseAdmin.from('ai_agent_messages').insert({
        conversation_id: convId, role: 'assistant',
        content: `⚠️ I encountered an issue: ${aiResult.error}\n\nPlease check AI Settings → Service Assignments.`,
        latency_ms: latency,
      });
      return res.json({ reply: `⚠️ AI provider error: ${aiResult.error}`, latencyMs: latency });
    }

    // 11. Save final assistant response
    await supabaseAdmin.from('ai_agent_messages').insert({
      conversation_id: convId, role: 'assistant', content: aiResult.response,
      tokens_used: aiResult.tokensUsed || 0, latency_ms: latency,
      provider_used: aiResult.providerLabel, model_used: aiResult.model,
    });

    // 12. Auto-title
    if ((history || []).length <= 2) {
      const title = message.length > 60 ? message.slice(0, 57) + '...' : message;
      await supabaseAdmin.from('ai_agent_conversations').update({ title }).eq('id', convId);
    }

    res.json({
      reply: aiResult.response, latencyMs: latency,
      tokensUsed: aiResult.tokensUsed, provider: aiResult.providerLabel,
      model: aiResult.model, wasFallback: aiResult.wasFallback,
      toolsUsed: toolRounds > 0,
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

async function gatherContext(agentId: string, capabilities: string[]): Promise<string> {
  const parts: string[] = [];

  // ── Platform Architecture (always injected) ──
  parts.push(`=== PLATFORM: REFINERY NEXUS ===
You are an AI agent inside Refinery Nexus — a full-stack email marketing infrastructure platform.

PIPELINE FLOW:
1. INGESTION: Raw CSV/Parquet data pulled from S3/MinIO → column-mapped → inserted into ClickHouse (universal_person table)
2. MERGE: Duplicate records consolidated using configurable merge keys (email, name+company) → golden records
3. SEGMENTS: Filtered subsets of universal_person based on industry, location, job title, etc → materialized views
4. VERIFICATION: Email validity checked via SMTP probing (EHLO/MAIL FROM/RCPT TO) → valid/risky/invalid/unknown
5. TARGETS: Verified segments exported as clean mailing lists → CSV download or push to queue
6. QUEUE: Target lists dispatched via MTA satellites (Postfix/PowerMTA) with IP warmup scheduling

DATA STORES:
- ClickHouse: Analytics DB with universal_person (millions of leads, 50+ columns)
- Supabase/PostgreSQL: Auth, configs, AI memory, team management
- S3/MinIO: Raw data files, exports

INFRASTRUCTURE:
- MTA Swarm: 50-satellite constellation for email dispatch
- Verification Engine: Verify550 API + built-in SMTP prober
- AI Nexus: This system — 5 specialist agents + provider management
`);

  // ── Knowledge Base entries ──
  try {
    const { data: kb } = await supabaseAdmin.from('ai_agent_knowledge')
      .select('title, content, category').eq('agent_id', agentId).eq('enabled', true)
      .order('priority', { ascending: false });
    if (kb && kb.length > 0) {
      parts.push('=== YOUR KNOWLEDGE BASE ===');
      kb.forEach(k => parts.push(`[${k.category.toUpperCase()}] ${k.title}:\n${k.content}`));
      parts.push('');
    }
  } catch {}

  // ── Live System Data ──

  // Verification jobs
  try {
    const { data: jobs } = await supabaseAdmin.from('verification_jobs')
      .select('id, status, file_name, total_emails, total_processed, safe, uncertain, risky, unknown, created_at, completed_at')
      .order('created_at', { ascending: false }).limit(5);
    if (jobs && jobs.length > 0) {
      parts.push('=== RECENT VERIFICATION JOBS ===');
      jobs.forEach(j => parts.push(`  ${j.file_name || j.id.slice(0, 8)}: ${j.status} | ${j.total_processed}/${j.total_emails} processed | safe=${j.safe} risky=${j.risky} uncertain=${j.uncertain} unknown=${j.unknown} | ${new Date(j.created_at).toLocaleDateString()}`));
    }
  } catch {}

  // Segments
  try {
    const { data: segs } = await supabaseAdmin.from('list_segments')
      .select('name, niche, total_count, verified_count, created_at')
      .order('created_at', { ascending: false }).limit(10);
    if (segs && segs.length > 0) {
      parts.push('\n=== SEGMENTS ===');
      segs.forEach(s => parts.push(`  "${s.name}" (${s.niche || 'general'}): ${s.total_count} leads, ${s.verified_count || 0} verified`));
    }
  } catch {}

  // Target lists
  try {
    const { data: tgts } = await supabaseAdmin.from('target_lists')
      .select('name, status, total_emails, created_at')
      .order('created_at', { ascending: false }).limit(5);
    if (tgts && tgts.length > 0) {
      parts.push('\n=== TARGET LISTS ===');
      tgts.forEach(t => parts.push(`  "${t.name}": ${t.status} | ${t.total_emails} emails | ${new Date(t.created_at).toLocaleDateString()}`));
    }
  } catch {}

  // Server configs
  try {
    const { data: servers } = await supabaseAdmin.from('server_configs')
      .select('name, type, host, port, status')
      .limit(10);
    if (servers && servers.length > 0) {
      parts.push('\n=== SERVER INFRASTRUCTURE ===');
      servers.forEach(s => parts.push(`  ${s.name}: ${s.type} @ ${s.host}:${s.port} [${s.status || 'unknown'}]`));
    }
  } catch {}

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
      parts.push(`\nAI USAGE (last ${n} calls): ${t} tokens | ${l}ms avg latency | ${e} errors`);
    }
  } catch {}

  // Active providers
  try {
    const { data: p } = await supabaseAdmin.from('ai_providers')
      .select('label, provider_type, selected_model').eq('enabled', true);
    if (p && p.length > 0) {
      parts.push(`ACTIVE AI PROVIDERS: ${p.map(x => `${x.label} (${x.provider_type}/${x.selected_model})`).join(', ')}`);
    }
  } catch {}

  // ── Anti-hallucination rules ──
  parts.push(`
=== IMPORTANT RULES ===
- NEVER make up data. If you don't have specific numbers, say "I don't have that data in my current context."
- ALWAYS base your analysis on the SYSTEM CONTEXT provided above.
- If the user asks about something not in your context, tell them which page to check.
- When recommending actions, be specific about which page/feature in Refinery Nexus to use.
- You are an expert in your domain. Be confident but honest about limitations.
- Use the data above to give precise, actionable insights — not generic advice.`);

  return parts.join('\n') || 'No system data available.';
}

export default router;
