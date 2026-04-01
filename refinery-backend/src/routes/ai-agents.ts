import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../services/supabaseAdmin.js';
import { callAI } from '../services/aiClient.js';
import { callAIWithTools, type ChatMessage } from '../services/aiClient.js';
import { buildSystemManifest } from '../agents/manifest.js';
import { getToolsForAgent } from '../agents/tools/registry.js';
import { toOpenAITools } from '../agents/tools/types.js';
import { executeTool } from '../agents/tools/executor.js';
import { getPromptContext } from "../agents/context/schema-registry.js";
import { buildIngestionContext } from "../agents/context/context-builder.js";
import { parseIntent, buildChainPrompt, buildDebatePrompt } from "../agents/orchestration.js";
import { getRequestUser } from '../types/auth.js';
import { embedKBEntry, reembedAll, embedQuery } from '../services/embeddings.js';
import { fetchKBEntriesSemantic, buildGuardrailsBlock } from '../agents/context/system-prompt-builder.js';

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
    const userId = getRequestUser(req).id;
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
    const userId = getRequestUser(req).id;
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
    const userId = getRequestUser(req).id;
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

    // 4.5. Semantic KB retrieval — embed user query, find relevant KB entries
    let kbBlock = '';
    try {
      const queryEmbedding = await embedQuery(message);
      const kbEntries = await fetchKBEntriesSemantic(agent.id, queryEmbedding, 5, 0.65);
      if (kbEntries.length > 0) {
        kbBlock = `\n\n=== KNOWLEDGE BASE (${kbEntries.length} relevant entries) ===\n${kbEntries.join('\n\n')}`;
      }
    } catch (e: any) {
      console.warn('[Chat] KB semantic search failed:', e.message);
    }

    // 4.6. Guardrails from DB
    let guardrailsBlock = '';
    try {
      guardrailsBlock = await buildGuardrailsBlock(agent.slug);
    } catch (e: any) {
      console.warn('[Chat] Guardrails fetch failed:', e.message);
    }

    // 5. Build the full system prompt with manifest
    // Behavioral rules come from ai_agent_guardrails table via buildGuardrailsBlock().
    // KB entries come from semantic search via fetchKBEntriesSemantic().
    // Do NOT add hardcoded rules here.
    const systemPrompt = `${manifest}\n\n${agent.system_prompt}${customBlock}\n\n=== LIVE SYSTEM CONTEXT ===\n${systemContext}${kbBlock}\n\n${guardrailsBlock}`;

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

    // 8.5 Determine tool approval mode
    const toolApprovalMode: string = agent.tool_approval_mode || 'always_ask';

    // 9. Call AI with tools
    let aiResult = await callAIWithTools(resolved.serviceSlug, chatMessages, openAITools, {
      maxTokens: agent.max_tokens || 4096,
      temperature: parseFloat(agent.temperature) || 0.5,
      userId,
    });

    // 10. Handle tool calls (multi-turn loop — max rounds from DB)
    const maxRounds = agent.max_tool_rounds || 3;
    let toolRounds = 0;
    while (aiResult.success && aiResult.toolCalls?.length && toolRounds < maxRounds) {
      toolRounds++;

      // Check if ANY tool call needs approval
      const needsApproval = aiResult.toolCalls.some(tc => {
        if (toolApprovalMode === 'always_ask') return true;
        if (toolApprovalMode === 'ask_write') {
          const toolDef = agentTools.find(t => t.name === tc.name);
          return toolDef ? toolDef.riskLevel !== 'read' : true;
        }
        return false; // 'auto' mode
      });

      if (needsApproval) {
        // Save pending tool calls for user approval
        const pendingIds: string[] = [];
        for (const tc of aiResult.toolCalls) {
          const { data: pending } = await supabaseAdmin.from('ai_agent_pending_tools').insert({
            conversation_id: convId,
            agent_slug: agent.slug,
            tool_name: tc.name,
            tool_arguments: tc.arguments,
            user_id: userId,
          }).select('id').single();
          if (pending) pendingIds.push(pending.id);
        }

        // Save assistant message explaining what it wants to do
        const toolDescriptions = aiResult.toolCalls.map(tc =>
          `**${tc.name}** — ${JSON.stringify(tc.arguments, null, 2)}`
        ).join('\n\n');
        const approvalMsg = `🔧 I'd like to use the following tool${aiResult.toolCalls.length > 1 ? 's' : ''}:\n\n${toolDescriptions}\n\nPlease **approve** or **deny** to continue.`;

        await supabaseAdmin.from('ai_agent_messages').insert({
          conversation_id: convId, role: 'assistant',
          content: approvalMsg,
          tool_name: '_pending_approval',
          tool_input: { pendingIds, toolCalls: aiResult.toolCalls },
          latency_ms: Date.now() - start,
        });

        return res.json({
          reply: approvalMsg,
          latencyMs: Date.now() - start,
          pendingApproval: true,
          pendingToolIds: pendingIds,
          toolCalls: aiResult.toolCalls.map(tc => ({ name: tc.name, arguments: tc.arguments })),
        });
      }

      // Auto-execute mode — same as before
      chatMessages.push({
        role: 'assistant',
        content: aiResult.response || `Calling tool: ${aiResult.toolCalls[0].name}`,
      });

      for (const tc of aiResult.toolCalls) {
        const toolResult = await executeTool(
          { id: tc.id, name: tc.name, arguments: tc.arguments },
          { userId: String(userId), agentSlug: agent.slug, conversationId: String(convId), accessToken }
        );

        await supabaseAdmin.from('ai_agent_messages').insert({
          conversation_id: convId, role: 'assistant',
          content: `🔧 Used tool: **${tc.name}**`,
          tool_name: tc.name,
          tool_input: tc.arguments,
          tool_output: toolResult.data || toolResult.error,
        });

        chatMessages.push({
          role: 'tool',
          content: JSON.stringify(toolResult),
          tool_call_id: tc.id,
          name: tc.name,
        });
      }

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

// ── Approve pending tool calls ──
router.post('/conversations/:convId/approve-tools', async (req: Request, res: Response) => {
  const start = Date.now();
  try {
    const userId = getRequestUser(req).id;
    const accessToken = String(req.headers.authorization || '').replace('Bearer ', '');
    const convId = String(req.params.convId);
    const { pendingIds } = req.body;
    if (!pendingIds?.length) return res.status(400).json({ error: 'pendingIds required' });

    // Fetch pending tools
    const { data: pendingTools } = await supabaseAdmin
      .from('ai_agent_pending_tools')
      .select('*').in('id', pendingIds).eq('status', 'pending');
    if (!pendingTools?.length) return res.status(400).json({ error: 'No pending tools found' });

    // Mark as approved
    await supabaseAdmin.from('ai_agent_pending_tools').update({ status: 'approved', decided_at: new Date().toISOString() }).in('id', pendingIds);

    // Resolve conversation → agent
    const { data: conv } = await supabaseAdmin.from('ai_agent_conversations').select('id, agent_id').eq('id', convId).single();
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    const { data: agent } = await supabaseAdmin.from('ai_agents').select('*').eq('id', conv.agent_id).single();
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    // Execute each approved tool
    const toolResults: { name: string; result: any }[] = [];
    for (const pt of pendingTools) {
      const toolResult = await executeTool(
        { id: String(pt.id), name: pt.tool_name, arguments: pt.tool_arguments },
        { userId: String(userId), agentSlug: String(pt.agent_slug), conversationId: convId, accessToken }
      );
      await supabaseAdmin.from('ai_agent_messages').insert({
        conversation_id: convId, role: 'assistant',
        content: `✅ Tool approved & executed: **${pt.tool_name}**`,
        tool_name: pt.tool_name, tool_input: pt.tool_arguments,
        tool_output: toolResult.data || toolResult.error,
      });
      toolResults.push({ name: pt.tool_name, result: toolResult });
    }

    // Rebuild conversation context and call LLM with tool results
    const { data: history } = await supabaseAdmin.from('ai_agent_messages')
      .select('role, content, tool_name, tool_input, tool_output')
      .eq('conversation_id', convId).order('created_at', { ascending: true }).limit(40);

    const systemContext = await gatherContext(agent.id, agent.capabilities || []);
    const manifest = buildSystemManifest(agent.slug);
    const customBlock = agent.custom_instructions ? `\n=== CUSTOM INSTRUCTIONS ===\n${agent.custom_instructions}` : '';
    const systemPrompt = `${manifest}\n\n${agent.system_prompt}${customBlock}\n\n=== LIVE SYSTEM CONTEXT ===\n${systemContext}`;

    const chatMessages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
    for (const m of (history || [])) {
      if (m.role === 'user' || m.role === 'assistant') {
        chatMessages.push({ role: m.role as 'user' | 'assistant', content: m.content });
      }
    }

    // Add tool results
    for (const tr of toolResults) {
      chatMessages.push({ role: 'tool', content: JSON.stringify(tr.result), tool_call_id: tr.name, name: tr.name });
    }

    const resolved = await resolveAgentProvider(agent);
    if (!resolved) return res.status(500).json({ error: 'No AI provider' });

    const aiResult = await callAIWithTools(resolved.serviceSlug, chatMessages, [], {
      maxTokens: agent.max_tokens || 4096,
      temperature: parseFloat(agent.temperature) || 0.5,
      userId,
    });

    const latency = Date.now() - start;
    const reply = aiResult.success ? aiResult.response : `⚠️ Error: ${aiResult.error}`;

    await supabaseAdmin.from('ai_agent_messages').insert({
      conversation_id: convId, role: 'assistant', content: reply,
      tokens_used: aiResult.tokensUsed || 0, latency_ms: latency,
      provider_used: aiResult.providerLabel, model_used: aiResult.model,
    });

    res.json({ reply, latencyMs: latency, tokensUsed: aiResult.tokensUsed });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Deny pending tool calls ──
router.post('/conversations/:convId/deny-tools', async (req: Request, res: Response) => {
  try {
    const { pendingIds, reason } = req.body;
    if (!pendingIds?.length) return res.status(400).json({ error: 'pendingIds required' });

    await supabaseAdmin.from('ai_agent_pending_tools')
      .update({ status: 'denied', decided_at: new Date().toISOString() })
      .in('id', pendingIds);

    const denyMsg = `❌ Tool use denied${reason ? `: ${reason}` : '.'}`;
    await supabaseAdmin.from('ai_agent_messages').insert({
      conversation_id: req.params.convId, role: 'user', content: denyMsg,
    });

    res.json({ success: true, message: denyMsg });
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
    const allowed = ['name', 'role', 'avatar_emoji', 'accent_color', 'system_prompt', 'greeting', 'capabilities', 'enabled', 'temperature', 'max_tokens', 'custom_instructions', 'avatar_url', 'provider_id', 'model_id', 'tool_approval_mode', 'max_tool_rounds', 'max_response_length'];
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
    // Auto-embed (fire-and-forget — don't block the response)
    if (data?.id) embedKBEntry(data.id).catch(() => {});
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
    // Re-embed if title or content changed (fire-and-forget)
    if (data?.id && (req.body.title !== undefined || req.body.content !== undefined)) {
      embedKBEntry(data.id).catch(() => {});
    }
    res.json({ entry: data });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/admin/knowledge/:id', async (req: Request, res: Response) => {
  try {
    await supabaseAdmin.from('ai_agent_knowledge').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Re-embed all KB entries for an agent ──
router.post('/admin/:agentId/knowledge/reembed', async (req: Request, res: Response) => {
  try {
    const result = await reembedAll(String(req.params.agentId));
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Guardrails CRUD ──
router.get('/admin/guardrails', async (req: Request, res: Response) => {
  try {
    const agentId = req.query.agentId as string | undefined;
    let query = supabaseAdmin.from('ai_agent_guardrails').select('*').order('priority', { ascending: false });
    if (agentId) {
      query = query.or(`agent_id.is.null,agent_id.eq.${agentId}`);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json({ guardrails: data || [] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/guardrails', async (req: Request, res: Response) => {
  try {
    const { agent_id, category, rule_text, priority, enabled } = req.body;
    const { data, error } = await supabaseAdmin.from('ai_agent_guardrails')
      .insert({ agent_id: agent_id || null, category: category || 'behavior', rule_text, priority: priority || 0, enabled: enabled !== false })
      .select().single();
    if (error) throw error;
    res.json({ guardrail: data });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/admin/guardrails/:id', async (req: Request, res: Response) => {
  try {
    const updates: Record<string, any> = {};
    for (const k of ['agent_id', 'category', 'rule_text', 'priority', 'enabled']) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    const { data, error } = await supabaseAdmin.from('ai_agent_guardrails').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ guardrail: data });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/admin/guardrails/:id', async (req: Request, res: Response) => {
  try {
    await supabaseAdmin.from('ai_agent_guardrails').delete().eq('id', req.params.id);
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

  // NOTE: KB entries are now injected via semantic search (fetchKBEntriesSemantic)
  // in the chat handler, NOT here. This avoids double-injection.

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

  // ── Live Schema Context (from Schema Registry) ──
  try { const schemaCtx = await getPromptContext(); parts.push("=== DATA SCHEMA ===", schemaCtx); } catch {}
  // Anti-hallucination & behavioral rules are now in ai_agent_guardrails table.
  // They're injected by buildSystemPrompt() → buildGuardrails().
  // Do NOT add hardcoded rules here.

  return parts.join('\n') || 'No system data available.';
}



// Context API
router.get("/context/ingestion", async (req: Request, res: Response) => {
  try {
    const table = (req.query.table as string) || "leads";
    const sourceFile = req.query.source_file as string;
    if (!sourceFile) return res.status(400).json({ error: "source_file required" });
    const result = await buildIngestionContext(table, sourceFile);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// BOARDROOM MEETINGS — Multi-Agent Orchestration
// ═══════════════════════════════════════════════════════════

router.get("/boardroom/meetings", async (req: Request, res: Response) => {
  try {
    const userId = getRequestUser(req).id;
    const { data, error } = await supabaseAdmin.from("ai_boardroom_meetings")
      .select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    res.json({ meetings: data || [] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/boardroom/meetings/:meetingId", async (req: Request, res: Response) => {
  try {
    const { data: meeting } = await supabaseAdmin.from("ai_boardroom_meetings").select("*").eq("id", req.params.meetingId).single();
    if (!meeting) return res.status(404).json({ error: "Not found" });
    const { data: reports } = await supabaseAdmin.from("ai_boardroom_reports").select("*").eq("meeting_id", meeting.id).order("created_at");
    res.json({ meeting, reports: reports || [] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete("/boardroom/meetings/:meetingId", async (req: Request, res: Response) => {
  try {
    await supabaseAdmin.from("ai_boardroom_meetings").delete().eq("id", req.params.meetingId);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});


router.post("/boardroom/meetings", async (req: Request, res: Response) => {
  const meetingStart = Date.now();
  try {
    const userId = getRequestUser(req).id;
    const accessToken = String(req.headers.authorization || "").replace("Bearer ", "");
    const { question, agents: agentSlugs, title, mode } = req.body;
    if (!question?.trim()) return res.status(400).json({ error: "Question required" });
    if (!agentSlugs?.length) return res.status(400).json({ error: "Select at least one agent" });

    const { data: meeting, error: createErr } = await supabaseAdmin.from("ai_boardroom_meetings")
      .insert({ user_id: userId, title: title || question.slice(0, 80), question, agent_slugs: agentSlugs, status: "running" })
      .select().single();
    if (createErr || !meeting) throw createErr || new Error("Failed to create meeting");

    const { data: allAgents } = await supabaseAdmin.from("ai_agents").select("*").in("slug", agentSlugs).eq("enabled", true);
    if (!allAgents?.length) {
      await supabaseAdmin.from("ai_boardroom_meetings").update({ status: "failed", error: "No valid agents" }).eq("id", meeting.id);
      return res.status(400).json({ error: "No valid agents found" });
    }

    for (const ag of allAgents) {
      await supabaseAdmin.from("ai_boardroom_reports").insert({ meeting_id: meeting.id, agent_slug: ag.slug, agent_name: ag.name, status: "pending" });
    }

    res.json({ meeting: { ...meeting, status: "running" } });

    // ── BACKGROUND EXECUTION ──
    (async () => {
      let totalTokens = 0;
      const agentReports: { slug: string; name: string; report: string }[] = [];

      for (const ag of allAgents) {
        const agentStart = Date.now();
        try {
          await supabaseAdmin.from("ai_boardroom_reports").update({ status: "running" }).eq("meeting_id", meeting.id).eq("agent_slug", ag.slug);

          const systemContext = await gatherContext(ag.id, ag.capabilities || []);
          const manifest = buildSystemManifest(ag.slug);
          const customBlock = ag.custom_instructions ? "\n=== CUSTOM INSTRUCTIONS ===\n" + ag.custom_instructions : "";

          // Semantic KB for this agent (same as chat handler)
          let kbBlock = '';
          try {
            const qEmb = await embedQuery(question);
            const kbEntries = await fetchKBEntriesSemantic(ag.id, qEmb, 5, 0.65);
            if (kbEntries.length > 0) kbBlock = "\n\n=== KNOWLEDGE BASE (" + kbEntries.length + " relevant entries) ===\n" + kbEntries.join("\n\n");
          } catch {}

          // Guardrails from DB (same as chat handler)
          let guardrailsBlock = '';
          try { guardrailsBlock = await buildGuardrailsBlock(ag.slug); } catch {}

          // Build mode-aware prompt
          let boardroomBlock = "\n=== BOARDROOM MEETING MODE ===\nYou are in a boardroom meeting. Answer the question from YOUR department perspective.\n- Use your tools to get REAL data.\n- Be structured: headers, bullets, numbers.\n- Focus on YOUR domain only.\n- Start with a 1-line summary, then detail.\n- End with recommendations or flags.\n\nTHE QUESTION: \"" + question + "\"";

          // Chain mode: inject previous agent's response as context
          if (mode === "chain" && agentReports.length > 0) {
            const prev = agentReports[agentReports.length - 1];
            boardroomBlock += "\n\n=== CHAIN MODE ===\n" + prev.name + " already analyzed this and said:\n---\n" + prev.report + "\n---\nBuild on their analysis. Add YOUR perspective, correct mistakes, provide additional insights from YOUR domain.";
          }

          // Debate mode: inject opponent's response
          if (mode === "debate" && agentReports.length > 0) {
            const prev = agentReports[agentReports.length - 1];
            boardroomBlock += "\n\n=== DEBATE MODE ===\n" + prev.name + " argued:\n---\n" + prev.report + "\n---\nCounter their arguments. Use data and evidence. Be constructive but challenge weak points. Present YOUR domain\'s perspective.";
          };

          const systemPrompt = manifest + "\n\n" + ag.system_prompt + customBlock + "\n\n" + systemContext + kbBlock + "\n\n" + boardroomBlock + "\n\n" + guardrailsBlock;
          const agentTools = getToolsForAgent(ag.slug);
          const openAITools = toOpenAITools(agentTools);
          const chatMessages: ChatMessage[] = [{ role: "system", content: systemPrompt }, { role: "user", content: question }];

          const resolved = await resolveAgentProvider(ag);
          if (!resolved) {
            await supabaseAdmin.from("ai_boardroom_reports").update({ status: "failed", error: "No provider", latency_ms: Date.now() - agentStart }).eq("meeting_id", meeting.id).eq("agent_slug", ag.slug);
            agentReports.push({ slug: ag.slug, name: ag.name, report: "⚠️ No AI provider configured." });
            continue;
          }

          let aiResult = await callAIWithTools(resolved.serviceSlug, chatMessages, openAITools, { maxTokens: ag.max_tokens || 4096, temperature: parseFloat(ag.temperature) || 0.4, userId });
          let toolRounds = 0;
          const toolsUsed: string[] = [];

          while (aiResult.success && aiResult.toolCalls?.length && toolRounds < 3) {
            toolRounds++;
            chatMessages.push({ role: "assistant", content: aiResult.response || "" });
            for (const tc of aiResult.toolCalls) {
              toolsUsed.push(tc.name);
              const toolResult = await executeTool({ id: tc.id, name: tc.name, arguments: tc.arguments }, { userId: String(userId), agentSlug: ag.slug, conversationId: "", accessToken });
              chatMessages.push({ role: "tool", content: JSON.stringify(toolResult), tool_call_id: tc.id, name: tc.name });
            }
            aiResult = await callAIWithTools(resolved.serviceSlug, chatMessages, openAITools, { maxTokens: ag.max_tokens || 4096, temperature: parseFloat(ag.temperature) || 0.4, userId });
          }

          const reportContent = aiResult.success ? aiResult.response : "⚠️ Error: " + aiResult.error;
          totalTokens += aiResult.tokensUsed || 0;

          await supabaseAdmin.from("ai_boardroom_reports").update({ status: aiResult.success ? "complete" : "failed", report_content: reportContent, tools_used: [...new Set(toolsUsed)], tokens_used: aiResult.tokensUsed || 0, latency_ms: Date.now() - agentStart, error: aiResult.success ? null : aiResult.error }).eq("meeting_id", meeting.id).eq("agent_slug", ag.slug);
          agentReports.push({ slug: ag.slug, name: ag.name, report: reportContent || "" });

        } catch (agentErr: any) {
          await supabaseAdmin.from("ai_boardroom_reports").update({ status: "failed", error: agentErr.message, latency_ms: Date.now() - agentStart }).eq("meeting_id", meeting.id).eq("agent_slug", ag.slug);
          agentReports.push({ slug: ag.slug, name: ag.name, report: "⚠️ Error: " + agentErr.message });
        }
      }

      // CONSOLIDATION by Crucible
      await supabaseAdmin.from("ai_boardroom_meetings").update({ status: "consolidating" }).eq("id", meeting.id);
      try {
        const reportsBlock = agentReports.map(r => "═══ " + r.name.toUpperCase() + " (" + r.slug + ") ═══\n" + r.report).join("\n\n");
        const consolidationPrompt = "You are Crucible, the Operations Manager of Refinery Nexus.\n\nThe user asked: \"" + question + "\"\n\nDepartment reports:\n\n" + reportsBlock + "\n\nYOUR TASK:\n1. One-line VERDICT\n2. KEY FINDINGS (3-5 bullets)\n3. CROSS-FUNCTIONAL INSIGHTS\n4. RECOMMENDED ACTIONS (prioritized)\n5. RISK FLAGS\n\nBe executive-level concise. Use markdown.";

        const { data: supervisorAgent } = await supabaseAdmin.from("ai_agents").select("*").eq("slug", "supervisor").single();
        const cProvider = supervisorAgent ? await resolveAgentProvider(supervisorAgent) : null;

        if (cProvider) {
          const cResult = await callAIWithTools(cProvider.serviceSlug, [{ role: "system", content: consolidationPrompt }, { role: "user", content: "Consolidate reports for: " + question }], [], { maxTokens: 4096, temperature: 0.3, userId });
          totalTokens += cResult.tokensUsed || 0;
          await supabaseAdmin.from("ai_boardroom_meetings").update({ status: "complete", executive_summary: cResult.success ? cResult.response : "⚠️ Consolidation failed: " + cResult.error, total_tokens: totalTokens, total_latency_ms: Date.now() - meetingStart, completed_at: new Date().toISOString() }).eq("id", meeting.id);
        } else {
          await supabaseAdmin.from("ai_boardroom_meetings").update({ status: "complete", executive_summary: "⚠️ No provider for consolidation. See individual reports.", total_tokens: totalTokens, total_latency_ms: Date.now() - meetingStart, completed_at: new Date().toISOString() }).eq("id", meeting.id);
        }
      } catch (cErr: any) {
        await supabaseAdmin.from("ai_boardroom_meetings").update({ status: "complete", executive_summary: "⚠️ Consolidation error: " + cErr.message, total_tokens: totalTokens, total_latency_ms: Date.now() - meetingStart, completed_at: new Date().toISOString() }).eq("id", meeting.id);
      }
      console.log("[BOARDROOM] Meeting " + meeting.id + " complete — " + agentReports.length + " agents, " + totalTokens + " tokens, " + (Date.now() - meetingStart) + "ms");
    })();
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
