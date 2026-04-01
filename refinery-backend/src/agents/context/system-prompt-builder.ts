import { getPromptContext } from './schema-registry.js';
import { supabaseAdmin } from '../../services/supabaseAdmin.js';

// ═══════════════════════════════════════════════════════════
// System Prompt Builder — Assembles context-aware system prompts
// ═══════════════════════════════════════════════════════════

interface PromptBuildOptions {
  agentSlug: string;
  agentName: string;
  agentRole: string;
  basePrompt: string;       // The agent's personality/role prompt from DB
  kbEntries?: string[];     // Knowledge base entries
  pageContext?: any;         // Context from the page the user is on
}

/**
 * Builds a complete system prompt by layering:
 * 1. Agent personality (from DB)
 * 2. Live schema context (from Schema Registry)
 * 3. Knowledge base entries
 * 4. Page-level context (if provided)
 * 5. Behavioral guardrails (dynamically from DB capabilities)
 */
export async function buildSystemPrompt(options: PromptBuildOptions): Promise<string> {
  const sections: string[] = [];

  // 1. Agent personality
  sections.push(options.basePrompt);

  // 2. Live schema context
  try {
    const schemaCtx = await getPromptContext();
    sections.push(schemaCtx);
  } catch (e: any) {
    console.warn('[PromptBuilder] Schema context failed:', e.message);
  }

  // 3. Knowledge base entries
  if (options.kbEntries && options.kbEntries.length > 0) {
    sections.push('## Knowledge Base\n');
    for (const entry of options.kbEntries) {
      sections.push(entry);
    }
  }

  // 4. Page-level context
  if (options.pageContext) {
    sections.push('## Current Context\n');
    if (typeof options.pageContext === 'string') {
      sections.push(options.pageContext);
    } else {
      sections.push('```json\n' + JSON.stringify(options.pageContext, null, 2) + '\n```');
    }
  }

  // 5. Behavioral guardrails (dynamic — from DB capabilities, not hardcoded slugs)
  sections.push(await buildGuardrails(options.agentSlug));

  return sections.join('\n\n');
}

/**
 * Agent-specific behavioral guardrails.
 * Common rules are always applied.
 * Agent-specific rules are pulled from the agent's `capabilities` array in the DB.
 */
async function buildGuardrails(agentSlug: string): Promise<string> {
  const sections: string[] = ['## Operating Guidelines'];

  try {
    // Fetch agent ID from slug
    const { data: agent } = await supabaseAdmin
      .from('ai_agents')
      .select('id, capabilities, max_response_length')
      .eq('slug', agentSlug)
      .single();

    if (!agent) {
      sections.push('- Operate within your defined role. Be helpful and accurate.');
      return sections.join('\n');
    }

    // Fetch guardrails: global (agent_id IS NULL) + agent-specific
    const { data: guardrails } = await supabaseAdmin
      .from('ai_agent_guardrails')
      .select('category, rule_text, priority')
      .or(`agent_id.is.null,agent_id.eq.${agent.id}`)
      .eq('enabled', true)
      .order('priority', { ascending: false });

    if (guardrails && guardrails.length > 0) {
      // Group by category for clean formatting
      const byCategory = new Map<string, string[]>();
      for (const g of guardrails) {
        if (!byCategory.has(g.category)) byCategory.set(g.category, []);
        byCategory.get(g.category)!.push(g.rule_text);
      }

      const categoryLabels: Record<string, string> = {
        behavior: 'Behavior',
        output_format: 'Output Format',
        tool_policy: 'Tool Usage Policy',
        safety: 'Safety Rules',
        persona: 'Persona',
        training: 'Domain Training',
      };

      for (const [cat, rules] of byCategory) {
        sections.push(`\n### ${categoryLabels[cat] || cat}`);
        for (const rule of rules) {
          sections.push(`- ${rule}`);
        }
      }
    }

    // Inject capabilities
    if (agent.capabilities && Array.isArray(agent.capabilities) && agent.capabilities.length > 0) {
      sections.push(`\n### Your Capabilities`);
      sections.push(`- Your tools: ${agent.capabilities.join(', ')}.`);
      sections.push('- Only operate within your defined capabilities. Defer to other agents for domains outside your scope.');
    }

    // Inject response length limit
    if (agent.max_response_length) {
      sections.push(`\n- Keep responses under ${agent.max_response_length} characters unless the user explicitly asks for detailed output.`);
    }
  } catch (e: any) {
    console.warn('[PromptBuilder] Guardrails fetch failed:', e.message);
    sections.push('- Be helpful, accurate, and concise.');
  }

  return sections.join('\n');
}

/**
 * Fetch KB entries for an agent — priority-based (fallback)
 */
export async function fetchKBEntries(agentId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('ai_agent_knowledge')
    .select('title, content')
    .eq('agent_id', agentId)
    .eq('enabled', true)
    .order('priority', { ascending: false })
    .limit(20);

  if (!data || data.length === 0) return [];
  return data.map(e => `### ${e.title}\n${e.content}`);
}

/**
 * Fetch KB entries using semantic vector search.
 * Requires: query embedding (1536-dim float array from OpenAI embeddings API).
 * Falls back to priority-based if no embeddings exist or RPC fails.
 */
export async function fetchKBEntriesSemantic(
  agentId: string,
  queryEmbedding: number[] | null,
  topK = 5,
  threshold = 0.7
): Promise<string[]> {
  // If no embedding provided, fall back to priority-based
  if (!queryEmbedding || queryEmbedding.length === 0) {
    return fetchKBEntries(agentId);
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('match_agent_knowledge', {
      p_agent_id: agentId,
      p_query_embedding: queryEmbedding,
      p_match_count: topK,
      p_match_threshold: threshold,
    });

    if (error) throw error;
    if (!data || data.length === 0) {
      // No semantic matches — fall back to priority-based
      return fetchKBEntries(agentId);
    }

    return data.map((e: any) => `### ${e.title} (relevance: ${(e.similarity * 100).toFixed(0)}%)\n${e.content}`);
  } catch (e: any) {
    console.warn('[PromptBuilder] Semantic KB search failed, falling back:', e.message);
    return fetchKBEntries(agentId);
  }
}

